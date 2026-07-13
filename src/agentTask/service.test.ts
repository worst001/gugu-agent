import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonlAgentTaskEventLog } from './events/jsonlEventLog.js'
import {
  AgentTaskService,
  AgentTaskValidationError,
} from './service.js'
import type { VerificationResult } from './types.js'

const tempDirs: string[] = []

async function createService(): Promise<AgentTaskService> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-task-service-test-'))
  tempDirs.push(dir)
  return new AgentTaskService(new JsonlAgentTaskEventLog(dir))
}

function passingResult(): VerificationResult {
  return {
    checkId: 'tests',
    command: 'bun test',
    status: 'passed',
    exitCode: 0,
    stdout: '1 pass',
    stderr: '',
    startedAt: '2026-07-13T00:00:00.000Z',
    completedAt: '2026-07-13T00:00:01.000Z',
    durationMs: 1000,
  }
}

function minimalTaskInput() {
  return {
    title: 'Fix regression',
    goal: 'Restore expected behavior',
    workspacePath: 'D:/workspace',
    requiredChecks: [
      {
        id: 'tests',
        label: 'Regression test',
        command: 'bun test',
        required: true,
      },
    ],
  }
}
async function advanceToVerify(service: AgentTaskService, taskId: string) {
  await service.transitionTask(taskId, 'scout')
  await service.recordScout(taskId, 'Located the failing module and callers.')
  await service.transitionTask(taskId, 'plan')
  await service.recordPlan(taskId, {
    summary: 'Make the smallest fix and run the regression test.',
    steps: ['Edit the failing module', 'Run the regression test'],
    verificationCheckIds: ['tests'],
  })
  await service.transitionTask(taskId, 'execute')
  await service.recordExecution(taskId, 'Implemented the bounded fix.')
  return service.transitionTask(taskId, 'verify')
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('AgentTaskService', () => {
  it('rejects intake without a workspace and required verification', async () => {
    const service = await createService()

    await expect(
      service.createTask({
        title: 'Fix regression',
        goal: 'Restore expected behavior',
      }),
    ).rejects.toThrow('workspacePath')

    await expect(
      service.createTask({
        title: 'Fix regression',
        goal: 'Restore expected behavior',
        workspacePath: 'D:/workspace',
      }),
    ).rejects.toThrow('required verification check')
  })
  it('allows only one active task per session, including concurrent creates', async () => {
    const service = await createService()
    const input = {
      ...minimalTaskInput(),
      sessionId: 'session-1',
    }

    const results = await Promise.allSettled([
      service.createTask(input),
      service.createTask(input),
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(AgentTaskValidationError)

    const created = results.find((result) => result.status === 'fulfilled')
    if (!created || created.status !== 'fulfilled') {
      throw new Error('Expected one AgentTask to be created')
    }
    await service.cancelTask(created.value.id)

    const replacement = await service.createTask(input)
    expect(replacement.sessionId).toBe('session-1')
    expect(replacement.status).toBe('intake')
  })

  it('completes only after persisted passing evidence and a review outcome', async () => {
    const service = await createService()
    const created = await service.createTask({
      title: 'Fix regression',
      goal: 'Restore expected behavior',
      sessionId: 'session-1',
      workspacePath: 'D:/workspace',
      requiredChecks: [
        {
          id: 'tests',
          label: 'Regression test',
          command: 'bun test',
          required: true,
        },
      ],
    })

    await advanceToVerify(service, created.id)
    const verified = await service.recordVerification(created.id, {
      results: [passingResult()],
      changedFiles: ['src/fix.ts'],
    })

    expect(verified.task.status).toBe('review')
    expect(verified.task.evidencePackId).toBe(verified.evidencePack.id)

    const completed = await service.recordReview(created.id, {
      status: 'unavailable',
      summary: 'Reviewer timed out.',
    })
    expect(completed.status).toBe('completed')
    expect(completed.review?.status).toBe('unavailable')

    const detail = await service.getTaskDetail(created.id)
    expect(detail.evidencePack?.checks[0].exitCode).toBe(0)
    expect(detail.events.at(-1)?.type).toBe('task_completed')
  })

  it('persists failed evidence and refuses completion', async () => {
    const service = await createService()
    const task = await service.createTask(minimalTaskInput())
    await advanceToVerify(service, task.id)

    const result = passingResult()
    const failed = await service.recordVerification(task.id, {
      results: [
        {
          ...result,
          status: 'failed',
          exitCode: 1,
          stderr: 'test failed',
        },
      ],
    })

    expect(failed.task.status).toBe('failed')
    expect(failed.task.evidencePackId).toBe(failed.evidencePack.id)
    await expect(
      service.recordReview(task.id, { status: 'passed' }),
    ).rejects.toThrow('must be review')
  })

  it('recovers active tasks as interrupted and resumes with a new attempt', async () => {
    const service = await createService()
    const task = await service.createTask(minimalTaskInput())
    await service.transitionTask(task.id, 'scout')
    await service.recordScout(task.id, 'Old attempt scout evidence')

    const restarted = new AgentTaskService(service.eventLog)
    const recovered = await restarted.recoverInterruptedTasks()
    expect(recovered).toHaveLength(1)
    expect(recovered[0].status).toBe('interrupted')
    expect(recovered[0].recoverable).toBe(true)

    const resumed = await restarted.resumeInterruptedTask(task.id)
    expect(resumed.status).toBe('intake')
    expect(resumed.attempt).toBe(2)
    expect(resumed.runId).not.toBe(task.runId)
    expect(resumed.scoutSummary).toBeUndefined()

    expect(await restarted.recoverInterruptedTasks()).toHaveLength(1)
  })

  it('returns a permission block to the exact prior phase', async () => {
    const service = await createService()
    const task = await service.createTask(minimalTaskInput())
    await service.transitionTask(task.id, 'scout')
    const blocked = await service.blockForPermission(
      task.id,
      'Write permission denied',
    )
    expect(blocked.status).toBe('blocked')
    expect(blocked.resumeStatus).toBe('scout')

    const resumed = await service.resolveBlock(task.id)
    expect(resumed.status).toBe('scout')
    expect(resumed.warnings).toContain('Write permission denied')
  })

  it('allows only one concurrent transition from the same revision', async () => {
    const service = await createService()
    const task = await service.createTask(minimalTaskInput())

    const results = await Promise.allSettled([
      service.transitionTask(task.id, 'scout'),
      service.transitionTask(task.id, 'cancelled'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})
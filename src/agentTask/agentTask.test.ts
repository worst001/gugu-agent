import { afterEach, describe, expect, it } from 'bun:test'
import { appendFile, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isAgentTaskRuntimeEnabled } from './featureFlag.js'
import {
  AgentTaskLogCorruptionError,
  JsonlAgentTaskEventLog,
} from './events/jsonlEventLog.js'
import { reduceAgentTaskEvents } from './events/reducer.js'
import {
  assertAgentTaskTransition,
  canTransitionAgentTask,
} from './stateMachine.js'
import type { AgentTask } from './types.js'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-task-test-'))
  tempDirs.push(dir)
  return dir
}

function createTask(taskId: string, runId = 'run-1'): AgentTask {
  const timestamp = '2026-07-13T00:00:00.000Z'
  return {
    schemaVersion: 1,
    id: taskId,
    runId,
    attempt: 1,
    role: 'software_engineer',
    title: 'Fix a regression',
    goal: 'Make the failing behavior pass',
    constraints: [],
    status: 'intake',
    requiredChecks: [],
    warnings: [],
    recoverable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('AgentTask feature flag', () => {
  it('is off by default and follows the repository truthy convention', () => {
    expect(isAgentTaskRuntimeEnabled({})).toBe(false)
    expect(
      isAgentTaskRuntimeEnabled({ CC_GUGU_AGENT_TASK_RUNTIME: 'yes' }),
    ).toBe(true)
    expect(
      isAgentTaskRuntimeEnabled({ CC_GUGU_AGENT_TASK_RUNTIME: 'invalid' }),
    ).toBe(false)
  })
})

describe('AgentTask state machine', () => {
  it('accepts the software-engineer happy path', () => {
    const states = [
      'intake',
      'scout',
      'plan',
      'execute',
      'verify',
      'review',
      'completed',
    ] as const

    for (let index = 0; index < states.length - 1; index += 1) {
      expect(canTransitionAgentTask(states[index], states[index + 1])).toBe(
        true,
      )
    }
  })

  it('rejects skipped stages and only resumes a block to its prior state', () => {
    expect(() => assertAgentTaskTransition('intake', 'execute')).toThrow(
      'intake -> execute',
    )
    expect(canTransitionAgentTask('blocked', 'execute', 'execute')).toBe(true)
    expect(canTransitionAgentTask('blocked', 'plan', 'execute')).toBe(false)
  })
})

describe('JsonlAgentTaskEventLog', () => {
  it('serializes concurrent appends with contiguous sequences', async () => {
    const log = new JsonlAgentTaskEventLog(await createTempDir())
    const task = createTask('task-1')

    await log.append({
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      type: 'task_created',
      payload: { task },
    })

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        log.append({
          taskId: task.id,
          runId: task.runId,
          attempt: task.attempt,
          type: 'scout_recorded',
          payload: { summary: `fact-${index}` },
        }),
      ),
    )

    const events = await log.readTaskEvents(task.id)
    expect(events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
  })

  it('ignores a malformed final line and repairs it before append', async () => {
    const log = new JsonlAgentTaskEventLog(await createTempDir())
    const task = createTask('task-tail')
    await log.append({
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      type: 'task_created',
      payload: { task },
    })
    await appendFile(log.getEventsPath(task.id), '{"partial"')

    expect(await log.readTaskEvents(task.id)).toHaveLength(1)

    await log.append({
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      type: 'status_changed',
      payload: { from: 'intake', to: 'scout' },
    })

    const events = await log.readTaskEvents(task.id)
    expect(events).toHaveLength(2)
    expect(reduceAgentTaskEvents(events).status).toBe('scout')
  })

  it('rejects corruption before the final line', async () => {
    const log = new JsonlAgentTaskEventLog(await createTempDir())
    const task = createTask('task-corrupt')
    const event = await log.append({
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      type: 'task_created',
      payload: { task },
    })
    await writeFile(
      log.getEventsPath(task.id),
      `${JSON.stringify(event)}\nnot-json\n${JSON.stringify({
        ...event,
        eventId: 'another',
        sequence: 2,
      })}\n`,
    )

    await expect(log.readTaskEvents(task.id)).rejects.toBeInstanceOf(
      AgentTaskLogCorruptionError,
    )
  })
})
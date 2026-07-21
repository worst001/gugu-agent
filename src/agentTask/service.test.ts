import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { JsonlAgentTaskEventLog } from './events/jsonlEventLog.js'
import { buildAgentTaskRoleContext } from './rolePacks.js'
import {
  AgentTaskService,
  AgentTaskValidationError,
} from './service.js'
import type {
  AgentTask,
  KnowledgeCandidatePack,
  VerificationResult,
} from './types.js'
import { deriveWorkspaceId } from './workspaceId.js'

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
  it('rejects intake without a workspace', async () => {
    const service = await createService()

    await expect(
      service.createTask({
        title: 'Fix regression',
        goal: 'Restore expected behavior',
      }),
    ).rejects.toThrow('workspacePath')


    await expect(
      service.createTask({
        ...minimalTaskInput(),
        role: 'unknown',
      }),
    ).rejects.toThrow('Unsupported AgentTask role')
  })
  it('snapshots a selected team and task template', async () => {
    const service = await createService()
    const created = await service.createTask({
      ...minimalTaskInput(),
      teamId: 'short_video_production',
      taskTemplateId: 'script_storyboard',
    })

    expect(created.role).toBe('short_video_operator')
    expect(created.definitionSnapshot?.team).toEqual({
      id: 'short_video_production',
      version: '1.0.0',
    })
    expect(created.definitionSnapshot?.taskTemplate).toEqual({
      id: 'script_storyboard',
      version: '1.0.0',
    })

    await expect(service.createTask({
      ...minimalTaskInput(),
      taskTemplateId: 'script_storyboard',
    })).rejects.toThrow('requires teamId')

    await expect(service.createTask({
      ...minimalTaskInput(),
      teamId: 'short_video_production',
      role: 'software_engineer',
    })).rejects.toThrow('must match the selected team')

    await expect(service.createTask({
      ...minimalTaskInput(),
      teamId: 'knowledge_delivery',
      taskTemplateId: 'knowledge_independent_review',
    })).rejects.toThrow('requires a review parent relation')
  })

  it('adds video capabilities only to the render task snapshot', async () => {
    const service = await createService()
    const script = await service.createTask({
      ...minimalTaskInput(),
      teamId: 'short_video_production',
      taskTemplateId: 'script_storyboard',
    })
    const render = await service.createTask({
      ...minimalTaskInput(),
      sessionId: 'another-session',
      teamId: 'short_video_production',
      taskTemplateId: 'video_render',
    })

    expect(script.definitionSnapshot?.capabilities.required)
      .not.toContain('video_rendering')
    expect(render.definitionSnapshot?.capabilities.required)
      .toEqual(expect.arrayContaining(['video_composition', 'video_rendering']))
  })

  it('persists required verification declared during planning', async () => {
    const service = await createService()
    const created = await service.createTask({
      title: 'Prepare report',
      goal: 'Create a verified report',
      workspacePath: 'D:/workspace',
    })
    expect(created.requiredChecks).toEqual([])

    await service.transitionTask(created.id, 'scout')
    await service.recordScout(created.id, 'Located the source material.')
    await service.transitionTask(created.id, 'plan')
    const plan = {
      summary: 'Create and verify the report.',
      steps: ['Write the report', 'Run the verification'],
      verificationCheckIds: ['artifact'],
    }

    await expect(service.recordPlan(created.id, plan))
      .rejects.toThrow('required verification check')

    const planned = await service.recordPlan(created.id, plan, [{
      id: 'artifact',
      label: 'Report exists',
      command: 'test -f report.md',
      required: true,
    }])
    expect(planned.requiredChecks).toEqual([{
      id: 'artifact',
      label: 'Report exists',
      command: 'test -f report.md',
      required: true,
    }])
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
      role: ' software_engineer ',
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
    expect(created.roleVersion).toBe('1.0.0')

    await advanceToVerify(service, created.id)
    const verified = await service.recordVerification(created.id, {
      results: [passingResult()],
      changedFiles: ['src/fix.ts'],
      artifacts: [
        {
          kind: 'report',
          label: 'Fix report',
          path: 'reports/fix.md',
        },
      ],
    })

    expect(verified.task.status).toBe('review')
    expect(verified.task.evidencePackId).toBe(verified.evidencePack.id)

    const completed = await service.recordReview(created.id, {
      status: 'unavailable',
      summary: 'Reviewer timed out.',
      findings: [
        'Keep the response mapper behavior bounded.',
        '响应映射必须保持边界。',
      ],
    })
    expect(completed.status).toBe('completed')
    expect(completed.review?.status).toBe('unavailable')

    const restarted = new AgentTaskService(service.eventLog)
    const detail = await restarted.getTaskDetail(created.id)
    expect(detail.evidencePack?.checks[0].exitCode).toBe(0)
    expect(detail.knowledgeCandidatePack).toMatchObject({
      taskId: created.id,
      runId: created.runId,
      evidencePackId: verified.evidencePack.id,
      artifactPaths: ['reports/fix.md'],
      candidates: [
        {
          kind: 'task_outcome',
          state: 'pending',
          text: 'Implemented the bounded fix.',
        },
        {
          kind: 'review_finding',
          state: 'pending',
          text: 'Keep the response mapper behavior bounded.',
        },
        {
          kind: 'review_finding',
          state: 'pending',
          text: '响应映射必须保持边界。',
        },
      ],
    })
    expect(
      detail.events.at(-1)?.payload.knowledgeCandidatePackId,
    ).toBe(detail.knowledgeCandidatePack?.id)
    expect(detail.events.at(-1)?.type).toBe('task_completed')

    const followup = await restarted.createTask({
      ...minimalTaskInput(),
      title: 'Keep the response mapper bounded',
    })
    const recalled = await restarted.recallKnowledge(
      followup.id,
      'bounded response',
      3,
    )
    expect(recalled.query).toBe('bounded response')
    expect(recalled.items[0]).toMatchObject({
      sourceTaskId: created.id,
      sourceTaskTitle: 'Fix regression',
      kind: 'review_finding',
      state: 'pending',
      text: 'Keep the response mapper behavior bounded.',
      evidencePackId: verified.evidencePack.id,
      artifactPaths: ['reports/fix.md'],
    })
    const chineseRecall = await restarted.recallKnowledge(
      followup.id,
      '响应映射边界',
      1,
    )
    expect(chineseRecall.items[0]?.text).toBe('响应映射必须保持边界。')
    await advanceToVerify(restarted, followup.id)
    await restarted.recordVerification(followup.id, {
      results: [passingResult()],
      artifacts: [
        {
          kind: 'report',
          label: 'Updated fix report',
          path: 'reports/fix.md',
        },
      ],
    })
    await restarted.recordReview(followup.id, {
      status: 'passed',
      summary: 'Follow-up verified.',
    })
    const mapTarget = await restarted.createTask({
      ...minimalTaskInput(),
      title: 'Inspect project knowledge',
    })
    const knowledgeMap = await restarted.getKnowledgeMap(mapTarget.id)
    expect(knowledgeMap.summary).toEqual({
      taskCount: 2,
      candidateCount: 4,
      sourceCount: 0,
      artifactCount: 1,
      potentialConflictCount: 1,
      truncated: false,
    })
    expect(knowledgeMap.tasks.map((item) => item.taskId)).toEqual(
      expect.arrayContaining([created.id, followup.id]),
    )
    expect(knowledgeMap.workspaceId).toMatch(/^ws_v1_[a-f0-9]{64}$/)
    expect(knowledgeMap.artifacts).toEqual([{
      path: 'reports/fix.md',
      taskIds: expect.arrayContaining([created.id, followup.id]),
    }])
    expect(knowledgeMap.knowledgeItems).toHaveLength(4)
    expect(knowledgeMap.potentialConflicts[0]).toMatchObject({
      kind: 'shared_artifact_path',
      artifactPath: 'reports/fix.md',
      taskIds: expect.arrayContaining([created.id, followup.id]),
    })

    const isolated = await restarted.createTask({
      ...minimalTaskInput(),
      workspacePath: 'D:/other-workspace',
    })
    expect(
      await restarted.recallKnowledge(isolated.id, 'bounded response', 3),
    ).toEqual({ query: 'bounded response', items: [], truncated: false })
  })

  it('persists a selected assistant and creates a validated review child', async () => {
    const service = await createService()

    await expect(service.createTask({
      ...minimalTaskInput(),
      assistantId: 'custom-1',
    })).rejects.toThrow('assistantId and assistantName')

    await expect(service.createTask({
      ...minimalTaskInput(),
      assistantOverlay: {
        id: 'wrong-role',
        name: 'Wrong role',
        baseRole: 'knowledge_worker',
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        instructions: 'Review carefully.',
      },
    })).rejects.toThrow('base role must match')

    const parent = await service.createTask({
      ...minimalTaskInput(),
      sessionId: 'session-review',
      teamId: 'software_delivery',
      taskTemplateId: 'bug_fix',
      assistantOverlay: {
        id: 'custom-1',
        name: 'Release reviewer',
        baseRole: 'software_engineer',
        sourceUpdatedAt: '2026-07-20T00:00:00.000Z',
        instructions: 'Prefer focused diffs and explicit evidence.',
      },
    })
    expect(parent).toMatchObject({
      assistantId: 'custom-1',
      assistantName: 'Release reviewer',
      definitionSnapshot: {
        schemaVersion: 1,
        team: { id: 'software_delivery', version: '1.0.0' },
        taskTemplate: { id: 'bug_fix', version: '1.0.0' },
        workflow: { id: 'verified_delivery', version: '1.0.0' },
        roles: [{
          slotId: 'primary',
          kind: 'primary',
          role: 'software_engineer',
          roleVersion: '1.0.0',
          assistant: {
            id: 'custom-1',
            instructions: 'Prefer focused diffs and explicit evidence.',
          },
        }],
      },
    })
    expect(buildAgentTaskRoleContext(parent)?.assistantOverlay).toMatchObject({
      id: 'custom-1',
      instructions: 'Prefer focused diffs and explicit evidence.',
    })

    await expect(service.createTask({
      ...minimalTaskInput(),
      parentTaskId: parent.id,
      relation: 'review',
      sessionId: 'session-review',
    })).rejects.toThrow('already has an active AgentTask')

    await advanceToVerify(service, parent.id)
    await service.recordVerification(parent.id, {
      results: [passingResult()],
      changedFiles: ['src/fix.ts'],
    })
    await service.recordReview(parent.id, {
      status: 'passed',
      summary: 'Primary task reviewed.',
      findings: [],
    })

    const child = await service.createTask({
      ...minimalTaskInput(),
      title: 'Review Fix regression',
      sessionId: 'session-review',
      teamId: 'software_delivery',
      taskTemplateId: 'software_independent_review',
      parentTaskId: parent.id,
      relation: 'review',
    })
    expect(child).toMatchObject({
      parentTaskId: parent.id,
      relation: 'review',
      role: 'software_engineer',
      status: 'intake',
      definitionSnapshot: {
        team: { id: 'software_delivery', version: '1.0.0' },
        taskTemplate: {
          id: 'software_independent_review',
          version: '1.0.0',
        },
      },
    })
    expect((await service.getKnowledgeMap(child.id)).tasks[0]).toMatchObject({
      taskId: parent.id,
      assistantName: 'Release reviewer',
    })

    const sessionlessParent = await service.createTask(minimalTaskInput())
    await advanceToVerify(service, sessionlessParent.id)
    await service.recordVerification(sessionlessParent.id, {
      results: [passingResult()],
    })
    await service.recordReview(sessionlessParent.id, {
      status: 'passed',
      summary: 'Sessionless parent reviewed.',
    })
    await expect(service.createTask({
      ...minimalTaskInput(),
      parentTaskId: sessionlessParent.id,
      relation: 'review',
    })).rejects.toThrow('same session')
  })
  it('filters by workspace before applying the bounded knowledge scan', async () => {
    const service = await createService()
    const target = await service.createTask({
      ...minimalTaskInput(),
      title: 'Inspect local workspace knowledge',
    })
    const source: AgentTask = {
      ...target,
      id: 'source-task',
      runId: 'source-run',
      status: 'completed',
      title: 'Relevant local outcome',
      executionSummary: 'Keep the current workspace result visible.',
      updatedAt: '2026-07-13T00:00:00.000Z',
    }
    const unrelated = Array.from({ length: 500 }, (_, index): AgentTask => ({
      ...source,
      id: 'other-' + index,
      runId: 'other-run-' + index,
      workspacePath: 'D:/other-workspace',
    }))
    const workspaceId = await deriveWorkspaceId(target.workspacePath ?? '')
    const pack: KnowledgeCandidatePack = {
      schemaVersion: 1,
      id: 'source-pack',
      taskId: source.id,
      runId: source.runId,
      attempt: source.attempt,
      workspaceId,
      evidencePackId: 'source-evidence',
      artifactPaths: ['reports/current.md'],
      createdAt: source.updatedAt,
      candidates: [{
        id: 'source-candidate',
        kind: 'task_outcome',
        state: 'pending',
        text: 'Keep the current workspace result visible.',
        createdAt: source.updatedAt,
      }],
    }
    service.listTasks = async () => [...unrelated, source]
    service.knowledgeCandidateStore.readLatest = async (taskId) =>
      taskId === source.id ? pack : null

    const map = await service.getKnowledgeMap(target.id)
    expect(map.tasks.map((task) => task.taskId)).toEqual([source.id])
    expect(
      (await service.recallKnowledge(target.id, 'current workspace')).items,
    ).toHaveLength(1)
  })
  it('bounds the visible potential-conflict list', async () => {
    const service = await createService()
    const artifactPaths = Array.from(
      { length: 51 },
      (_, index) => 'reports/shared-' + String(index).padStart(2, '0') + '.md',
    )
    const completeWithArtifacts = async (title: string) => {
      const task = await service.createTask({
        ...minimalTaskInput(),
        title,
      })
      await advanceToVerify(service, task.id)
      await service.recordVerification(task.id, {
        results: [passingResult()],
        artifacts: artifactPaths.map((path) => ({
          kind: 'report',
          label: path,
          path,
        })),
      })
      await service.recordReview(task.id, {
        status: 'passed',
        summary: 'Verified shared reports.',
      })
    }

    await completeWithArtifacts('First report task')
    await completeWithArtifacts('Second report task')
    const target = await service.createTask({
      ...minimalTaskInput(),
      title: 'Inspect bounded conflicts',
    })

    const knowledgeMap = await service.getKnowledgeMap(target.id)
    expect(knowledgeMap.summary.potentialConflictCount).toBe(51)
    expect(knowledgeMap.summary.truncated).toBe(true)
    expect(knowledgeMap.potentialConflicts).toHaveLength(50)
  })

  it('does not treat path aliases in one task as a conflict', async () => {
    const service = await createService()
    const task = await service.createTask({
      ...minimalTaskInput(),
      title: 'Write one report through aliases',
    })
    await advanceToVerify(service, task.id)
    await service.recordVerification(task.id, {
      results: [passingResult()],
      artifacts: [
        {
          kind: 'report',
          label: 'Slash path',
          path: 'reports/same.md',
        },
        {
          kind: 'report',
          label: 'Backslash path',
          path: 'reports\\same.md',
        },
      ],
    })
    await service.recordReview(task.id, {
      status: 'passed',
      summary: 'Verified one report.',
    })
    const target = await service.createTask({
      ...minimalTaskInput(),
      title: 'Inspect path aliases',
    })

    const knowledgeMap = await service.getKnowledgeMap(target.id)
    expect(knowledgeMap.summary.potentialConflictCount).toBe(0)
    expect(knowledgeMap.potentialConflicts).toEqual([])
  })

  it('keeps knowledge-worker artifact and provenance requirements hard', async () => {
    const service = await createService()
    const task = await service.createTask({
      ...minimalTaskInput(),
      role: 'knowledge_worker',
    })
    await advanceToVerify(service, task.id)

    await expect(service.recordVerification(task.id, {
      results: [passingResult()],
    })).rejects.toThrow(
      'Knowledge Worker verification requires at least one artifact',
    )
    expect((await service.getTask(task.id))?.status).toBe('verify')

    const verified = await service.recordVerification(task.id, {
      results: [passingResult()],
      artifacts: [{
        kind: 'report',
        label: 'Launch brief',
        path: 'deliverables/launch-brief.docx',
      }],
    })
    expect(verified.task.status).toBe('review')

    await expect(service.recordReview(task.id, {
      status: 'passed',
      summary: 'Artifact verified.',
    })).rejects.toThrow(
      'Knowledge Worker review requires a Provenance Pack',
    )
    expect((await service.getTask(task.id))?.status).toBe('review')
  })

  it('applies artifact and provenance gates to short-video work', async () => {
    const service = await createService()
    const task = await service.createTask({
      ...minimalTaskInput(),
      role: 'short_video_operator',
    })
    await advanceToVerify(service, task.id)

    await expect(service.recordVerification(task.id, {
      results: [passingResult()],
    })).rejects.toThrow(
      'Short Video Operator verification requires at least one artifact',
    )

    await service.recordVerification(task.id, {
      results: [passingResult()],
      artifacts: [{
        kind: 'document',
        label: 'Short-video scripts',
        path: 'deliverables/short-video-scripts.docx',
      }],
    })

    await expect(service.recordReview(task.id, {
      status: 'passed',
      summary: 'Scripts verified.',
    })).rejects.toThrow(
      'Short Video Operator review requires a Provenance Pack',
    )
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

  it('serializes a new task against resuming an interrupted task', async () => {
    const service = await createService()
    const input = {
      ...minimalTaskInput(),
      sessionId: 'session-resume-race',
    }
    const task = await service.createTask(input)
    await service.transitionTask(task.id, 'scout')
    await service.recoverInterruptedTasks()

    const results = await Promise.allSettled([
      service.createTask(input),
      service.resumeInterruptedTask(task.id),
    ])

    expect(results.filter((result) => result.status === 'fulfilled'))
      .toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected'))
      .toHaveLength(1)
    const sessionTasks = await service.listTasks(input.sessionId)
    expect(sessionTasks.filter((item) => item.status !== 'interrupted'))
      .toHaveLength(1)
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

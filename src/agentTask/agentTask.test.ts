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
  AGENT_TASK_ROLE_PACKS,
  buildAgentTaskRoleContext,
  KNOWLEDGE_WORKER_ROLE_PACK,
  resolveAgentTaskRolePack,
  SHORT_VIDEO_OPERATOR_ROLE_PACK,
  SOFTWARE_ENGINEER_ROLE_PACK,
} from './rolePacks.js'
import {
  assertAgentTaskTransition,
  canTransitionAgentTask,
} from './stateMachine.js'
import type { AgentTask } from './types.js'
import { resolveAgentTaskCapabilities } from './capabilities.js'
import {
  resolveAgentTaskWorkflowPack,
  VERIFIED_DELIVERY_WORKFLOW_PACK,
} from './workflowPacks.js'

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
    roleVersion: SOFTWARE_ENGINEER_ROLE_PACK.version,
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

describe('AgentTask Role Packs', () => {
  it('resolves semantic capabilities from the supplied runtime inventory', () => {
    const resolution = resolveAgentTaskCapabilities(
      ['repository_read'],
      ['external_connectors', 'browser'],
      {
        tools: [
          { name: 'Read' },
          { name: 'mcp__drive__search', isMcp: true },
        ],
        skills: [],
      },
    )

    expect(resolution.missingRequired).toEqual([])
    expect(resolution.unavailableOptional).toEqual(['browser'])
    expect(
      resolution.capabilities.find(
        (capability) => capability.id === 'external_connectors',
      )?.providers,
    ).toEqual([
      { kind: 'mcp', name: 'mcp__drive__search' },
    ])
  })

  it('resolves HyperFrames video capabilities from user or plugin skills', () => {
    const resolution = resolveAgentTaskCapabilities(
      ['video_composition', 'video_rendering'],
      [],
      {
        tools: [],
        skills: ['hyperframes', 'video-pack:hyperframes-cli'],
      },
    )

    expect(resolution.missingRequired).toEqual([])
    expect(
      resolution.capabilities.find(
        (capability) => capability.id === 'video_rendering',
      )?.providers,
    ).toEqual([
      { kind: 'skill', name: 'video-pack:hyperframes-cli' },
    ])
  })

  it('resolves the exact shared workflow version', () => {
    expect(
      resolveAgentTaskWorkflowPack('verified_delivery', '1.0.0'),
    ).toBe(VERIFIED_DELIVERY_WORKFLOW_PACK)
    expect(
      resolveAgentTaskWorkflowPack('verified_delivery', '0.9.0'),
    ).toBeNull()
  })

  it('resolves the versioned built-in role and rejects unknown roles', () => {
    expect(resolveAgentTaskRolePack(undefined)).toBe(
      SOFTWARE_ENGINEER_ROLE_PACK,
    )
    expect(resolveAgentTaskRolePack('software_engineer', '1.0.0')).toBe(
      SOFTWARE_ENGINEER_ROLE_PACK,
    )
    expect(resolveAgentTaskRolePack('software_engineer', '0.9.0')).toBeNull()
    expect(resolveAgentTaskRolePack('unknown')).toBeNull()
  })

  it('assembles the paused workflow stage from the legacy role marker', () => {
    const task = createTask('task-role-context')
    task.roleVersion = 'software_engineer'
    task.status = 'blocked'
    task.resumeStatus = 'execute'

    const context = buildAgentTaskRoleContext(task)

    expect(context?.roleVersion).toBe('1.0.0')
    expect(context?.currentStage?.status).toBe('execute')
    expect(context?.currentStage?.instructions[0]).toContain('planned change')
    expect(context?.permissionProfile).toBe('existing_tool_boundary')
  })

  it('assembles a distinct knowledge-worker workflow contract', () => {
    const context = buildAgentTaskRoleContext({
      role: 'knowledge_worker',
      roleVersion: KNOWLEDGE_WORKER_ROLE_PACK.version,
      status: 'scout',
    })

    expect(resolveAgentTaskRolePack('knowledge_worker')).toBe(
      KNOWLEDGE_WORKER_ROLE_PACK,
    )
    expect(context?.currentStage?.instructions[0]).toContain(
      'authoritative sources',
    )
    expect(context?.definitionOfDone).toContain(
      'Sources are traceable and assumptions are labeled.',
    )
    expect(context?.outputContracts).toContain('deliverable_artifact')
  })

  it('assembles a source-backed short-video workflow contract', () => {
    const context = buildAgentTaskRoleContext({
      role: 'short_video_operator',
      roleVersion: SHORT_VIDEO_OPERATOR_ROLE_PACK.version,
      status: 'execute',
    })

    expect(resolveAgentTaskRolePack('short_video_operator')).toBe(
      SHORT_VIDEO_OPERATOR_ROLE_PACK,
    )
    expect(context?.currentStage?.instructions[0]).toContain('storyboard')
    expect(context?.outputContracts).toContain('short_video_deliverable')
  })
  it('keeps every built-in role version and workflow contract complete', () => {
    const versions = AGENT_TASK_ROLE_PACKS.map(
      (pack) => `${pack.id}@${pack.version}`,
    )
    expect(new Set(versions).size).toBe(versions.length)

    for (const pack of AGENT_TASK_ROLE_PACKS) {
      const workflow = resolveAgentTaskWorkflowPack(
        pack.workflow.id,
        pack.workflow.version,
      )
      expect(workflow).not.toBeNull()
      if (!workflow) throw new Error(`Missing workflow for ${pack.id}`)
      for (const status of workflow.stages) {
        expect(pack.stageInstructions[status]?.length).toBeGreaterThan(0)
      }
      expect(pack.capabilities.required.length).toBeGreaterThan(0)
      expect(pack.definitionOfDone.length).toBeGreaterThan(0)
      expect(pack.outputContracts.length).toBeGreaterThan(0)
    }
  })
})

describe('JsonlAgentTaskEventLog', () => {
  it('backfills the legacy role version during replay', () => {
    const task = createTask('task-legacy')
    const { roleVersion: _roleVersion, ...legacyTask } = task

    const reduced = reduceAgentTaskEvents([{
      schemaVersion: 1,
      eventId: 'event-1',
      sequence: 1,
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      type: 'task_created',
      timestamp: task.createdAt,
      payload: { task: legacyTask },
    }])

    expect(reduced.roleVersion).toBe('software_engineer')
    expect(reduced.definitionSnapshot).toBeUndefined()
  })

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

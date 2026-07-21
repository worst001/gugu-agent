import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js'
import { setAgentTaskRuntimeForTests } from '../../agentTask/runtime.js'
import { handleAgentTasksApi } from '../../server/api/agent-tasks.js'
import { asSessionId } from '../../types/ids.js'
import { AgentTaskTool } from './AgentTaskTool.js'

const originalFlag = process.env.CC_GUGU_AGENT_TASK_RUNTIME
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR
const tempDirs: string[] = []

async function writeSession(
  configDir: string,
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  const dir = join(configDir, 'projects', '-tmp-agent-task-tool')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, sessionId + '.jsonl'),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  )
}

afterEach(async () => {
  restoreEnv('CC_GUGU_AGENT_TASK_RUNTIME', originalFlag)
  restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
  setAgentTaskRuntimeForTests(null)
  resetStateForTests()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('AgentTaskTool', () => {
  it('is hidden unless the AgentTask runtime flag is enabled', () => {
    delete process.env.CC_GUGU_AGENT_TASK_RUNTIME
    expect(AgentTaskTool.isEnabled()).toBe(false)

    process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
    expect(AgentTaskTool.isEnabled()).toBe(true)
  })

  it('keeps Role Pack capabilities subordinate to actual tool permissions', async () => {
    const prompt = await AgentTaskTool.prompt({} as never)

    expect(prompt).toContain('roleContext')
    expect(prompt).toContain('knowledge_worker')
    expect(prompt).toContain('permission flow remain authoritative')
    expect(prompt).toContain('assistantId and assistantName together')
    expect(prompt).toContain('relation "review"')
    expect(prompt).toContain('teamId or taskTemplateId')
    expect(AgentTaskTool.inputSchema.safeParse({
      action: 'provenance',
      sources: [{
        kind: 'attachment',
        messageId: 'message-1',
        attachmentIndex: 0,
        path: 'D:/unverifiable.txt',
      }],
    }).success).toBe(false)
  })

  it('blocks begin when required runtime capabilities are unavailable', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'agent-task-capability-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'agent-task-capability-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('agent-task-capability-session'))
    const context = {
      options: {
        tools: [],
        commands: [{ type: 'prompt', name: 'claude-in-chrome' }],
      },
    } as never

    const created = await AgentTaskTool.call({
      action: 'create',
      title: 'Unavailable capability task',
      goal: 'Require repository access',
      role: 'software_engineer',
    }, context)
    expect(
      created.data.roleContext?.capabilityResolution?.missingRequired,
    ).toEqual(['repository_read', 'repository_write', 'shell'])
    expect(
      created.data.roleContext?.capabilityResolution?.unavailableOptional,
    ).toEqual(['browser', 'external_connectors'])

    const begun = await AgentTaskTool.call({
      action: 'begin',
      taskId: created.data.task?.id,
    }, context)
    expect(begun.data.task?.status).toBe('blocked')
  })

  it('creates and advances a task in the current session', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'agent-task-tool-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'agent-task-tool-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('agent-task-tool-session'))

    const created = await AgentTaskTool.call(
      {
        action: 'create',
        title: 'Fix regression',
        goal: 'Restore expected behavior',
        teamId: 'software_delivery',
        taskTemplateId: 'feature_delivery',
        role: ' software_engineer ',
        requiredChecks: [
          {
            id: 'tests',
            label: 'Regression test',
            command: 'bun test',
            required: true,
          },
        ],
      },
      {} as never,
    )
    expect(created.data.task?.status).toBe('intake')
    expect(created.data.task?.sessionId).toBe('agent-task-tool-session')
    expect(created.data.task?.role).toBe('software_engineer')
    expect(created.data.task?.roleVersion).toBe('1.0.0')
    expect(created.data.roleContext?.currentStage?.status).toBe('intake')
    expect(created.data.roleContext?.permissionProfile).toBe(
      'existing_tool_boundary',
    )

    const begun = await AgentTaskTool.call(
      {
        action: 'begin',
        taskId: created.data.task?.id,
      },
      {} as never,
    )
    expect(begun.data.task?.status).toBe('scout')
    expect(begun.data.roleContext?.currentStage?.status).toBe('scout')
    expect(begun.data.roleContext?.currentStage?.instructions[0]).toContain(
      'all relevant callers',
    )

    const recalled = await AgentTaskTool.call(
      {
        action: 'recall',
        taskId: created.data.task?.id,
        query: 'expected behavior',
      },
      {} as never,
    )
    expect(recalled.data.knowledgeContext?.items).toEqual([])
    expect(recalled.data.knowledgeContext?.truncated).toBe(false)

    const listUrl = new URL(
      'http://127.0.0.1:3456/api/agent-tasks?sessionId=agent-task-tool-session',
    )
    const response = await handleAgentTasksApi(
      new Request(listUrl),
      listUrl,
      ['api', 'agent-tasks'],
    )
    const listedByApi = await response.json() as {
      tasks: Array<{ status: string }>
    }
    expect(listedByApi.tasks[0]?.status).toBe('scout')

    const failed = await AgentTaskTool.call(
      {
        action: 'fail',
        taskId: created.data.task?.id,
        reason: 'Fatal scout error',
      },
      {} as never,
    )
    expect(failed.data.task?.status).toBe('failed')
    const listed = await AgentTaskTool.call(
      { action: 'list' },
      {} as never,
    )
    expect(listed.data.tasks).toHaveLength(1)
    expect(listed.data.roleContext).toBeUndefined()
  })

  it('rejects task access from another session', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'agent-task-scope-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'agent-task-scope-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('agent-task-owner-session'))
    const otherProjectDir = await mkdtemp(
      join(tmpdir(), 'agent-task-other-project-'),
    )
    tempDirs.push(otherProjectDir)

    await expect(AgentTaskTool.call({
      action: 'create',
      title: 'Foreign workspace task',
      goal: 'Read another workspace',
      workspacePath: otherProjectDir,
      requiredChecks: [{
        id: 'tests',
        label: 'Regression test',
        command: 'bun test',
        required: true,
      }],
    }, {} as never)).rejects.toThrow(
      'workspacePath must match the current Session workspace',
    )

    const created = await AgentTaskTool.call({
      action: 'create',
      title: 'Scoped task',
      goal: 'Stay in the owning session',
      requiredChecks: [{
        id: 'tests',
        label: 'Regression test',
        command: 'bun test',
        required: true,
      }],
    }, {} as never)

    switchSession(asSessionId('agent-task-other-session'))

    await expect(AgentTaskTool.call({
      action: 'begin',
      taskId: created.data.task?.id,
    }, {} as never)).rejects.toThrow(
      'AgentTask does not belong to the current session',
    )
    const listed = await AgentTaskTool.call({ action: 'list' }, {} as never)
    expect(listed.data.tasks).toEqual([])
  })

  it('completes a knowledge-worker artifact workflow', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'agent-task-knowledge-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'agent-task-knowledge-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CC_GUGU_AGENT_TASK_RUNTIME = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    const sessionId = '55555555-5555-4555-8555-555555555555'
    switchSession(asSessionId(sessionId))
    await writeSession(configDir, sessionId, [{
      type: 'user',
      parentUuid: null,
      isSidechain: false,
      message: {
        role: 'user',
        content: 'Use the approved launch facts in the final brief.',
      },
      uuid: 'knowledge-source',
      timestamp: '2026-07-18T00:00:00.000Z',
      cwd: projectDir,
      sessionId,
    }])

    const created = await AgentTaskTool.call({
      action: 'create',
      title: 'Prepare launch brief',
      goal: 'Deliver a source-traceable launch brief for executives',
      role: 'knowledge_worker',
      requiredChecks: [{
        id: 'artifact',
        label: 'Artifact validation',
        command: 'validate deliverables/launch-brief.docx',
        required: true,
      }],
    }, {} as never)

    expect(created.data.task?.role).toBe('knowledge_worker')
    expect(created.data.roleContext?.outputContracts).toContain(
      'deliverable_artifact',
    )

    const taskId = created.data.task?.id
    await AgentTaskTool.call({ action: 'begin', taskId }, {} as never)
    const sourced = await AgentTaskTool.call({
      action: 'provenance',
      taskId,
      sources: [{
        kind: 'message',
        messageId: 'knowledge-source',
      }],
    }, {} as never)
    expect(sourced.data.provenancePack?.sourceCount).toBe(1)

    await AgentTaskTool.call({
      action: 'scout',
      taskId,
      summary: 'Collected the approved launch sources with provenance.',
    }, {} as never)

    await expect(AgentTaskTool.call({
      action: 'plan',
      taskId,
      useStageRouter: true,
    }, {} as never)).rejects.toThrow(
      'Stage Router does not support AgentTask role: knowledge_worker',
    )

    const planned = await AgentTaskTool.call({
      action: 'plan',
      taskId,
      plan: {
        summary: 'Draft, validate, and review the launch brief.',
        steps: ['Build the sourced outline', 'Create the DOCX artifact'],
        verificationCheckIds: ['artifact'],
      },
    }, {} as never)
    expect(planned.data.roleContext?.currentStage?.status).toBe('execute')

    await AgentTaskTool.call({
      action: 'execution',
      taskId,
      summary: 'Created deliverables/launch-brief.docx from approved sources.',
    }, {} as never)
    const verified = await AgentTaskTool.call({
      action: 'verification',
      taskId,
      results: [{
        checkId: 'artifact',
        command: 'validate deliverables/launch-brief.docx',
        status: 'passed',
        exitCode: 0,
        stdout: 'artifact opens and source register is present',
        stderr: '',
        startedAt: '2026-07-18T00:00:00.000Z',
        completedAt: '2026-07-18T00:00:01.000Z',
        durationMs: 1000,
      }],
      artifacts: [{
        kind: 'file',
        label: 'Launch brief',
        path: 'deliverables/launch-brief.docx',
      }],
    }, {} as never)
    expect(verified.data.task?.status).toBe('review')

    await expect(AgentTaskTool.call({
      action: 'review',
      taskId,
      useStageRouter: true,
    }, {} as never)).rejects.toThrow(
      'Stage Router does not support AgentTask role: knowledge_worker',
    )

    const completed = await AgentTaskTool.call({
      action: 'review',
      taskId,
      reviewStatus: 'passed',
      summary: 'Sources, audience fit, formatting, and privacy checks passed.',
    }, {} as never)
    expect(completed.data.task?.status).toBe('completed')
    expect(completed.data.roleContext?.currentStage).toBeUndefined()
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
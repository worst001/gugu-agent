import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
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

    const begun = await AgentTaskTool.call(
      {
        action: 'begin',
        taskId: created.data.task?.id,
      },
      {} as never,
    )
    expect(begun.data.task?.status).toBe('scout')

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
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
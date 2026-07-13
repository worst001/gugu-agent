import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTask, AgentTaskDetail } from '../types/agentTask'

const apiMocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  begin: vi.fn(),
  resolve: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('../api/agentTasks', () => ({
  agentTasksApi: apiMocks,
}))

import { useAgentTaskStore } from './agentTaskStore'

function createTask(
  overrides: Partial<AgentTask> = {},
): AgentTask {
  return {
    schemaVersion: 1,
    id: 'task-1',
    runId: 'run-1',
    attempt: 1,
    sessionId: 'session-1',
    role: 'software_engineer',
    title: 'Fix regression',
    goal: 'Restore expected behavior',
    constraints: [],
    status: 'verify',
    requiredChecks: [
      {
        id: 'tests',
        label: 'Regression tests',
        command: 'bun test',
        required: true,
      },
    ],
    warnings: [],
    recoverable: false,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:01.000Z',
    revision: 4,
    ...overrides,
  }
}

function createDetail(task: AgentTask): AgentTaskDetail {
  return {
    task,
    events: [],
  }
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset()
  useAgentTaskStore.setState({
    capabilityLoaded: false,
    enabled: false,
    sessionId: null,
    tasks: [],
    currentTask: null,
    detail: null,
    loading: false,
    actionPending: false,
    error: null,
  })
})

describe('agentTaskStore', () => {
  it('keeps the projection empty when the server flag is off', async () => {
    apiMocks.capabilities.mockResolvedValue({
      enabled: false,
      schemaVersion: 1,
      roles: ['software_engineer'],
    })

    await useAgentTaskStore.getState().fetchSessionTasks('session-1')

    expect(useAgentTaskStore.getState().enabled).toBe(false)
    expect(apiMocks.list).not.toHaveBeenCalled()
  })

  it('rebuilds the current task and detail for the active session', async () => {
    const task = createTask()
    apiMocks.capabilities.mockResolvedValue({
      enabled: true,
      schemaVersion: 1,
      roles: ['software_engineer'],
    })
    apiMocks.list.mockResolvedValue({ tasks: [task] })
    apiMocks.get.mockResolvedValue(createDetail(task))

    await useAgentTaskStore.getState().fetchSessionTasks('session-1')

    const state = useAgentTaskStore.getState()
    expect(state.currentTask?.id).toBe(task.id)
    expect(state.detail?.task.revision).toBe(4)
    expect(apiMocks.list).toHaveBeenCalledWith('session-1')
  })

  it('ignores an older polling response that finishes last', async () => {
    const older = createTask({ revision: 4, status: 'execute' })
    const newer = createTask({ revision: 5, status: 'verify' })
    let resolveOlder: ((value: { tasks: AgentTask[] }) => void) | undefined

    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
    })
    apiMocks.list
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveOlder = resolve }),
      )
      .mockResolvedValueOnce({ tasks: [newer] })
    apiMocks.get.mockResolvedValue(createDetail(newer))

    const first = useAgentTaskStore.getState().fetchSessionTasks('session-1')
    const second = useAgentTaskStore.getState().fetchSessionTasks('session-1')
    await second
    resolveOlder?.({ tasks: [older] })
    await first

    expect(useAgentTaskStore.getState().currentTask?.revision).toBe(5)
    expect(useAgentTaskStore.getState().detail?.task.revision).toBe(5)
  })
  it('resumes an interrupted task and refreshes from server state', async () => {
    const interrupted = createTask({
      status: 'interrupted',
      recoverable: true,
    })
    const resumed = createTask({
      runId: 'run-2',
      attempt: 2,
      status: 'intake',
      revision: 6,
    })
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
      tasks: [interrupted],
      currentTask: interrupted,
      detail: createDetail(interrupted),
    })
    apiMocks.resume.mockResolvedValue({ task: resumed })
    apiMocks.list.mockResolvedValue({ tasks: [resumed] })
    apiMocks.get.mockResolvedValue(createDetail(resumed))

    await useAgentTaskStore.getState().resumeCurrentTask()

    expect(apiMocks.resume).toHaveBeenCalledWith(interrupted.id)
    expect(useAgentTaskStore.getState().currentTask?.attempt).toBe(2)
    expect(useAgentTaskStore.getState().currentTask?.status).toBe('intake')
  })
})
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentTask,
  AgentTaskDetail,
  WorkspaceKnowledgeMap,
} from '../types/agentTask'

const apiMocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  knowledgeMap: vi.fn(),
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
    roleVersion: '1.0.0',
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
    roles: [],
    rolePacks: [],
    sessionId: null,
    tasks: [],
    currentTask: null,
    detail: null,
    knowledgeMap: null,
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
      rolePacks: [
        {
          id: 'software_engineer',
          version: '1.0.0',
          displayName: 'Software Engineer',
          mission: 'Deliver verified software changes.',
          responsibilities: ['Inspect existing code.'],
        },
      ],
    })
    apiMocks.list.mockResolvedValue({ tasks: [task] })
    apiMocks.get.mockResolvedValue(createDetail(task))

    await useAgentTaskStore.getState().fetchSessionTasks('session-1')

    const state = useAgentTaskStore.getState()
    expect(state.currentTask?.id).toBe(task.id)
    expect(state.detail?.task.revision).toBe(4)
    expect(state.roles).toEqual(['software_engineer'])
    expect(state.rolePacks[0]?.id).toBe('software_engineer')
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

  it('ignores an older detail refresh after the task advances', async () => {
    const older = createTask({ revision: 4, status: 'execute' })
    const newer = createTask({ revision: 5, status: 'verify' })
    let resolveRequest: ((value: AgentTaskDetail) => void) | undefined
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
      tasks: [older],
      currentTask: older,
      detail: createDetail(older),
    })
    apiMocks.get.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRequest = resolve }),
    )

    const refresh = useAgentTaskStore.getState().refreshCurrentTask()
    useAgentTaskStore.setState({
      tasks: [newer],
      currentTask: newer,
      detail: createDetail(newer),
    })
    resolveRequest?.(createDetail(older))
    await refresh

    expect(useAgentTaskStore.getState().currentTask?.revision).toBe(5)
    expect(useAgentTaskStore.getState().detail?.task.revision).toBe(5)
  })

  it('does not return to a previous session when an action finishes late', async () => {
    const task = createTask({ status: 'intake' })
    let resolveBegin: ((value: { task: AgentTask }) => void) | undefined
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
      tasks: [task],
      currentTask: task,
      detail: createDetail(task),
    })
    apiMocks.begin.mockImplementationOnce(
      () => new Promise((resolve) => { resolveBegin = resolve }),
    )
    apiMocks.list.mockResolvedValue({ tasks: [] })

    const action = useAgentTaskStore.getState().beginCurrentTask()
    await useAgentTaskStore.getState().fetchSessionTasks('session-2')
    resolveBegin?.({ task: createTask({ status: 'scout', revision: 5 }) })
    await action

    expect(useAgentTaskStore.getState().sessionId).toBe('session-2')
    expect(useAgentTaskStore.getState().currentTask).toBeNull()
    expect(useAgentTaskStore.getState().actionPending).toBe(false)
    expect(apiMocks.list).toHaveBeenCalledOnce()
    expect(apiMocks.list).toHaveBeenCalledWith('session-2')
  })

  it('ignores a knowledge-map failure after the session changes', async () => {
    const task = createTask()
    let rejectRequest: ((reason?: unknown) => void) | undefined
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
      tasks: [task],
      currentTask: task,
      detail: createDetail(task),
    })
    apiMocks.knowledgeMap.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectRequest = reject }),
    )

    const refresh = useAgentTaskStore.getState().refreshKnowledgeMap()
    useAgentTaskStore.setState({
      sessionId: 'session-2',
      tasks: [],
      currentTask: null,
      detail: null,
      knowledgeMap: null,
      error: null,
    })
    rejectRequest?.(new Error('stale map failure'))
    await refresh

    expect(useAgentTaskStore.getState().error).toBeNull()
  })

  it('ignores a knowledge-map response from an older task revision', async () => {
    const task = createTask({ revision: 4 })
    const knowledgeMap: WorkspaceKnowledgeMap = {
      workspaceId: 'ws_v1_project',
      generatedAt: '2026-07-18T00:00:00.000Z',
      summary: {
        taskCount: 0,
        candidateCount: 0,
        sourceCount: 0,
        artifactCount: 0,
        potentialConflictCount: 0,
        truncated: false,
      },
      tasks: [],
      sources: [],
      artifacts: [],
      knowledgeItems: [],
      potentialConflicts: [],
    }
    let resolveRequest:
      | ((value: { knowledgeMap: WorkspaceKnowledgeMap }) => void)
      | undefined
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      sessionId: 'session-1',
      tasks: [task],
      currentTask: task,
      detail: createDetail(task),
    })
    apiMocks.knowledgeMap.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRequest = resolve }),
    )

    const refresh = useAgentTaskStore.getState().refreshKnowledgeMap()
    useAgentTaskStore.setState({
      currentTask: createTask({ revision: 5 }),
      knowledgeMap: null,
    })
    resolveRequest?.({ knowledgeMap })
    await refresh

    expect(useAgentTaskStore.getState().knowledgeMap).toBeNull()
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
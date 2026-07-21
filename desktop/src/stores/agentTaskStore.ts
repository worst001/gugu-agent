import { create } from 'zustand'
import { agentTasksApi } from '../api/agentTasks'
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTaskRole,
  AgentTaskRoleSummary,
  AgentTaskTeamSummary,
  WorkspaceKnowledgeMap,
} from '../types/agentTask'

type AgentTaskStore = {
  capabilityLoaded: boolean
  enabled: boolean
  roles: AgentTaskRole[]
  rolePacks: AgentTaskRoleSummary[]
  teams: AgentTaskTeamSummary[]
  sessionId: string | null
  tasks: AgentTask[]
  currentTask: AgentTask | null
  detail: AgentTaskDetail | null
  knowledgeMap: WorkspaceKnowledgeMap | null
  loading: boolean
  actionPending: boolean
  error: string | null
  loadCapabilities: () => Promise<boolean>
  fetchSessionTasks: (sessionId: string) => Promise<void>
  refreshCurrentTask: () => Promise<void>
  refreshKnowledgeMap: () => Promise<void>
  beginCurrentTask: () => Promise<void>
  blockCurrentTask: (reason: string) => Promise<void>
  resolveCurrentTask: () => Promise<void>
  resumeCurrentTask: () => Promise<void>
  clear: () => void
}

function isTerminal(task: AgentTask): boolean {
  return (
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled'
  )
}

function selectCurrentTask(tasks: AgentTask[]): AgentTask | null {
  return tasks.find((task) => !isTerminal(task)) ?? tasks[0] ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AgentTask request failed'
}

let fetchSequence = 0
let actionSequence = 0

export const useAgentTaskStore = create<AgentTaskStore>((set, get) => ({
  capabilityLoaded: false,
  enabled: false,
  roles: [],
  rolePacks: [],
  teams: [],
  sessionId: null,
  tasks: [],
  currentTask: null,
  detail: null,
  knowledgeMap: null,
  loading: false,
  actionPending: false,
  error: null,

  loadCapabilities: async () => {
    try {
      const capability = await agentTasksApi.capabilities()
      set({
        capabilityLoaded: true,
        enabled: capability.enabled,
        roles: capability.roles,
        rolePacks: capability.rolePacks ?? [],
        teams: capability.teams ?? [],
        ...(!capability.enabled
          ? {
              tasks: [],
              currentTask: null,
              detail: null,
              knowledgeMap: null,
            }
          : {}),
        error: null,
      })
      return capability.enabled
    } catch (error) {
      set({
        capabilityLoaded: false,
        enabled: false,
        roles: [],
        rolePacks: [],
        teams: [],
        error: errorMessage(error),
      })
      return false
    }
  },

  fetchSessionTasks: async (sessionId) => {
    const sequence = ++fetchSequence
    if (get().sessionId !== sessionId) {
      actionSequence += 1
      set({
        sessionId,
        tasks: [],
        currentTask: null,
        detail: null,
        knowledgeMap: null,
        actionPending: false,
        error: null,
      })
    }

    const enabled = get().capabilityLoaded
      ? get().enabled
      : await get().loadCapabilities()
    if (
      !enabled ||
      get().sessionId !== sessionId ||
      sequence !== fetchSequence
    ) return

    set({ loading: true })
    try {
      const { tasks } = await agentTasksApi.list(sessionId)
      if (
        get().sessionId !== sessionId ||
        sequence !== fetchSequence
      ) return

      const currentTask = selectCurrentTask(tasks)
      const existingDetail = get().detail
      const detailIsCurrent =
        currentTask &&
        existingDetail?.task.id === currentTask.id &&
        existingDetail.task.revision === currentTask.revision

      const knowledgeMap =
        currentTask?.id === get().currentTask?.id
          ? get().knowledgeMap
          : null

      set({
        tasks,
        currentTask,
        detail: detailIsCurrent ? existingDetail : null,
        knowledgeMap,
        error: null,
      })

      if (!currentTask || detailIsCurrent) return
      const detail = await agentTasksApi.get(currentTask.id)
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === detail.task.id &&
        get().currentTask?.revision === detail.task.revision &&
        sequence === fetchSequence
      ) {
        set({ detail })
      }
    } catch (error) {
      if (
        get().sessionId === sessionId &&
        sequence === fetchSequence
      ) {
        set({ error: errorMessage(error) })
      }
    } finally {
      if (
        get().sessionId === sessionId &&
        sequence === fetchSequence
      ) {
        set({ loading: false })
      }
    }
  },

  refreshCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    const revision = task.revision
    try {
      const detail = await agentTasksApi.get(task.id)
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === task.id &&
        get().currentTask?.revision === revision
      ) {
        set({
          detail,
          currentTask: detail.task,
          tasks: get().tasks.map((item) =>
            item.id === task.id ? detail.task : item,
          ),
          error: null,
        })
      }
    } catch (error) {
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === task.id &&
        get().currentTask?.revision === revision
      ) {
        set({ error: errorMessage(error) })
      }
    }
  },

  refreshKnowledgeMap: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    try {
      const { knowledgeMap } = await agentTasksApi.knowledgeMap(task.id)
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === task.id &&
        get().currentTask?.revision === task.revision
      ) {
        set({ knowledgeMap, error: null })
      }
    } catch (error) {
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === task.id &&
        get().currentTask?.revision === task.revision
      ) {
        set({ error: errorMessage(error) })
      }
    }
  },

  beginCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    const sequence = ++actionSequence
    set({ actionPending: true })
    try {
      await agentTasksApi.begin(task.id)
      if (get().sessionId === sessionId && sequence === actionSequence) {
        await get().fetchSessionTasks(sessionId)
      }
    } catch (error) {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ error: errorMessage(error) })
      }
    } finally {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ actionPending: false })
      }
    }
  },

  blockCurrentTask: async (reason) => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (
      !task ||
      !sessionId ||
      task.status === 'blocked' ||
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    ) return
    const sequence = ++actionSequence
    set({ actionPending: true })
    try {
      await agentTasksApi.block(task.id, reason)
      if (get().sessionId === sessionId && sequence === actionSequence) {
        await get().fetchSessionTasks(sessionId)
      }
    } catch (error) {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ error: errorMessage(error) })
      }
    } finally {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ actionPending: false })
      }
    }
  },

  resolveCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    const sequence = ++actionSequence
    set({ actionPending: true })
    try {
      await agentTasksApi.resolve(task.id)
      if (get().sessionId === sessionId && sequence === actionSequence) {
        await get().fetchSessionTasks(sessionId)
      }
    } catch (error) {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ error: errorMessage(error) })
      }
    } finally {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ actionPending: false })
      }
    }
  },

  resumeCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    const sequence = ++actionSequence
    set({ actionPending: true })
    try {
      await agentTasksApi.resume(task.id)
      if (get().sessionId === sessionId && sequence === actionSequence) {
        await get().fetchSessionTasks(sessionId)
      }
    } catch (error) {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ error: errorMessage(error) })
      }
    } finally {
      if (get().sessionId === sessionId && sequence === actionSequence) {
        set({ actionPending: false })
      }
    }
  },

  clear: () => {
    fetchSequence += 1
    actionSequence += 1
    set({
      sessionId: null,
      tasks: [],
      currentTask: null,
      detail: null,
      knowledgeMap: null,
      loading: false,
      actionPending: false,
      error: null,
    })
  },
}))
import { create } from 'zustand'
import { agentTasksApi } from '../api/agentTasks'
import type {
  AgentTask,
  AgentTaskDetail,
} from '../types/agentTask'

type AgentTaskStore = {
  capabilityLoaded: boolean
  enabled: boolean
  sessionId: string | null
  tasks: AgentTask[]
  currentTask: AgentTask | null
  detail: AgentTaskDetail | null
  loading: boolean
  actionPending: boolean
  error: string | null
  loadCapabilities: () => Promise<boolean>
  fetchSessionTasks: (sessionId: string) => Promise<void>
  refreshCurrentTask: () => Promise<void>
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

export const useAgentTaskStore = create<AgentTaskStore>((set, get) => ({
  capabilityLoaded: false,
  enabled: false,
  sessionId: null,
  tasks: [],
  currentTask: null,
  detail: null,
  loading: false,
  actionPending: false,
  error: null,

  loadCapabilities: async () => {
    try {
      const capability = await agentTasksApi.capabilities()
      set({
        capabilityLoaded: true,
        enabled: capability.enabled,
        ...(!capability.enabled
          ? {
              tasks: [],
              currentTask: null,
              detail: null,
            }
          : {}),
        error: null,
      })
      return capability.enabled
    } catch (error) {
      set({
        capabilityLoaded: false,
        enabled: false,
        error: errorMessage(error),
      })
      return false
    }
  },

  fetchSessionTasks: async (sessionId) => {
    const sequence = ++fetchSequence
    if (get().sessionId !== sessionId) {
      set({
        sessionId,
        tasks: [],
        currentTask: null,
        detail: null,
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

      set({
        tasks,
        currentTask,
        detail: detailIsCurrent ? existingDetail : null,
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
    try {
      const detail = await agentTasksApi.get(task.id)
      if (
        get().sessionId === sessionId &&
        get().currentTask?.id === task.id
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
      set({ error: errorMessage(error) })
    }
  },

  beginCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    set({ actionPending: true })
    try {
      await agentTasksApi.begin(task.id)
      await get().fetchSessionTasks(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionPending: false })
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
    set({ actionPending: true })
    try {
      await agentTasksApi.block(task.id, reason)
      await get().fetchSessionTasks(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionPending: false })
    }
  },

  resolveCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    set({ actionPending: true })
    try {
      await agentTasksApi.resolve(task.id)
      await get().fetchSessionTasks(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionPending: false })
    }
  },

  resumeCurrentTask: async () => {
    const task = get().currentTask
    const sessionId = get().sessionId
    if (!task || !sessionId) return
    set({ actionPending: true })
    try {
      await agentTasksApi.resume(task.id)
      await get().fetchSessionTasks(sessionId)
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ actionPending: false })
    }
  },

  clear: () => {
    fetchSequence += 1
    set({
      sessionId: null,
      tasks: [],
      currentTask: null,
      detail: null,
      loading: false,
      actionPending: false,
      error: null,
    })
  },
}))
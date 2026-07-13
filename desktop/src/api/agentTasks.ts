import type {
  AgentTask,
  AgentTaskCapabilities,
  AgentTaskDetail,
} from '../types/agentTask'
import { api } from './client'

type AgentTasksResponse = { tasks: AgentTask[] }
type AgentTaskResponse = { task: AgentTask }

export const agentTasksApi = {
  capabilities() {
    return api.get<AgentTaskCapabilities>(
      '/api/agent-tasks/capabilities',
    )
  },

  list(sessionId?: string) {
    const query = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : ''
    return api.get<AgentTasksResponse>(`/api/agent-tasks${query}`)
  },

  get(taskId: string) {
    return api.get<AgentTaskDetail>(`/api/agent-tasks/${taskId}`)
  },

  begin(taskId: string) {
    return api.post<AgentTaskResponse>(
      `/api/agent-tasks/${taskId}/begin`,
      {},
    )
  },

  block(taskId: string, reason: string) {
    return api.post<AgentTaskResponse>(
      `/api/agent-tasks/${taskId}/block`,
      { reason },
    )
  },

  resolve(taskId: string) {
    return api.post<AgentTaskResponse>(
      `/api/agent-tasks/${taskId}/resolve`,
      {},
    )
  },

  resume(taskId: string) {
    return api.post<AgentTaskResponse>(
      `/api/agent-tasks/${taskId}/resume`,
      {},
    )
  },

  cancel(taskId: string, reason?: string) {
    return api.post<AgentTaskResponse>(
      `/api/agent-tasks/${taskId}/cancel`,
      { reason },
    )
  },
}
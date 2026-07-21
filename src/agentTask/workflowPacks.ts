import type { AgentTaskStatus } from './types.js'

export type AgentTaskWorkflowRef = {
  id: string
  version: string
}

export type AgentTaskWorkflowPack = AgentTaskWorkflowRef & {
  stages: readonly AgentTaskStatus[]
}

export const VERIFIED_DELIVERY_WORKFLOW_PACK = {
  id: 'verified_delivery',
  version: '1.0.0',
  stages: ['intake', 'scout', 'plan', 'execute', 'verify', 'review'],
} as const satisfies AgentTaskWorkflowPack

export const VERIFIED_DELIVERY_WORKFLOW_REF = {
  id: VERIFIED_DELIVERY_WORKFLOW_PACK.id,
  version: VERIFIED_DELIVERY_WORKFLOW_PACK.version,
} as const satisfies AgentTaskWorkflowRef

export const AGENT_TASK_WORKFLOW_PACKS: readonly AgentTaskWorkflowPack[] = [
  VERIFIED_DELIVERY_WORKFLOW_PACK,
]

export function resolveAgentTaskWorkflowPack(
  id: string,
  version: string,
): AgentTaskWorkflowPack | null {
  return AGENT_TASK_WORKFLOW_PACKS.find(
    (pack) => pack.id === id && pack.version === version,
  ) ?? null
}

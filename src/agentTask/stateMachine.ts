import type { AgentTaskStatus } from './types.js'

const WORKFLOW_STATUSES = [
  'intake',
  'scout',
  'plan',
  'execute',
  'verify',
  'review',
] as const

const ALLOWED_TRANSITIONS: Record<
  AgentTaskStatus,
  readonly AgentTaskStatus[]
> = {
  intake: ['scout', 'blocked', 'failed', 'interrupted', 'cancelled'],
  scout: ['plan', 'blocked', 'failed', 'interrupted', 'cancelled'],
  plan: ['execute', 'blocked', 'failed', 'interrupted', 'cancelled'],
  execute: ['verify', 'blocked', 'failed', 'interrupted', 'cancelled'],
  verify: ['review', 'blocked', 'failed', 'interrupted', 'cancelled'],
  review: ['completed', 'blocked', 'interrupted', 'cancelled'],
  blocked: ['failed', 'interrupted', 'cancelled'],
  interrupted: ['intake', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export class InvalidAgentTaskTransitionError extends Error {
  constructor(from: AgentTaskStatus, to: AgentTaskStatus) {
    super(`Invalid AgentTask transition: ${from} -> ${to}`)
    this.name = 'InvalidAgentTaskTransitionError'
  }
}

export function isWorkflowStatus(
  status: AgentTaskStatus,
): status is (typeof WORKFLOW_STATUSES)[number] {
  return WORKFLOW_STATUSES.includes(
    status as (typeof WORKFLOW_STATUSES)[number],
  )
}

export function isActiveAgentTaskStatus(status: AgentTaskStatus): boolean {
  return isWorkflowStatus(status) || status === 'blocked'
}

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export function canTransitionAgentTask(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
  resumeStatus?: AgentTaskStatus,
): boolean {
  if (from === 'blocked' && resumeStatus === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function assertAgentTaskTransition(
  from: AgentTaskStatus,
  to: AgentTaskStatus,
  resumeStatus?: AgentTaskStatus,
): void {
  if (!canTransitionAgentTask(from, to, resumeStatus)) {
    throw new InvalidAgentTaskTransitionError(from, to)
  }
}
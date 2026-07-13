export const AGENT_TASK_STATUSES = [
  'intake',
  'scout',
  'plan',
  'execute',
  'verify',
  'review',
  'blocked',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
] as const

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number]

export type AgentTaskRole = 'software_engineer'

export type VerificationCheckSpec = {
  id: string
  label: string
  command: string
  required: boolean
  timeoutMs?: number
}

export type VerificationResultStatus =
  | 'passed'
  | 'failed'
  | 'timed_out'
  | 'interrupted'

export type VerificationResult = {
  checkId: string
  command: string
  status: VerificationResultStatus
  exitCode: number | null
  stdout: string
  stderr: string
  startedAt: string
  completedAt: string
  durationMs: number
}

export type EvidenceArtifact = {
  kind: 'file' | 'log' | 'report'
  label: string
  path: string
}

export type EvidencePack = {
  schemaVersion: 1
  id: string
  taskId: string
  runId: string
  attempt: number
  createdAt: string
  checks: VerificationResult[]
  changedFiles: string[]
  artifacts: EvidenceArtifact[]
}

export type AgentTaskReviewStatus = 'passed' | 'warning' | 'unavailable'

export type AgentTaskReview = {
  status: AgentTaskReviewStatus
  summary: string
  findings: string[]
  completedAt: string
}

export type AgentTaskPlan = {
  summary: string
  steps: string[]
  verificationCheckIds: string[]
}

export type AgentTask = {
  schemaVersion: 1
  id: string
  runId: string
  attempt: number
  sessionId?: string
  role: AgentTaskRole
  title: string
  goal: string
  constraints: string[]
  workspacePath?: string
  status: AgentTaskStatus
  resumeStatus?: Exclude<
    AgentTaskStatus,
    'blocked' | 'completed' | 'failed' | 'cancelled'
  >
  requiredChecks: VerificationCheckSpec[]
  scoutSummary?: string
  plan?: AgentTaskPlan
  executionSummary?: string
  evidencePackId?: string
  review?: AgentTaskReview
  warnings: string[]
  recoverable: boolean
  createdAt: string
  updatedAt: string
  revision: number
}

export type CreateAgentTaskInput = {
  title: string
  goal: string
  sessionId?: string
  workspacePath?: string
  constraints?: string[]
  role?: AgentTaskRole
  requiredChecks?: VerificationCheckSpec[]
}

export const AGENT_TASK_EVENT_TYPES = [
  'task_created',
  'status_changed',
  'scout_recorded',
  'plan_recorded',
  'execution_recorded',
  'permission_blocked',
  'verification_finished',
  'evidence_persisted',
  'review_finished',
  'task_interrupted',
  'task_resumed',
  'task_completed',
  'task_failed',
  'task_cancelled',
] as const

export type AgentTaskEventType = (typeof AGENT_TASK_EVENT_TYPES)[number]

export type AgentTaskEvent = {
  schemaVersion: 1
  eventId: string
  sequence: number
  taskId: string
  runId: string
  attempt: number
  type: AgentTaskEventType
  timestamp: string
  payload: Record<string, unknown>
}

export type AppendAgentTaskEventInput = Omit<
  AgentTaskEvent,
  'schemaVersion' | 'eventId' | 'sequence' | 'timestamp'
> & {
  timestamp?: string
}

export type AgentTaskDetail = {
  task: AgentTask
  events: AgentTaskEvent[]
  evidencePack?: EvidencePack
}
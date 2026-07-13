export type AgentTaskStatus =
  | 'intake'
  | 'scout'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'review'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type VerificationCheckSpec = {
  id: string
  label: string
  command: string
  required: boolean
  timeoutMs?: number
}

export type VerificationResult = {
  checkId: string
  command: string
  status: 'passed' | 'failed' | 'timed_out' | 'interrupted'
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

export type AgentTaskReview = {
  status: 'passed' | 'warning' | 'unavailable'
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
  role: 'software_engineer'
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

export type AgentTaskEvent = {
  schemaVersion: 1
  eventId: string
  sequence: number
  taskId: string
  runId: string
  attempt: number
  type: string
  timestamp: string
  payload: Record<string, unknown>
}

export type AgentTaskDetail = {
  task: AgentTask
  events: AgentTaskEvent[]
  evidencePack?: EvidencePack
}

export type AgentTaskCapabilities = {
  enabled: boolean
  schemaVersion: number
  roles: string[]
}
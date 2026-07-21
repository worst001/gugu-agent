import type { AgentTaskCapabilityId } from './capabilities.js'

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

export const AGENT_TASK_ROLES = [
  'software_engineer',
  'knowledge_worker',
  'short_video_operator',
] as const

export type AgentTaskRole = (typeof AGENT_TASK_ROLES)[number]

export type AgentTaskDefinitionRef = {
  id: string
  version: string
}

export type AgentTaskAssistantOverlaySnapshot = {
  id: string
  name: string
  baseRole: AgentTaskRole
  sourceUpdatedAt: string
  instructions: string
}

export type AgentTaskRoleAssignmentSnapshot = {
  slotId: string
  kind: 'primary' | 'collaborator'
  role: AgentTaskRole
  roleVersion: string
  assistant?: AgentTaskAssistantOverlaySnapshot
}

export type AgentTaskDefinitionSnapshot = {
  schemaVersion: 1
  team?: AgentTaskDefinitionRef
  taskTemplate?: AgentTaskDefinitionRef
  workflow: AgentTaskDefinitionRef
  roles: AgentTaskRoleAssignmentSnapshot[]
  capabilities: {
    required: AgentTaskCapabilityId[]
    optional: AgentTaskCapabilityId[]
  }
  completionContract: {
    definitionOfDone: string[]
    outputContracts: string[]
  }
}

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

export type SourceLocator =
  | { kind: 'file'; path: string; toolUseId: string }
  | {
      kind: 'attachment'
      messageId: string
      attachmentIndex: number
      path?: string
    }
  | { kind: 'message'; messageId: string }
  | { kind: 'tool_result'; toolUseId: string; messageId?: string }
  | { kind: 'url'; url: string; toolUseId: string }

export type SourceRef = {
  id: string
  sessionId: string
  title: string
  locator: SourceLocator
  observedAt: string
  contentHash?: string
  excerpt?: string
}

export type ProvenancePack = {
  schemaVersion: 1
  id: string
  taskId: string
  runId: string
  attempt: number
  workspaceId: string
  sessionId: string
  createdAt: string
  sources: SourceRef[]
}

export type KnowledgeCandidateKind = 'task_outcome' | 'review_finding'

export type KnowledgeCandidate = {
  id: string
  kind: KnowledgeCandidateKind
  state: 'pending'
  text: string
  createdAt: string
}

export type KnowledgeCandidatePack = {
  schemaVersion: 1
  id: string
  taskId: string
  runId: string
  attempt: number
  workspaceId: string
  sessionId?: string
  evidencePackId: string
  provenancePackId?: string
  artifactPaths: string[]
  createdAt: string
  candidates: KnowledgeCandidate[]
}

export type KnowledgeContextItem = {
  candidateId: string
  kind: KnowledgeCandidateKind
  state: 'pending'
  text: string
  createdAt: string
  sourceTaskId: string
  sourceTaskTitle: string
  evidencePackId: string
  provenancePackId?: string
  artifactPaths: string[]
}

export type KnowledgeContext = {
  query: string
  items: KnowledgeContextItem[]
  truncated: boolean
}

export type WorkspaceKnowledgeTask = {
  taskId: string
  sessionId?: string
  title: string
  role: AgentTaskRole
  assistantName?: string
  parentTaskId?: string
  relation?: AgentTaskRelation
  completedAt: string
  candidateCount: number
  sourceCount: number
  artifactPaths: string[]
}

export type WorkspaceKnowledgeSource = {
  sourceId: string
  title: string
  kind: SourceLocator['kind']
  locator: SourceLocator
  observedAt: string
  taskIds: string[]
}

export type WorkspaceKnowledgeArtifact = {
  path: string
  taskIds: string[]
}

export type WorkspaceKnowledgeItem = KnowledgeCandidate & {
  taskId: string
  taskTitle: string
}

export type PotentialKnowledgeConflict = {
  kind: 'shared_artifact_path'
  artifactPath: string
  taskIds: string[]
}

export type WorkspaceKnowledgeMap = {
  workspaceId: string
  generatedAt: string
  summary: {
    taskCount: number
    candidateCount: number
    sourceCount: number
    artifactCount: number
    potentialConflictCount: number
    truncated: boolean
  }
  tasks: WorkspaceKnowledgeTask[]
  sources: WorkspaceKnowledgeSource[]
  artifacts: WorkspaceKnowledgeArtifact[]
  knowledgeItems: WorkspaceKnowledgeItem[]
  potentialConflicts: PotentialKnowledgeConflict[]
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

export type AgentTaskRelation = 'review'

export type AgentTask = {
  schemaVersion: 1
  id: string
  runId: string
  attempt: number
  sessionId?: string
  role: AgentTaskRole
  roleVersion: string
  definitionSnapshot?: AgentTaskDefinitionSnapshot
  assistantId?: string
  assistantName?: string
  parentTaskId?: string
  relation?: AgentTaskRelation
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
  teamId?: string
  taskTemplateId?: string
  role?: string
  assistantId?: string
  assistantName?: string
  assistantOverlay?: AgentTaskAssistantOverlaySnapshot
  parentTaskId?: string
  relation?: AgentTaskRelation
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
  provenancePack?: ProvenancePack
  knowledgeCandidatePack?: KnowledgeCandidatePack
}
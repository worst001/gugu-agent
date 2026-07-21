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

export type AgentTaskRole =
  | 'software_engineer'
  | 'knowledge_worker'
  | 'short_video_operator'

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
    required: string[]
    optional: string[]
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

export type WorkspaceKnowledgeItem = {
  id: string
  kind: 'task_outcome' | 'review_finding'
  state: 'pending'
  text: string
  createdAt: string
  taskId: string
  taskTitle: string
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
  potentialConflicts: Array<{
    kind: 'shared_artifact_path'
    artifactPath: string
    taskIds: string[]
  }>
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
  provenancePack?: ProvenancePack
}

export type AgentTaskRoleSummary = {
  id: AgentTaskRole
  version: string
  displayName: string
  mission: string
  responsibilities: string[]
}

export type AgentTaskTemplateSummary = {
  id: string
  version: string
  displayName: string
  description: string
  kind: 'delivery' | 'independent_review'
  primaryRole: AgentTaskRole
  capabilities?: {
    required?: string[]
    optional?: string[]
  }
}

export type AgentTaskTeamSummary = {
  id: string
  version: string
  displayName: string
  mission: string
  primaryRole: AgentTaskRole
  taskTemplates: AgentTaskTemplateSummary[]
}

export type AgentTaskCapabilities = {
  enabled: boolean
  schemaVersion: number
  roles: AgentTaskRole[]
  rolePacks?: AgentTaskRoleSummary[]
  teams?: AgentTaskTeamSummary[]
}

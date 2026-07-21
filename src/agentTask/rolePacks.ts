import type {
  AgentTask,
  AgentTaskAssistantOverlaySnapshot,
  AgentTaskRole,
  AgentTaskStatus,
} from './types.js'
import type {
  AgentTaskCapabilityId,
  AgentTaskCapabilityInventory,
} from './capabilities.js'
import { resolveAgentTaskCapabilities } from './capabilities.js'
import type { AgentTaskWorkflowRef } from './workflowPacks.js'
import {
  resolveAgentTaskWorkflowPack,
  VERIFIED_DELIVERY_WORKFLOW_REF,
} from './workflowPacks.js'

export type AgentTaskRolePack = {
  id: AgentTaskRole
  version: string
  displayName: string
  mission: string
  responsibilities: readonly string[]
  nonGoals: readonly string[]
  workflow: AgentTaskWorkflowRef
  stageInstructions: Partial<Record<AgentTaskStatus, readonly string[]>>
  capabilities: {
    required: readonly AgentTaskCapabilityId[]
    optional: readonly AgentTaskCapabilityId[]
  }
  permissionProfile: 'existing_tool_boundary'
  definitionOfDone: readonly string[]
  outputContracts: readonly string[]
}

export type AgentTaskRoleContext = {
  role: AgentTaskRole
  roleVersion: string
  displayName: string
  mission: string
  responsibilities: string[]
  nonGoals: string[]
  workflow: AgentTaskStatus[]
  currentStage?: {
    status: AgentTaskStatus
    instructions: string[]
  }
  toolCapabilities: {
    required: AgentTaskCapabilityId[]
    optional: AgentTaskCapabilityId[]
  }
  capabilityResolution?: {
    available: AgentTaskCapabilityId[]
    missingRequired: AgentTaskCapabilityId[]
    unavailableOptional: AgentTaskCapabilityId[]
  }
  assistantOverlay?: AgentTaskAssistantOverlaySnapshot
  permissionProfile: AgentTaskRolePack['permissionProfile']
  definitionOfDone: string[]
  outputContracts: string[]
}

export const DEFAULT_AGENT_TASK_ROLE: AgentTaskRole = 'software_engineer'

export const SOFTWARE_ENGINEER_ROLE_PACK = {
  id: 'software_engineer',
  version: '1.0.0',
  displayName: 'Software Engineer',
  mission:
    'Deliver maintainable, verified software changes with minimal unrelated impact.',
  responsibilities: [
    'Inspect existing code and callers before editing.',
    'Implement the smallest correct change.',
    'Run declared verification and retain evidence.',
  ],
  nonGoals: [
    'Do not bypass existing tool permissions.',
    'Do not modify unrelated files.',
    'Do not claim completion without passing required checks.',
  ],
  workflow: VERIFIED_DELIVERY_WORKFLOW_REF,
  stageInstructions: {
    intake: [
      'Confirm the goal, constraints, workspace, and required checks before starting.',
    ],
    scout: [
      'Inspect the existing implementation, all relevant callers, tests, and local task knowledge before editing.',
      'Record the root cause and affected behavior, not only the reported symptom.',
    ],
    plan: [
      'Choose the smallest change that fixes the root cause and name the checks that will prove it.',
    ],
    execute: [
      'Implement the planned change through existing tools and keep unrelated files untouched.',
    ],
    verify: [
      'Run the declared checks exactly and retain their real outputs as evidence.',
    ],
    review: [
      'Review the resulting diff for regressions, missing tests, and permission or data risks.',
    ],
  },
  capabilities: {
    required: ['repository_read', 'repository_write', 'shell'],
    optional: ['browser', 'external_connectors'],
  },
  permissionProfile: 'existing_tool_boundary',
  definitionOfDone: [
    'Every required verification check passed.',
    'The review outcome was recorded.',
    'Evidence and changed artifacts are traceable.',
  ],
  outputContracts: [
    'implementation_summary',
    'verification_evidence',
    'review_outcome',
  ],
} as const satisfies AgentTaskRolePack

export const KNOWLEDGE_WORKER_ROLE_PACK = {
  id: 'knowledge_worker',
  version: '1.0.0',
  displayName: 'Knowledge Worker',
  mission:
    'Turn business goals into reliable, source-traceable, usable deliverables.',
  responsibilities: [
    'Confirm the audience, purpose, format, and delivery constraints.',
    'Collect traceable sources and distinguish facts from assumptions.',
    'Produce a structured artifact that can be used outside the conversation.',
    'Verify calculations, facts, consistency, formatting, and file usability.',
  ],
  nonGoals: [
    'Do not present unsupported assumptions as facts.',
    'Do not claim completion with chat text when an artifact was requested.',
    'Do not expose sensitive data or bypass existing tool permissions.',
  ],
  workflow: VERIFIED_DELIVERY_WORKFLOW_REF,
  stageInstructions: {
    intake: [
      'Clarify the business goal, audience, intended use, output format, and delivery constraints.',
    ],
    scout: [
      'Collect authoritative sources and relevant local knowledge with provenance.',
      'Identify missing, conflicting, stale, or sensitive information before drafting.',
    ],
    plan: [
      'Define the deliverable structure, map key claims to sources, and declare artifact validation checks.',
    ],
    execute: [
      'Create the requested file artifact, keep facts separate from assumptions, and follow the required template.',
    ],
    verify: [
      'Check calculations, source traceability, internal consistency, artifact openability, and sensitive-data handling.',
    ],
    review: [
      'Review audience fit, readability, format, business rules, and agreement between data, charts, and narrative.',
    ],
  },
  capabilities: {
    required: ['source_retrieval', 'artifact_read', 'artifact_write'],
    optional: [
      'document',
      'spreadsheet',
      'presentation',
      'data_processing',
      'external_connectors',
    ],
  },
  permissionProfile: 'existing_tool_boundary',
  definitionOfDone: [
    'Required validation checks passed and their evidence is retained.',
    'Sources are traceable and assumptions are labeled.',
    'The requested artifact exists, opens, and follows its format requirements.',
    'The review outcome was recorded.',
  ],
  outputContracts: [
    'deliverable_artifact',
    'source_register',
    'verification_evidence',
    'review_outcome',
  ],
} as const satisfies AgentTaskRolePack

export const SHORT_VIDEO_OPERATOR_ROLE_PACK = {
  id: 'short_video_operator',
  version: '1.0.0',
  displayName: 'Short Video Operator',
  mission:
    'Turn business goals and source material into platform-ready short-video plans and scripts.',
  responsibilities: [
    'Confirm the audience, platform, objective, format, and publishing constraints.',
    'Keep claims traceable to source material and distinguish facts from creative assumptions.',
    'Produce usable topics, hooks, scripts, and shot guidance for the requested channel.',
    'Validate platform fit, brand consistency, asset readiness, and delivery format.',
  ],
  nonGoals: [
    'Do not invent product claims, performance data, or source facts.',
    'Do not claim completion with chat text when a production artifact was requested.',
    'Do not publish content or access accounts without explicit permission.',
  ],
  workflow: VERIFIED_DELIVERY_WORKFLOW_REF,
  stageInstructions: {
    intake: [
      'Clarify the business goal, target audience, platform, content format, call to action, and delivery constraints.',
    ],
    scout: [
      'Collect product facts, brand guidance, audience signals, reference content, and reusable project knowledge with provenance.',
      'Identify unsupported claims, missing assets, platform risks, and approval boundaries before drafting.',
    ],
    plan: [
      'Define the content angle, hook, narrative structure, deliverables, source mapping, and validation checks.',
    ],
    execute: [
      'Create the requested topic plan, script, storyboard, or production brief as a reusable artifact.',
    ],
    verify: [
      'Check source traceability, platform constraints, duration, brand consistency, asset completeness, and artifact usability.',
    ],
    review: [
      'Review audience fit, opening hook, message clarity, call to action, compliance risk, and production readiness.',
    ],
  },
  capabilities: {
    required: ['source_retrieval', 'artifact_read', 'artifact_write'],
    optional: [
      'document',
      'spreadsheet',
      'presentation',
      'data_processing',
      'external_connectors',
    ],
  },
  permissionProfile: 'existing_tool_boundary',
  definitionOfDone: [
    'Required validation checks passed and their evidence is retained.',
    'Claims are traceable and creative assumptions are labeled.',
    'The requested production artifact exists, opens, and follows platform and format requirements.',
    'The review outcome was recorded.',
  ],
  outputContracts: [
    'short_video_deliverable',
    'source_register',
    'verification_evidence',
    'review_outcome',
  ],
} as const satisfies AgentTaskRolePack
export const AGENT_TASK_ROLE_PACKS: readonly AgentTaskRolePack[] = [
  SOFTWARE_ENGINEER_ROLE_PACK,
  KNOWLEDGE_WORKER_ROLE_PACK,
  SHORT_VIDEO_OPERATOR_ROLE_PACK,
]

export const AGENT_TASK_ROLE_IDS: readonly AgentTaskRole[] = [
  ...new Set(AGENT_TASK_ROLE_PACKS.map((pack) => pack.id)),
]

export function resolveAgentTaskRolePack(
  role: string | undefined,
  version?: string,
): AgentTaskRolePack | null {
  const roleId = role ?? DEFAULT_AGENT_TASK_ROLE
  const resolvedVersion =
    version === roleId && roleId === DEFAULT_AGENT_TASK_ROLE
      ? SOFTWARE_ENGINEER_ROLE_PACK.version
      : version
  return AGENT_TASK_ROLE_PACKS.find(
    (pack) =>
      pack.id === roleId &&
      (!resolvedVersion || pack.version === resolvedVersion),
  ) ?? null
}

export function isSourceBackedArtifactRole(role: AgentTaskRole): boolean {
  return role === 'knowledge_worker' || role === 'short_video_operator'
}
export function buildAgentTaskRoleContext(
  task: Pick<
    AgentTask,
    | 'role'
    | 'roleVersion'
    | 'status'
    | 'resumeStatus'
    | 'definitionSnapshot'
  >,
  capabilityInventory?: AgentTaskCapabilityInventory,
): AgentTaskRoleContext | null {
  const rolePack = resolveAgentTaskRolePack(task.role, task.roleVersion)
  if (!rolePack) return null
  const primaryRoleSnapshot = task.definitionSnapshot?.roles.find(
    (assignment) => assignment.kind === 'primary',
  )
  const workflowRef = task.definitionSnapshot?.workflow ?? rolePack.workflow
  const capabilityContract =
    task.definitionSnapshot?.capabilities ?? rolePack.capabilities
  const completionContract =
    task.definitionSnapshot?.completionContract ?? {
      definitionOfDone: [...rolePack.definitionOfDone],
      outputContracts: [...rolePack.outputContracts],
    }
  const assistantOverlay =
    primaryRoleSnapshot?.role === rolePack.id &&
      primaryRoleSnapshot.roleVersion === rolePack.version
      ? primaryRoleSnapshot.assistant
      : undefined
  const workflowPack = resolveAgentTaskWorkflowPack(
    workflowRef.id,
    workflowRef.version,
  )
  if (!workflowPack) return null

  const activeStatus =
    task.status === 'blocked' || task.status === 'interrupted'
      ? task.resumeStatus
      : task.status
  const instructions = activeStatus
    ? rolePack.stageInstructions[activeStatus]
    : undefined
  const capabilityResolution = capabilityInventory
    ? resolveAgentTaskCapabilities(
        capabilityContract.required,
        capabilityContract.optional,
        capabilityInventory,
      )
    : undefined

  return {
    role: rolePack.id,
    roleVersion: rolePack.version,
    displayName: rolePack.displayName,
    mission: rolePack.mission,
    responsibilities: [...rolePack.responsibilities],
    nonGoals: [...rolePack.nonGoals],
    workflow: [...workflowPack.stages],
    currentStage: instructions && activeStatus
      ? { status: activeStatus, instructions: [...instructions] }
      : undefined,
    toolCapabilities: {
      required: [...capabilityContract.required],
      optional: [...capabilityContract.optional],
    },
    capabilityResolution: capabilityResolution
      ? {
          available: capabilityResolution.capabilities
            .filter((capability) => capability.providers.length > 0)
            .map((capability) => capability.id),
          missingRequired: capabilityResolution.missingRequired,
          unavailableOptional: capabilityResolution.unavailableOptional,
        }
      : undefined,
    assistantOverlay: assistantOverlay
      ? { ...assistantOverlay }
      : undefined,
    permissionProfile: rolePack.permissionProfile,
    definitionOfDone: [...completionContract.definitionOfDone],
    outputContracts: [...completionContract.outputContracts],
  }
}
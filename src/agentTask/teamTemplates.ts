import type { AgentTaskRole } from './types.js'
import type { AgentTaskCapabilityId } from './capabilities.js'

export type AgentTaskTemplateKind = 'delivery' | 'independent_review'

export type AgentTaskTemplate = {
  id: string
  version: string
  displayName: string
  description: string
  kind: AgentTaskTemplateKind
  primaryRole: AgentTaskRole
  capabilities?: {
    required?: readonly AgentTaskCapabilityId[]
    optional?: readonly AgentTaskCapabilityId[]
  }
}

export type AgentTaskTeamTemplate = {
  id: string
  version: string
  displayName: string
  mission: string
  primaryRole: AgentTaskRole
  taskTemplates: readonly AgentTaskTemplate[]
}

const SOFTWARE_TASK_TEMPLATES = [
  {
    id: 'bug_fix',
    version: '1.0.0',
    displayName: 'Fix a bug',
    description: 'Find the root cause, implement a focused fix, and verify it.',
    kind: 'delivery',
    primaryRole: 'software_engineer',
  },
  {
    id: 'feature_delivery',
    version: '1.0.0',
    displayName: 'Build a feature',
    description: 'Inspect the product boundary, implement, test, and deliver.',
    kind: 'delivery',
    primaryRole: 'software_engineer',
  },
  {
    id: 'code_review',
    version: '1.0.0',
    displayName: 'Review code',
    description: 'Inspect a change for defects, regressions, and missing tests.',
    kind: 'delivery',
    primaryRole: 'software_engineer',
  },
  {
    id: 'software_independent_review',
    version: '1.0.0',
    displayName: 'Independent delivery review',
    description: 'Review a completed software task from its evidence and artifacts.',
    kind: 'independent_review',
    primaryRole: 'software_engineer',
  },
] as const satisfies readonly AgentTaskTemplate[]

const KNOWLEDGE_TASK_TEMPLATES = [
  {
    id: 'research_brief',
    version: '1.0.0',
    displayName: 'Research brief',
    description: 'Collect traceable sources and turn them into a decision-ready brief.',
    kind: 'delivery',
    primaryRole: 'knowledge_worker',
  },
  {
    id: 'document_delivery',
    version: '1.0.0',
    displayName: 'Deliver a document',
    description: 'Organize source material into a usable, verified document.',
    kind: 'delivery',
    primaryRole: 'knowledge_worker',
  },
  {
    id: 'analysis_report',
    version: '1.0.0',
    displayName: 'Analysis report',
    description: 'Analyze files or data and deliver a source-backed report.',
    kind: 'delivery',
    primaryRole: 'knowledge_worker',
  },
  {
    id: 'knowledge_independent_review',
    version: '1.0.0',
    displayName: 'Independent deliverable review',
    description: 'Review a completed knowledge task without rewriting it.',
    kind: 'independent_review',
    primaryRole: 'knowledge_worker',
  },
] as const satisfies readonly AgentTaskTemplate[]

const SHORT_VIDEO_TASK_TEMPLATES = [
  {
    id: 'topic_plan',
    version: '1.0.0',
    displayName: 'Plan video topics',
    description: 'Turn a goal and source material into usable content directions.',
    kind: 'delivery',
    primaryRole: 'short_video_operator',
  },
  {
    id: 'script_storyboard',
    version: '1.0.0',
    displayName: 'Script and storyboard',
    description: 'Create a platform-ready script, shot plan, and production notes.',
    kind: 'delivery',
    primaryRole: 'short_video_operator',
  },
  {
    id: 'platform_adaptation',
    version: '1.0.0',
    displayName: 'Adapt for a platform',
    description: 'Adapt an existing idea or script to a target short-video channel.',
    kind: 'delivery',
    primaryRole: 'short_video_operator',
  },
  {
    id: 'video_render',
    version: '1.0.0',
    displayName: 'Render a video',
    description: 'Compose, validate, and render an approved video to a playable file.',
    kind: 'delivery',
    primaryRole: 'short_video_operator',
    capabilities: {
      required: ['video_composition', 'video_rendering'],
    },
  },
  {
    id: 'content_independent_review',
    version: '1.0.0',
    displayName: 'Independent content review',
    description: 'Review a completed content task for readiness and source support.',
    kind: 'independent_review',
    primaryRole: 'short_video_operator',
  },
] as const satisfies readonly AgentTaskTemplate[]

// ponytail: Built-in teams intentionally declare one primary role until the
// runtime can persist additional collaborator lifecycle events.
export const AGENT_TASK_TEAM_TEMPLATES = [
  {
    id: 'software_delivery',
    version: '1.0.0',
    displayName: 'Software delivery team',
    mission: 'Inspect, implement, verify, and review maintainable software changes.',
    primaryRole: 'software_engineer',
    taskTemplates: SOFTWARE_TASK_TEMPLATES,
  },
  {
    id: 'knowledge_delivery',
    version: '1.0.0',
    displayName: 'Knowledge delivery team',
    mission: 'Turn source material into traceable, usable professional deliverables.',
    primaryRole: 'knowledge_worker',
    taskTemplates: KNOWLEDGE_TASK_TEMPLATES,
  },
  {
    id: 'short_video_production',
    version: '1.0.0',
    displayName: 'Short-video production team',
    mission: 'Create source-backed short-video plans, scripts, and production briefs.',
    primaryRole: 'short_video_operator',
    taskTemplates: SHORT_VIDEO_TASK_TEMPLATES,
  },
] as const satisfies readonly AgentTaskTeamTemplate[]

export function resolveAgentTaskTeamTemplate(
  id: string | undefined,
): AgentTaskTeamTemplate | null {
  if (!id) return null
  return AGENT_TASK_TEAM_TEMPLATES.find((team) => team.id === id) ?? null
}

export function resolveAgentTaskTemplate(
  team: AgentTaskTeamTemplate,
  id: string | undefined,
): AgentTaskTemplate | null {
  if (!id) return null
  return team.taskTemplates.find((template) => template.id === id) ?? null
}

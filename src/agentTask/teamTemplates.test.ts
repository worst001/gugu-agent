import { describe, expect, it } from 'bun:test'
import {
  AGENT_TASK_TEAM_TEMPLATES,
  resolveAgentTaskTeamTemplate,
  resolveAgentTaskTemplate,
} from './teamTemplates.js'

describe('AgentTask team templates', () => {
  it('ships three versioned teams with delivery and review entry points', () => {
    expect(AGENT_TASK_TEAM_TEMPLATES.map((team) => team.id)).toEqual([
      'software_delivery',
      'knowledge_delivery',
      'short_video_production',
    ])

    for (const team of AGENT_TASK_TEAM_TEMPLATES) {
      expect(team.version).toBe('1.0.0')
      expect(team.taskTemplates.some((template) =>
        template.kind === 'delivery'
      )).toBe(true)
      expect(team.taskTemplates.some((template) =>
        template.kind === 'independent_review'
      )).toBe(true)
      expect(team.taskTemplates.every((template) =>
        template.primaryRole === team.primaryRole
      )).toBe(true)
    }
  })

  it('resolves a task template only inside its owning team', () => {
    const team = resolveAgentTaskTeamTemplate('short_video_production')
    expect(team?.primaryRole).toBe('short_video_operator')
    expect(team && resolveAgentTaskTemplate(team, 'script_storyboard')?.kind)
      .toBe('delivery')
    expect(team && resolveAgentTaskTemplate(team, 'bug_fix')).toBeNull()
  })
})

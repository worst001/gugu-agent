import { describe, expect, it } from 'vitest'
import {
  buildAgentTaskLaunchRequest,
  buildAgentTaskReviewRequest,
  detectAgentTaskTeam,
  recommendAgentTaskRole,
  recommendAgentTaskTeam,
  recommendAgentTaskTemplate,
  resolveAgentTaskTeamForWorkType,
} from './agentTaskProduct'
import type { AgentTask, AgentTaskTeamSummary } from '../types/agentTask'

const roles = [
  'software_engineer',
  'knowledge_worker',
  'short_video_operator',
] as const

const teams: AgentTaskTeamSummary[] = [
  {
    id: 'software_delivery',
    version: '1.0.0',
    displayName: 'Software',
    mission: '',
    primaryRole: 'software_engineer',
    taskTemplates: [
      {
        id: 'bug_fix',
        version: '1.0.0',
        displayName: 'Bug',
        description: '',
        kind: 'delivery',
        primaryRole: 'software_engineer',
      },
      {
        id: 'feature_delivery',
        version: '1.0.0',
        displayName: 'Feature',
        description: '',
        kind: 'delivery',
        primaryRole: 'software_engineer',
      },
      {
        id: 'code_review',
        version: '1.0.0',
        displayName: 'Review',
        description: '',
        kind: 'delivery',
        primaryRole: 'software_engineer',
      },
    ],
  },
  {
    id: 'knowledge_delivery',
    version: '1.0.0',
    displayName: 'Knowledge',
    mission: '',
    primaryRole: 'knowledge_worker',
    taskTemplates: [
      {
        id: 'research_brief',
        version: '1.0.0',
        displayName: 'Research',
        description: '',
        kind: 'delivery',
        primaryRole: 'knowledge_worker',
      },
      {
        id: 'document_delivery',
        version: '1.0.0',
        displayName: 'Document',
        description: '',
        kind: 'delivery',
        primaryRole: 'knowledge_worker',
      },
      {
        id: 'analysis_report',
        version: '1.0.0',
        displayName: 'Analysis',
        description: '',
        kind: 'delivery',
        primaryRole: 'knowledge_worker',
      },
    ],
  },
  {
    id: 'short_video_production',
    version: '1.0.0',
    displayName: 'Video',
    mission: '',
    primaryRole: 'short_video_operator',
    taskTemplates: [
      {
        id: 'topic_plan',
        version: '1.0.0',
        displayName: 'Topics',
        description: '',
        kind: 'delivery',
        primaryRole: 'short_video_operator',
      },
      {
        id: 'script_storyboard',
        version: '1.0.0',
        displayName: 'Script',
        description: '',
        kind: 'delivery',
        primaryRole: 'short_video_operator',
      },
      {
        id: 'platform_adaptation',
        version: '1.0.0',
        displayName: 'Adapt',
        description: '',
        kind: 'delivery',
        primaryRole: 'short_video_operator',
      },
      {
        id: 'video_render',
        version: '1.0.0',
        displayName: 'Render',
        description: '',
        kind: 'delivery',
        primaryRole: 'short_video_operator',
      },
    ],
  },
]

describe('agentTaskProduct', () => {
  it('keeps smart routing conversational until there is a real task signal', () => {
    expect(detectAgentTaskTeam('Hello there', teams)).toBeNull()
    expect(resolveAgentTaskTeamForWorkType('smart', 'Hello there', teams)).toBeNull()
    expect(resolveAgentTaskTeamForWorkType('chat', 'Fix this API bug', teams)).toBeNull()
  })

  it('uses the manually selected work type instead of text recommendation', () => {
    expect(resolveAgentTaskTeamForWorkType(
      'knowledge_delivery',
      'Fix this API bug',
      teams,
    )?.id).toBe('knowledge_delivery')
  })

  it('recommends roles and templates from real Chinese task text', () => {
    const videoTeam = recommendAgentTaskTeam(
      '帮我写一期产品短视频脚本和分镜',
      teams,
    )
    expect(videoTeam?.id).toBe('short_video_production')
    expect(recommendAgentTaskTemplate('写脚本和分镜', videoTeam)?.id)
      .toBe('script_storyboard')

    const softwareTeam = recommendAgentTaskTeam('修复 API bug', teams)
    expect(softwareTeam?.id).toBe('software_delivery')
    expect(recommendAgentTaskTemplate('修复 API bug', softwareTeam)?.id)
      .toBe('bug_fix')

    const knowledgeTeam = recommendAgentTaskTeam('整理项目方案文档', teams)
    expect(knowledgeTeam?.id).toBe('knowledge_delivery')
    expect(recommendAgentTaskTemplate('整理项目方案文档', knowledgeTeam)?.id)
      .toBe('document_delivery')
  })

  it('uses quick actions as recommendations without overriding explicit intent', () => {
    const pptTeam = recommendAgentTaskTeam('', teams, 'ppt-draft')
    expect(pptTeam?.id).toBe('knowledge_delivery')
    expect(recommendAgentTaskTemplate('', pptTeam, 'ppt-draft')?.id)
      .toBe('document_delivery')

    const explicitVideoTeam = recommendAgentTaskTeam(
      '为抖音制作产品介绍脚本',
      teams,
      'ppt-draft',
    )
    expect(explicitVideoTeam?.id).toBe('short_video_production')
  })

  it('selects video rendering only for an explicit render request', () => {
    const videoTeam = teams.find((team) => team.id === 'short_video_production')!
    expect(recommendAgentTaskTemplate('Write a short video script', videoTeam)?.id)
      .toBe('script_storyboard')
    expect(recommendAgentTaskTemplate('Render and export the video to MP4', videoTeam)?.id)
      .toBe('video_render')
    expect(recommendAgentTaskTemplate('渲染成片并导出 MP4', videoTeam)?.id)
      .toBe('video_render')
  })

  it('falls back to an available knowledge role', () => {
    expect(recommendAgentTaskRole('整理季度复盘文档', roles))
      .toBe('knowledge_worker')
    expect(recommendAgentTaskRole('写脚本', ['knowledge_worker']))
      .toBe('knowledge_worker')
  })

  it('keeps launch wire short and free of product instructions', () => {
    const request = buildAgentTaskLaunchRequest(
      { id: 'task-launch', role: 'short_video_operator' },
      'Produce three topics',
    )

    expect(request.wire).toBe([
      'Produce three topics',
      'Use existing AgentTask task-launch with role short_video_operator; load it before substantive work.',
    ].join('\n\n'))
    expect(request.wire).not.toContain('[Gugu durable task request]')
    expect(request.wire).not.toContain('Do not expose')
    expect(request.display).toBe('Produce three topics')
  })

  it('builds a review request with an auditable parent relation', () => {
    const request = buildAgentTaskReviewRequest({
      id: 'task-parent',
      title: 'Launch scripts',
      role: 'short_video_operator',
    } as AgentTask)

    expect(request).toContain('parentTaskId "task-parent"')
    expect(request).toContain('relation "review"')
    expect(request).toContain('role "short_video_operator"')
  })
})

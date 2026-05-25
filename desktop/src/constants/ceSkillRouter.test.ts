import { describe, expect, it } from 'vitest'
import {
  buildDefaultCeSkillRouterMessage,
  resolveDefaultCeSkillRoute,
} from './ceSkillRouter'

const AVAILABLE_CE_SKILLS = [
  'compound-engineering:ce-brainstorm',
  'compound-engineering:ce-code-review',
  'compound-engineering:ce-debug',
  'compound-engineering:ce-frontend-design',
  'compound-engineering:ce-plan',
  'compound-engineering:ce-work',
]

describe('resolveDefaultCeSkillRoute', () => {
  it('keeps quick factual prompts in plain default mode', () => {
    expect(resolveDefaultCeSkillRoute('what is debounce?', AVAILABLE_CE_SKILLS)).toBeNull()
    expect(resolveDefaultCeSkillRoute('谢谢', AVAILABLE_CE_SKILLS)).toBeNull()
  })

  it('routes UI quality prompts to ce-frontend-design with the registered skill name', () => {
    const route = resolveDefaultCeSkillRoute(
      '3个 toggle，UI感觉有点丑，帮我看看怎么优化',
      AVAILABLE_CE_SKILLS,
    )

    expect(route).toMatchObject({
      routeId: 'frontend_design',
      canonicalSkill: 'ce-frontend-design',
      registeredSkillName: 'compound-engineering:ce-frontend-design',
      availability: 'matched',
    })
  })

  it('routes product boundary prompts to ce-brainstorm', () => {
    const route = resolveDefaultCeSkillRoute(
      '我如何优化agent，大部分情况下用户会使用默认模式，我如何甄别提示词边界？',
      AVAILABLE_CE_SKILLS,
    )

    expect(route?.routeId).toBe('brainstorm')
    expect(route?.registeredSkillName).toBe('compound-engineering:ce-brainstorm')
  })

  it('routes implementation plan execution to ce-work', () => {
    const route = resolveDefaultCeSkillRoute('PLEASE IMPLEMENT THIS PLAN', AVAILABLE_CE_SKILLS)

    expect(route?.routeId).toBe('work')
    expect(route?.registeredSkillName).toBe('compound-engineering:ce-work')
  })

  it('routes failures to ce-debug and reviews to ce-code-review', () => {
    expect(resolveDefaultCeSkillRoute('测试失败了，帮我定位原因', AVAILABLE_CE_SKILLS)?.routeId).toBe('debug')
    expect(resolveDefaultCeSkillRoute('记得做一次 code review', AVAILABLE_CE_SKILLS)?.routeId).toBe('code_review')
  })

  it('marks a matched route as missing when the required CE skill is absent', () => {
    const route = resolveDefaultCeSkillRoute('UI 感觉很丑，帮我优化一下', [
      'compound-engineering:ce-brainstorm',
    ])

    expect(route).toMatchObject({
      routeId: 'frontend_design',
      canonicalSkill: 'ce-frontend-design',
      availability: 'missing',
    })
  })
})

describe('buildDefaultCeSkillRouterMessage', () => {
  it('injects one-skill default-mode routing without changing display text', () => {
    const result = buildDefaultCeSkillRouterMessage(
      'UI 感觉很丑，帮我优化一下',
      AVAILABLE_CE_SKILLS,
    )

    expect(result?.display).toBe('UI 感觉很丑，帮我优化一下')
    expect(result?.wire).toContain('[Agent mode: default + CE pre-route]')
    expect(result?.wire).toContain('compound-engineering:ce-frontend-design')
    expect(result?.wire).toContain('Use at most this one CE Skill')
    expect(result?.modelPreference).toBe('strong')
  })
})


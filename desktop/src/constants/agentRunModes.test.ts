import { describe, expect, it } from 'vitest'
import {
  buildAgentRunModeMessage,
  buildPlanModeMessage,
  extractAgentRunModeDisplayText,
} from './agentRunModes'

describe('buildAgentRunModeMessage', () => {
  it('normal mode sends quick factual text without workflow scaffolding', () => {
    const result = buildAgentRunModeMessage('normal', undefined, 'what is debounce?')

    expect(result.wire).toBe('what is debounce?')
    expect(result.display).toBe('what is debounce?')
    expect(result.modelPreference).toBeUndefined()
  })

  it('plan mode adds a hidden ce-plan planning scaffold', () => {
    const result = buildAgentRunModeMessage('plan', undefined, 'plan the composer modes')

    expect(result.display).toBe('plan the composer modes')
    expect(result.modelPreference).toBe('strong')
    expect(result.wire).toContain('[Agent mode: plan]')
    expect(result.wire).toContain('/ce-plan')
    expect(result.wire).toContain('User message:\nplan the composer modes')
  })

  it('ce mode uses the selected workflow role', () => {
    const result = buildAgentRunModeMessage('ce', 'quick', 'fix the failing test')

    expect(result.display).toBe('fix the failing test')
    expect(result.modelPreference).toBe('strong')
    expect(result.wire).toContain('[Workflow: quick iteration]')
    expect(result.wire).toContain('CE automation (binding)')
  })

  it('default mode injects a one-skill CE pre-route when a strong route matches', () => {
    const result = buildAgentRunModeMessage('normal', undefined, 'UI 感觉很丑，帮我优化一下', [
      'compound-engineering:ce-frontend-design',
    ])

    expect(result.display).toBe('UI 感觉很丑，帮我优化一下')
    expect(result.modelPreference).toBe('strong')
    expect(result.wire).toContain('[Agent mode: default + CE pre-route]')
    expect(result.wire).toContain('compound-engineering:ce-frontend-design')
  })
})

describe('buildPlanModeMessage', () => {
  it('handles attachment-only planning messages', () => {
    const result = buildPlanModeMessage('   ')

    expect(result.display).toMatch(/^\s*$/)
    expect(result.wire).toContain('attachments only')
    expect(result.modelPreference).toBe('strong')
  })
})

describe('extractAgentRunModeDisplayText', () => {
  it('extracts the visible text from plan mode scaffolding', () => {
    const { wire } = buildPlanModeMessage('draft a plan')

    expect(extractAgentRunModeDisplayText(wire)).toBe('draft a plan')
  })

  it('extracts the visible text from default CE pre-route scaffolding', () => {
    const result = buildAgentRunModeMessage('normal', undefined, 'UI 感觉很丑，帮我优化一下', [
      'compound-engineering:ce-frontend-design',
    ])

    expect(extractAgentRunModeDisplayText(result.wire)).toBe('UI 感觉很丑，帮我优化一下')
  })
})

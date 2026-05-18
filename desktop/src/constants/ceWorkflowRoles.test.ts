import { describe, it, expect } from 'vitest'
import {
  buildCeWorkflowMessage,
  buildCeAutomationInstructions,
  buildCeLanguageInstructions,
  extractCeWorkflowDisplayText,
  getCeWorkflowRole,
} from './ceWorkflowRoles'

describe('buildCeAutomationInstructions', () => {
  it('quick preset does not mandate a first phase', () => {
    const role = getCeWorkflowRole('quick')
    const block = buildCeAutomationInstructions(role)
    expect(block).toContain('CE automation')
    expect(role.enforceFirstPhase).toBe(false)
    expect(block).not.toContain('/ce-plan')
  })

  it('standard preset references planning phase and registered skill names', () => {
    const role = getCeWorkflowRole('standard')
    const block = buildCeAutomationInstructions(role)
    expect(role.enforceFirstPhase).toBe('plan')
    expect(block).toContain('/ce-plan')
    expect(block).toContain('registered')
    expect(block).not.toContain('skill "ce-plan"')
  })

  it('compound delivery preset includes the compound phase', () => {
    const role = getCeWorkflowRole('compound_delivery')
    const block = buildCeAutomationInstructions(role)
    expect(role.enforceFirstPhase).toBe('plan')
    expect(block).toContain('ce-compound')
  })
})

describe('buildCeWorkflowMessage', () => {
  it('includes automation block and user text for standard role', () => {
    const { wire, display, modelPreference } = buildCeWorkflowMessage('standard', 'Build feature X')
    expect(display).toBe('Build feature X')
    expect(modelPreference).toBe('strong')
    expect(wire).toContain('[Workflow: standard delivery]')
    expect(wire).toContain('CE automation (binding)')
    expect(wire).toContain('/ce-plan')
    expect(wire).not.toContain('/ce-compound')
    expect(wire).toContain('User message:\nBuild feature X')
  })

  it('compound delivery captures reusable lessons after review', () => {
    const { wire } = buildCeWorkflowMessage('compound_delivery', 'Build feature X')
    expect(wire).toContain('[Workflow: compound delivery]')
    expect(wire).toContain('/ce-code-review')
    expect(wire).toContain('/ce-compound')
    expect(wire).toContain('reusable lessons')
  })

  it('falls back to default role for unknown id', () => {
    const { wire } = buildCeWorkflowMessage('unknown-role-xyz', 'hi')
    expect(wire).toContain('[Workflow: quick iteration]')
    expect(wire).toContain('/ce-debug')
    expect(wire).not.toContain('/ce-plan')
  })

  it('uses default role when role id is undefined', () => {
    const { wire, modelPreference } = buildCeWorkflowMessage(undefined, 'hi')
    expect(wire).toContain('[Workflow: quick iteration]')
    expect(wire).toContain('/ce-debug')
    expect(wire).toContain('User message:\nhi')
    expect(modelPreference).toBe('fast')
  })

  it('attachment-only message still carries automation', () => {
    const { wire, display } = buildCeWorkflowMessage('deep', '   ')
    expect(display).toMatch(/^\s*$/)
    expect(wire).toContain('attachments only')
    expect(wire).toContain('/ce-plan')
    expect(wire).toContain('/ce-compound')
  })

  it('deep preset mentions brainstorm only as a conditional pre-plan step', () => {
    const role = getCeWorkflowRole('deep')
    expect(role.skills).toEqual([
      '/ce-plan',
      '/ce-work',
      '/ce-debug',
      '/ce-test-browser',
      '/ce-code-review',
      '/ce-compound',
    ])

    const { wire } = buildCeWorkflowMessage('deep', 'Refactor the desktop chat flow')
    expect(wire).toContain('If requirements or direction are unclear')
    expect(wire).toContain('/ce-brainstorm before /ce-plan')
  })

  it('ship preset targets work phase', () => {
    const { wire, modelPreference } = buildCeWorkflowMessage('ship', 'go')
    expect(wire).toContain('/ce-work')
    expect(wire).not.toContain('skill "ce-work"')
    expect(modelPreference).toBe('fast')
  })

  it('explicit CE slash commands can override the preset model preference', () => {
    expect(buildCeWorkflowMessage('standard', '/ce-brainstorm product options').modelPreference).toBe('fast')
    expect(buildCeWorkflowMessage('quick', '/ce-plan migration').modelPreference).toBe('strong')
  })

  it('keeps visible thinking and replies in Chinese for Chinese user text', () => {
    const { wire, display } = buildCeWorkflowMessage('quick', '这是什么')
    expect(display).toBe('这是什么')
    expect(wire).toContain('用户可见语言要求')
    expect(wire).toContain('思考过程')
    expect(wire).toContain('必须使用中文')
    expect(extractCeWorkflowDisplayText(wire)).toBe('这是什么')
  })

  it('uses a same-language instruction for non-Chinese user text', () => {
    const instructions = buildCeLanguageInstructions('What is this?')
    expect(instructions).toContain('same language as the user')
    expect(instructions).toContain('visible thinking')
  })

  it('extracts display text from hidden CE workflow wire prompts', () => {
    const { wire } = buildCeWorkflowMessage('quick', '这是什么')
    expect(extractCeWorkflowDisplayText(wire)).toBe('这是什么')
  })
})

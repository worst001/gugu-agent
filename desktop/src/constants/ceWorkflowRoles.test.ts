import { describe, it, expect } from 'vitest'
import {
  buildCeWorkflowMessage,
  buildCeAutomationInstructions,
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
    const { wire, display } = buildCeWorkflowMessage('standard', 'Build feature X')
    expect(display).toBe('Build feature X')
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
    expect(wire).toContain('[Workflow: standard delivery]')
    expect(wire).toContain('/ce-plan')
  })

  it('uses default role when role id is undefined', () => {
    const { wire } = buildCeWorkflowMessage(undefined, 'hi')
    expect(wire).toContain('[Workflow: standard delivery]')
    expect(wire).toContain('/ce-plan')
    expect(wire).toContain('User message:\nhi')
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
    const { wire } = buildCeWorkflowMessage('ship', 'go')
    expect(wire).toContain('/ce-work')
    expect(wire).not.toContain('skill "ce-work"')
  })
})

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
})

describe('buildCeWorkflowMessage', () => {
  it('includes automation block and user text for standard role', () => {
    const { wire, display } = buildCeWorkflowMessage('standard', 'Build feature X')
    expect(display).toBe('Build feature X')
    expect(wire).toContain('[Workflow: standard delivery]')
    expect(wire).toContain('CE automation (binding)')
    expect(wire).toContain('/ce-plan')
    expect(wire).toContain('User message:\nBuild feature X')
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
  })

  it('ship preset targets work phase', () => {
    const { wire } = buildCeWorkflowMessage('ship', 'go')
    expect(wire).toContain('/ce-work')
    expect(wire).not.toContain('skill "ce-work"')
  })
})

import { describe, expect, it } from 'vitest'
import { buildCeWorkflowMessage } from '../constants/ceWorkflowRoles'
import { sanitizeSessionTitle } from './sessionTitle'

describe('sanitizeSessionTitle', () => {
  it('uses the visible user prompt for CE workflow wire messages', () => {
    const { wire } = buildCeWorkflowMessage('standard', 'Build the settings screen')

    expect(sanitizeSessionTitle(wire)).toBe('Build the settings screen')
  })

  it('falls back when a previously persisted title is only workflow scaffolding', () => {
    expect(sanitizeSessionTitle('[Workflow: standard delivery] When scope is unclear...')).toBe('New Session')
  })

  it('uses the visible user prompt for attachment parser wire messages', () => {
    const wire = [
      '用户上传了附件。',
      '<附件解析结果>',
      '# Parsed file',
      '</附件解析结果>',
      '<用户正文>',
      'Review this file',
      '</用户正文>',
    ].join('\n')

    expect(sanitizeSessionTitle(wire)).toBe('Review this file')
  })

  it('uses the visible user prompt for nested attachment and CE wire messages', () => {
    const { wire: ceWire } = buildCeWorkflowMessage('standard', 'Review this PDF')
    const wire = [
      '用户上传了附件。',
      '<附件解析结果>',
      '# Parsed file',
      '</附件解析结果>',
      '<用户正文>',
      ceWire,
      '</用户正文>',
    ].join('\n')

    expect(sanitizeSessionTitle(wire)).toBe('Review this PDF')
  })
})

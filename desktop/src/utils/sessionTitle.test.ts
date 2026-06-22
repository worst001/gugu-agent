import { describe, expect, it } from 'vitest'
import { buildPlanModeMessage } from '../constants/agentRunModes'
import { buildCeWorkflowMessage } from '../constants/ceWorkflowRoles'
import { buildOfficeToolMessage } from '../constants/officeTools'
import { sanitizeSessionTitle } from './sessionTitle'

describe('sanitizeSessionTitle', () => {
  it('uses the visible user prompt for CE workflow wire messages', () => {
    const { wire } = buildCeWorkflowMessage('standard', 'Build the settings screen')

    expect(sanitizeSessionTitle(wire)).toBe('Build the settings screen')
  })

  it('falls back when a previously persisted title is only workflow scaffolding', () => {
    expect(sanitizeSessionTitle('[Workflow: standard delivery] When scope is unclear...')).toBe('New Session')
  })

  it('uses the visible user prompt for plan mode wire messages', () => {
    const { wire } = buildPlanModeMessage('Plan the composer modes')

    expect(sanitizeSessionTitle(wire)).toBe('Plan the composer modes')
  })

  it('uses the visible user prompt for office toolbox wire messages', () => {
    const { wire } = buildOfficeToolMessage('coding-assistant', '写个俄罗斯方块', {
      hasAttachments: false,
    })

    expect(sanitizeSessionTitle(wire)).toBe('写个俄罗斯方块')
  })

  it('falls back when a previously persisted title is truncated office toolbox scaffolding', () => {
    expect(sanitizeSessionTitle('[Office toolbox: coding-assistant] The user selec...')).toBe('New Session')
  })

  it('falls back for attachment-only office toolbox wire messages', () => {
    const { wire } = buildOfficeToolMessage('file-assistant', '', {
      hasAttachments: true,
    })

    expect(sanitizeSessionTitle(wire)).toBe('New Session')
  })

  it('uses the visible user prompt for nested plan and office toolbox wire messages', () => {
    const { wire: officeWire } = buildOfficeToolMessage('ppt-draft', '做一份发布会 PPT', {
      hasAttachments: false,
    })
    const { wire } = buildPlanModeMessage(officeWire)

    expect(sanitizeSessionTitle(wire)).toBe('做一份发布会 PPT')
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

  it('uses the visible user prompt for current attachment parser XML tags', () => {
    const wire = [
      'The user uploaded attachments. The following attachment parse results were generated from those files.',
      '<attachment_parse_results>',
      '# Parsed file',
      '</attachment_parse_results>',
      '<user_message>',
      'How many paragraphs are there?',
      '</user_message>',
    ].join('\n')

    expect(sanitizeSessionTitle(wire)).toBe('How many paragraphs are there?')
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

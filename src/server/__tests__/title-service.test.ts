import { describe, expect, test } from 'bun:test'
import { deriveTitle, getTitleInputText } from '../services/titleService.js'

describe('titleService', () => {
  test('extracts the visible prompt from CE workflow scaffolding', () => {
    const wire = [
      '[Workflow: standard delivery]',
      'When scope is unclear, use /ce-plan first.',
      '',
      '--- CE automation (binding) ---',
      'Preset "standard".',
      '',
      'User message:',
      'Build the settings screen',
    ].join('\n')

    expect(getTitleInputText(wire)).toBe('Build the settings screen')
    expect(deriveTitle(wire)).toBe('Build the settings screen')
  })

  test('extracts the visible prompt from attachment parser scaffolding', () => {
    const wire = [
      '用户上传了附件。',
      '<附件解析结果>',
      '# Parsed file',
      '</附件解析结果>',
      '<用户正文>',
      'Review this file',
      '</用户正文>',
    ].join('\n')

    expect(getTitleInputText(wire)).toBe('Review this file')
    expect(deriveTitle(wire)).toBe('Review this file')
  })

  test('extracts the visible prompt from plan mode scaffolding', () => {
    const wire = [
      '[Agent mode: plan]',
      'The user selected a product-facing planning mode.',
      '',
      'User message:',
      'Design the new composer modes',
    ].join('\n')

    expect(getTitleInputText(wire)).toBe('Design the new composer modes')
    expect(deriveTitle(wire)).toBe('Design the new composer modes')
  })

  test('extracts the visible prompt from nested attachment and CE workflow scaffolding', () => {
    const ceWire = [
      '[Workflow: standard delivery]',
      'When scope is unclear, use /ce-plan first.',
      '',
      '--- CE automation (binding) ---',
      'Preset "standard".',
      '',
      'User message:',
      'Review this PDF',
    ].join('\n')
    const wire = [
      '用户上传了附件。',
      '<附件解析结果>',
      '# Parsed file',
      '</附件解析结果>',
      '<用户正文>',
      ceWire,
      '</用户正文>',
    ].join('\n')

    expect(getTitleInputText(wire)).toBe('Review this PDF')
    expect(deriveTitle(wire)).toBe('Review this PDF')
  })
})

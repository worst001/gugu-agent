import { afterEach, describe, expect, test } from 'bun:test'

import {
  buildCursorAgentArgs,
  getCursorAgentCommand,
  resolveCursorModelSlug,
} from './cursorBridge.js'

describe('cursor bridge command resolution', () => {
  const original = process.env.CC_HAHA_CURSOR_AGENT_BIN

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CC_HAHA_CURSOR_AGENT_BIN
    } else {
      process.env.CC_HAHA_CURSOR_AGENT_BIN = original
    }
  })

  test('uses explicit command first', () => {
    process.env.CC_HAHA_CURSOR_AGENT_BIN = 'from-env'
    expect(getCursorAgentCommand('custom-agent')).toBe('custom-agent')
  })

  test('falls back to environment command', () => {
    process.env.CC_HAHA_CURSOR_AGENT_BIN = 'from-env'
    expect(getCursorAgentCommand()).toBe('from-env')
  })

  test('defaults to agent binary name', () => {
    delete process.env.CC_HAHA_CURSOR_AGENT_BIN
    expect(getCursorAgentCommand()).toBe('agent')
  })
})

describe('cursor bridge args', () => {
  test('passes model before prompt when provided', () => {
    expect(
      buildCursorAgentArgs({
        mode: 'plan',
        model: 'gpt-5.5-extra-high',
        prompt: 'make a plan',
      }),
    ).toEqual([
      '-p',
      '--trust',
      '--output-format',
      'text',
      '--mode',
      'plan',
      '--model',
      'gpt-5.5-extra-high',
      'make a plan',
    ])
  })

  test('omits model flag for empty values', () => {
    expect(
      buildCursorAgentArgs({
        mode: 'ask',
        model: '   ',
        prompt: 'review this',
      }),
    ).toEqual([
      '-p',
      '--trust',
      '--output-format',
      'text',
      '--mode',
      'ask',
      'review this',
    ])
  })

  test('maps cursor reasoning into the model slug', () => {
    expect(
      buildCursorAgentArgs({
        mode: 'plan',
        model: 'gpt-5.5',
        reasoning: 'extra-high',
        prompt: 'make a plan',
      }),
    ).toContain('gpt-5.5-extra-high')
  })

  test('sanitizes hidden control characters in reasoning values', () => {
    expect(
      buildCursorAgentArgs({
        mode: 'plan',
        model: 'gpt-5.5',
        reasoning: 'extra-high\u0001',
        prompt: 'make a plan',
      }),
    ).toContain('gpt-5.5-extra-high')
  })
})

describe('cursor model slug resolution', () => {
  test('appends normalized reasoning suffix', () => {
    expect(resolveCursorModelSlug('gpt-5.5', 'xhigh')).toBe(
      'gpt-5.5-extra-high',
    )
  })

  test('does not duplicate an existing reasoning suffix', () => {
    expect(resolveCursorModelSlug('gpt-5.5-extra-high', 'extra-high')).toBe(
      'gpt-5.5-extra-high',
    )
  })

  test('leaves model unchanged for auto or unknown reasoning', () => {
    expect(resolveCursorModelSlug('gpt-5.5', 'auto')).toBe('gpt-5.5')
    expect(resolveCursorModelSlug('gpt-5.5', 'turbo')).toBe('gpt-5.5')
  })
})

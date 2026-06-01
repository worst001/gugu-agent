import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { resolveProviderCapabilities } from '../proxy/providerCapabilities.js'
import {
  buildPrefixStabilitySnapshot,
  diffPrefixStabilitySnapshots,
  observePrefixStability,
  resetPrefixStabilityForTests,
} from '../proxy/prefixStability.js'
import type { AnthropicRequest } from '../proxy/transform/types.js'

const baseRequest: AnthropicRequest = {
  model: 'deepseek-chat',
  max_tokens: 100,
  system: 'Do not leak this system prompt secret.',
  messages: [{ role: 'user', content: 'Hi' }],
  tools: [{
    name: 'search',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    },
  }],
}

const capabilities = resolveProviderCapabilities({
  apiFormat: 'openai_chat',
  baseUrl: 'https://api.deepseek.com',
  model: baseRequest.model,
})

const genericCapabilityMode = {
  providerFamily: null,
  supportsImages: true,
  openAIChat: {
    reasoningContentReplay: true,
    requiresReasoningContentForToolCalls: false,
    thinkingRequestParam: null,
    cacheTelemetryStyle: 'openai',
  },
} as const

beforeEach(() => {
  resetPrefixStabilityForTests()
})

afterEach(() => {
  delete process.env.CC_GUGU_PROXY_PREFIX_DEBUG
  resetPrefixStabilityForTests()
})

describe('prefix stability', () => {
  test('builds deterministic fingerprints for stable prefix components', () => {
    const first = buildPrefixStabilitySnapshot(baseRequest, capabilities)
    const second = buildPrefixStabilitySnapshot({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Different volatile user turn' }],
    }, capabilities)

    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.summary.toolNames).toEqual(['search'])
    expect(first.summary.providerFamily).toBe('deepseek')
  })

  test('reports obvious drift components without exposing raw system prompt text', () => {
    const first = buildPrefixStabilitySnapshot(baseRequest, capabilities)
    const second = buildPrefixStabilitySnapshot({
      ...baseRequest,
      system: 'A changed system prompt.',
      tools: [{
        name: 'search',
        input_schema: {
          type: 'object',
          properties: { q: { type: 'string' }, limit: { type: 'number' } },
        },
      }],
    }, capabilities)

    expect(diffPrefixStabilitySnapshots(first, second)).toEqual(['system', 'tools'])
    expect(JSON.stringify(second)).not.toContain('A changed system prompt')
  })

  test('debug observation is silent by default and logs drift when enabled', () => {
    const calls: unknown[][] = []
    const originalDebug = console.debug
    console.debug = (...args: unknown[]) => {
      calls.push(args)
    }

    try {
      expect(observePrefixStability(baseRequest, {
        apiFormat: 'openai_chat',
        baseUrl: 'https://api.deepseek.com',
        capabilities,
      }).status).toBe('disabled')
      expect(calls).toHaveLength(0)

      process.env.CC_GUGU_PROXY_PREFIX_DEBUG = '1'
      const baseline = observePrefixStability(baseRequest, {
        apiFormat: 'openai_chat',
        baseUrl: 'https://api.deepseek.com',
        capabilities,
      })
      const drift = observePrefixStability({
        ...baseRequest,
        system: 'Changed system prompt',
      }, {
        apiFormat: 'openai_chat',
        baseUrl: 'https://api.deepseek.com',
        capabilities,
      })

      expect(baseline.status).toBe('baseline')
      expect(drift.status).toBe('drift')
      expect(drift).toMatchObject({ changedComponents: ['system'] })
      expect(calls[0][0]).toBe('[Proxy] Prefix stability baseline')
      expect(calls[1][0]).toBe('[Proxy] Prefix stability drift')
      expect(JSON.stringify(calls)).not.toContain('Changed system prompt')
      expect(JSON.stringify(drift)).not.toContain('Changed system prompt')
    } finally {
      console.debug = originalDebug
    }
  })

  test('planner and executor previews share prefix unless cache-critical fields drift', () => {
    const plannerPreview = buildPrefixStabilitySnapshot({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Plan the next file inspection.' }],
    }, capabilities)
    const executorPreview = buildPrefixStabilitySnapshot({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Execute the next file inspection.' }],
    }, capabilities)

    expect(executorPreview.fingerprint).toBe(plannerPreview.fingerprint)

    const executorWithProviderDrift = buildPrefixStabilitySnapshot({
      ...baseRequest,
      messages: [{ role: 'user', content: 'Execute the next file inspection.' }],
    }, genericCapabilityMode)

    expect(diffPrefixStabilitySnapshots(plannerPreview, executorWithProviderDrift))
      .toEqual(['providerCapabilities'])
  })
})

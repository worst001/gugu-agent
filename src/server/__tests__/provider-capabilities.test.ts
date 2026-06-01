import { describe, expect, test } from 'bun:test'

import { resolveProviderCapabilities } from '../proxy/providerCapabilities.js'

describe('provider capabilities', () => {
  test('detects DeepSeek-like OpenAI Chat custom endpoints', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-reasoner',
    })

    expect(capabilities.providerFamily).toBe('deepseek')
    expect(capabilities.supportsImages).toBe(false)
    expect(capabilities.openAIChat).toMatchObject({
      reasoningContentReplay: true,
      requiresReasoningContentForToolCalls: true,
      thinkingRequestParam: 'deepseek',
      cacheTelemetryStyle: 'deepseek',
    })
  })

  test('keeps generic OpenAI-compatible endpoints on generic capabilities', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o',
    })

    expect(capabilities.providerFamily).toBeNull()
    expect(capabilities.supportsImages).toBe(true)
    expect(capabilities.openAIChat).toMatchObject({
      reasoningContentReplay: true,
      requiresReasoningContentForToolCalls: false,
      thinkingRequestParam: null,
      cacheTelemetryStyle: 'openai',
    })
  })

  test('does not enable OpenAI Chat-only DeepSeek fields for non-chat formats', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-pro',
    })

    expect(capabilities.providerFamily).toBe('deepseek')
    expect(capabilities.supportsImages).toBe(false)
    expect(capabilities.openAIChat.requiresReasoningContentForToolCalls).toBe(false)
    expect(capabilities.openAIChat.thinkingRequestParam).toBeNull()
  })
})

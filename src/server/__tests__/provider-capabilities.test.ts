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
      cumulativeStreamDeltas: false,
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

  test('detects GLM OpenAI Chat capabilities', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5',
    })

    expect(capabilities.providerFamily).toBe('glm')
    expect(capabilities.openAIChat).toMatchObject({
      thinkingRequestParam: 'glm',
      cumulativeStreamDeltas: true,
      toolStream: true,
    })
  })

  test('detects Kimi OpenAI Chat capabilities', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.6',
    })

    expect(capabilities.providerFamily).toBe('kimi')
    expect(capabilities.supportsImages).toBe(true)
    expect(capabilities.openAIChat).toMatchObject({
      reasoningContentReplay: true,
      requiresReasoningContentForToolCalls: false,
      thinkingRequestParam: 'kimi',
    })
  })


  test('does not send current GLM thinking fields to legacy GLM models', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
    })

    expect(capabilities.providerFamily).toBe('glm')
    expect(capabilities.openAIChat.thinkingRequestParam).toBeNull()
    expect(capabilities.openAIChat.toolStream).toBe(false)
  })

  test('does not enable K2 thinking fields for legacy Moonshot models', () => {
    const capabilities = resolveProviderCapabilities({
      apiFormat: 'openai_chat',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'moonshot-v1-128k',
    })

    expect(capabilities.providerFamily).toBe('kimi')
    expect(capabilities.openAIChat.thinkingRequestParam).toBeNull()
  })

})

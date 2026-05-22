import { describe, expect, test } from 'bun:test'

import { buildOpenAIEndpoint } from '../proxy/openaiEndpoint.js'

describe('buildOpenAIEndpoint', () => {
  test('adds v1 for root OpenAI-compatible base URLs', () => {
    expect(buildOpenAIEndpoint('https://api.example.com', 'chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions')
    expect(buildOpenAIEndpoint('https://api.example.com/', 'responses'))
      .toBe('https://api.example.com/v1/responses')
  })

  test('does not duplicate version paths already present in provider base URLs', () => {
    expect(buildOpenAIEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1', 'chat/completions'))
      .toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(buildOpenAIEndpoint('https://ark.cn-beijing.volces.com/api/v3', 'chat/completions'))
      .toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
    expect(buildOpenAIEndpoint('https://api.example.com/openai/v1/', 'responses'))
      .toBe('https://api.example.com/openai/v1/responses')
  })
})

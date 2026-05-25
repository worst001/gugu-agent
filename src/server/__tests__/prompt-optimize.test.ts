import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handlePromptOptimizeApi, parsePromptOptimizeModelText } from '../api/prompt-optimize.js'
import { ProviderService } from '../services/providerService.js'
import type { CreateProviderInput } from '../types/provider.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof fetch

function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  return { req, url, segments: url.pathname.split('/').filter(Boolean) }
}

function providerInput(overrides?: Partial<CreateProviderInput>): CreateProviderInput {
  return {
    presetId: 'custom',
    name: 'Prompt Provider',
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-prompt',
    apiFormat: 'anthropic',
    models: {
      main: 'model-main',
      haiku: 'model-haiku',
      sonnet: 'model-sonnet',
      opus: 'model-opus',
    },
    ...overrides,
  }
}

async function seedActiveProvider(): Promise<string> {
  const service = new ProviderService()
  const provider = await service.addProvider(providerInput())
  await service.activateProvider(provider.id)
  return provider.id
}

function mockAnthropicFetch(text: string, status = 200) {
  return mockAnthropicFetchSequence([text], status)
}

function mockAnthropicFetchSequence(texts: string[], status = 200) {
  const calls: Array<{ input: unknown; init?: RequestInit; body: Record<string, unknown> }> = []
  const mockFetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ input, init, body })
    if (status >= 400) {
      return Response.json(
        { error: { message: 'upstream unavailable' } },
        { status },
      )
    }
    const text = texts[Math.min(calls.length - 1, texts.length - 1)] ?? ''
    return Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'model-main',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    })
  }
  ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mockFetch as typeof fetch
  return calls
}

describe('Prompt Optimize API', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-optimize-test-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    originalFetch = globalThis.fetch
  })

  afterEach(async () => {
    ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch
    if (originalConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    } else {
      delete process.env.CLAUDE_CONFIG_DIR
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('returns 400 for empty text', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', { text: '   ' })
    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('must not be empty')
  })

  test('returns readable error when no provider is configured', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: 'Please optimize this detailed implementation request for a coding agent. It should preserve the existing provider configuration and mention tests.',
    })
    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('No active provider')
  })

  test('uses the requested provider model and parses JSON output', async () => {
    const providerId = await seedActiveProvider()
    const calls = mockAnthropicFetch(JSON.stringify({
      optimizedText: 'Create a concise landing page and list the sections.',
      summary: 'Clarified scope and output.',
    }))
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: 'make website',
      providerId,
      modelId: 'model-sonnet',
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.model).toBe('model-sonnet')
    expect(calls[0].init?.headers).toMatchObject({
      'x-api-key': 'sk-prompt',
    })
    expect(calls[0].init?.signal).toBeUndefined()
    const body = await res.json() as { optimizedText: string; summary: string }
    expect(body.optimizedText).toBe('Create a concise landing page and list the sections.')
    expect(body.summary).toBe('Clarified scope and output.')
  })

  test('sends an explicit same-language contract for Chinese prompts', async () => {
    const providerId = await seedActiveProvider()
    const calls = mockAnthropicFetch(JSON.stringify({
      optimizedText: '请创建一个财务系统，包含收入支出记录、账户管理和基础财务报表。',
      summary: '补充了功能范围。',
    }))
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: '写个财务系统',
      providerId,
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.system).toContain('same natural language')
    const messages = calls[0].body.messages as Array<{ content: string }>
    expect(messages[0].content).toContain('"outputLanguage":"Chinese"')
    expect(messages[0].content).toContain('Both optimizedText and summary must use Chinese.')
  })

  test('retries when a Chinese prompt is optimized into English', async () => {
    await seedActiveProvider()
    const calls = mockAnthropicFetchSequence([
      JSON.stringify({
        optimizedText: 'Create a financial system with reports.',
        summary: 'Clarified scope.',
      }),
      JSON.stringify({
        optimizedText: '请创建一个财务系统，包含收支记录、账户管理和财务报表生成。',
        summary: '补充了核心功能范围。',
      }),
    ])
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: '写个财务系统',
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(2)
    const retryMessages = calls[1].body.messages as Array<{ content: string }>
    expect(retryMessages[0].content).toContain('Retry reason')
    const body = await res.json() as { optimizedText: string; summary: string }
    expect(body.optimizedText).toBe('请创建一个财务系统，包含收支记录、账户管理和财务报表生成。')
    expect(body.summary).toBe('补充了核心功能范围。')
  })

  test('normalizes an English summary fallback for a Chinese optimized prompt', async () => {
    await seedActiveProvider()
    mockAnthropicFetch(JSON.stringify({
      optimizedText: '请创建一个财务系统，包含收支记录、账户管理和财务报表生成。',
      summary: 'Clarified scope.',
    }))
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: '写个财务系统',
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { optimizedText: string; summary: string }
    expect(body.optimizedText).toBe('请创建一个财务系统，包含收支记录、账户管理和财务报表生成。')
    expect(body.summary).toBe('已生成优化后的提示词。')
  })

  test('falls back to plain text when the model does not return JSON', async () => {
    await seedActiveProvider()
    const calls = mockAnthropicFetch('Please implement the feature with focused tests.')
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: 'Refactor src/server/router.ts to expose the new resource and keep tests focused.',
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(calls[0].body.model).toBe('model-haiku')
    const body = await res.json() as { optimizedText: string; summary: string }
    expect(body.optimizedText).toBe('Please implement the feature with focused tests.')
    expect(body.summary).toBe('Optimized prompt generated.')
  })

  test('returns upstream failures as readable API errors', async () => {
    await seedActiveProvider()
    mockAnthropicFetch('', 503)
    const { req, url, segments } = makeRequest('POST', '/api/prompt-optimize', {
      text: 'Refactor src/server/router.ts to expose the new resource and keep tests focused.',
    })

    const res = await handlePromptOptimizeApi(req, url, segments)

    expect(res.status).toBe(502)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('upstream unavailable')
  })
})

describe('parsePromptOptimizeModelText', () => {
  test('extracts fenced JSON output', () => {
    expect(parsePromptOptimizeModelText('```json\n{"optimizedText":"Better","summary":"Why"}\n```')).toEqual({
      optimizedText: 'Better',
      summary: 'Why',
    })
  })

  test('extracts optimizedText from truncated JSON-like output', () => {
    expect(parsePromptOptimizeModelText('{"optimizedText":"构建一个简单网站，用于列出去年的热门动漫。","summary":"')).toEqual({
      optimizedText: '构建一个简单网站，用于列出去年的热门动漫。',
      summary: 'Optimized prompt generated.',
    })
  })

  test('keeps plain text fallback for non-JSON model output', () => {
    expect(parsePromptOptimizeModelText('Please implement this with focused tests.')).toEqual({
      optimizedText: 'Please implement this with focused tests.',
      summary: 'Optimized prompt generated.',
    })
  })

  test('rejects JSON-like output without an optimized prompt instead of exposing raw JSON', () => {
    expect(() => parsePromptOptimizeModelText('{"summary":"Only summary"}')).toThrow('malformed JSON')
  })
})

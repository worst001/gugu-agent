import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import { chatgptAuthService } from '../services/chatgptAuthService.js'
import { handleProxyRequest } from '../proxy/handler.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalFetch: typeof fetch

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalFetch = globalThis.fetch
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  globalThis.fetch = originalFetch
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

describe('ChatGPT provider integration', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('ensureChatGPTProvider creates active proxy-managed provider', async () => {
    const svc = new ProviderService()
    const provider = await svc.ensureChatGPTProvider()
    const settingsRaw = await fs.readFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      'utf-8',
    )
    const settings = JSON.parse(settingsRaw) as { env: Record<string, string> }

    expect(provider.authKind).toBe('chatgpt_oauth')
    expect(provider.apiFormat).toBe('chatgpt_codex')
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3456/proxy')
    expect(settings.env.ANTHROPIC_API_KEY).toBe('proxy-managed')
    expect(settings.env.ANTHROPIC_MODEL).toBe('gpt-5.4')
  })

  test('ensureChatGPTProvider does not steal an existing active provider during refresh', async () => {
    const svc = new ProviderService()
    const deepseek = await svc.addProvider({
      presetId: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'deepseek-key',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      models: {
        main: 'deepseek-v4-pro',
        haiku: 'deepseek-v4-pro',
        sonnet: 'deepseek-v4-pro',
        opus: 'deepseek-v4-pro',
      },
    })
    await svc.activateProvider(deepseek.id)

    const chatgpt = await svc.ensureChatGPTProvider()
    const { activeId } = await svc.listProviders()
    const settingsRaw = await fs.readFile(
      path.join(tmpDir, 'cc-haha', 'settings.json'),
      'utf-8',
    )
    const settings = JSON.parse(settingsRaw) as { env: Record<string, string> }

    expect(chatgpt.authKind).toBe('chatgpt_oauth')
    expect(activeId).toBe(deepseek.id)
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic')
    expect(settings.env.ANTHROPIC_MODEL).toBe('deepseek-v4-pro')
  })

  test('proxy passes through Anthropic-format active providers', async () => {
    const svc = new ProviderService()
    const deepseek = await svc.addProvider({
      presetId: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'deepseek-key',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      models: {
        main: 'deepseek-v4-pro',
        haiku: 'deepseek-v4-pro',
        sonnet: 'deepseek-v4-pro',
        opus: 'deepseek-v4-pro',
      },
    })
    await svc.activateProvider(deepseek.id)

    let upstreamUrl = ''
    let upstreamHeaders: Headers | null = null
    let upstreamBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-v4-pro',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    const res = await handleProxyRequest(req, new URL(req.url))
    const body = await res.json() as { type: string; content: Array<{ text: string }> }

    expect(res.status).toBe(200)
    expect(upstreamUrl).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(upstreamHeaders?.get('x-api-key')).toBe('deepseek-key')
    expect(upstreamBody?.model).toBe('deepseek-v4-pro')
    expect(body.type).toBe('message')
    expect(body.content[0]?.text).toBe('ok')
  })

  test('proxy rejects image input for known text-only providers', async () => {
    const svc = new ProviderService()
    const deepseek = await svc.addProvider({
      presetId: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'deepseek-key',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiFormat: 'anthropic',
      models: {
        main: 'deepseek-v4-pro',
        haiku: 'deepseek-v4-pro',
        sonnet: 'deepseek-v4-pro',
        opus: 'deepseek-v4-pro',
      },
    })
    await svc.activateProvider(deepseek.id)

    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return Response.json({})
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        max_tokens: 64,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            { type: 'text', text: '看图' },
          ],
        }],
      }),
    })

    const res = await handleProxyRequest(req, new URL(req.url))
    const body = await res.json() as { error: { message: string } }

    expect(res.status).toBe(400)
    expect(fetchCalled).toBe(false)
    expect(body.error.message).toContain('does not support image input')
  })

  test('proxy sends ChatGPT OAuth token to Codex endpoint', async () => {
    const svc = new ProviderService()
    await svc.ensureChatGPTProvider()
    await chatgptAuthService.saveTokens({
      accessToken: 'chatgpt-access',
      refreshToken: 'chatgpt-refresh',
      expiresAt: Date.now() + 3600_000,
      accountId: 'acc_test',
    })

    let upstreamUrl = ''
    let upstreamHeaders: Headers | null = null
    let upstreamBody: Record<string, unknown> | null = null
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamUrl = String(input)
      upstreamHeaders = new Headers(init?.headers)
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      const sse = [
        'event: response.created',
        'data: {"model":"gpt-5.4"}',
        '',
        'event: response.content_part.added',
        'data: {"output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}',
        '',
        'event: response.output_text.delta',
        'data: {"output_index":0,"content_index":0,"delta":"ok"}',
        '',
        'event: response.output_text.done',
        'data: {"output_index":0,"content_index":0,"text":"ok"}',
        '',
        'event: response.completed',
        'data: {"response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
        '',
      ].join('\n')
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    const body = await res.json() as { type: string; content: Array<{ text: string }> }

    expect(res.status).toBe(200)
    expect(upstreamUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(upstreamHeaders?.get('authorization')).toBe('Bearer chatgpt-access')
    expect(upstreamHeaders?.get('ChatGPT-Account-Id')).toBe('acc_test')
    expect(upstreamBody?.instructions).toBeDefined()
    expect(upstreamBody?.store).toBe(false)
    expect(upstreamBody?.stream).toBe(true)
    expect(body.type).toBe('message')
    expect(body.content[0]?.text).toBe('ok')
  })
})

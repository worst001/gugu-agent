import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import { chatgptAuthService } from '../services/chatgptAuthService.js'
import { handleProxyRequest } from '../proxy/handler.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalProxyStreamTimeout: string | undefined
let originalProxyStreamIdleTimeout: string | undefined
let originalProxyStreamPingInterval: string | undefined
let originalFetch: typeof fetch

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-provider-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalProxyStreamTimeout = process.env.CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS
  originalProxyStreamIdleTimeout = process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS
  originalProxyStreamPingInterval = process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS
  originalFetch = globalThis.fetch
  process.env.CLAUDE_CONFIG_DIR = tmpDir
}

async function teardown() {
  globalThis.fetch = originalFetch
  if (originalProxyStreamTimeout === undefined) {
    delete process.env.CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS
  } else {
    process.env.CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS = originalProxyStreamTimeout
  }
  if (originalProxyStreamIdleTimeout === undefined) {
    delete process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS
  } else {
    process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS = originalProxyStreamIdleTimeout
  }
  if (originalProxyStreamPingInterval === undefined) {
    delete process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS
  } else {
    process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS = originalProxyStreamPingInterval
  }
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
    expect(body.error.message).toContain('DeepSeek')
    expect(body.error.message).toContain('does not support image content blocks')
  })

  test('proxy accepts OpenAI-compatible base URLs that already include a version path', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'doubao-ark',
      name: 'Doubao',
      apiKey: 'ark-key',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiFormat: 'openai_chat',
      models: {
        main: 'doubao-seed-1-6-250615',
        haiku: 'doubao-seed-1-6-flash-250615',
        sonnet: 'doubao-seed-1-6-250615',
        opus: 'doubao-seed-1-6-thinking-250615',
      },
    })
    await svc.activateProvider(provider.id)

    let upstreamUrl = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      upstreamUrl = String(input)
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'doubao-seed-1-6-250615',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'doubao-seed-1-6-250615',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    const res = await handleProxyRequest(req, new URL(req.url))
    const body = await res.json() as { type: string; content: Array<{ text: string }> }

    expect(res.status).toBe(200)
    expect(upstreamUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions')
    expect(body.type).toBe('message')
    expect(body.content[0]?.text).toBe('ok')
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

  test('stream proxy timeout does not abort after upstream responds', async () => {
    process.env.CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS = '10'
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'openai-compatible',
      name: 'OpenAI Compatible',
      apiKey: 'openai-key',
      baseUrl: 'https://openai-compatible.test',
      apiFormat: 'openai_chat',
      models: {
        main: 'gpt-test',
        haiku: 'gpt-test',
        sonnet: 'gpt-test',
        opus: 'gpt-test',
      },
    })
    await svc.activateProvider(provider.id)

    let upstreamSignal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal as AbortSignal | undefined
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
            '',
          ].join('\n')))
          setTimeout(() => {
            controller.enqueue(encoder.encode([
              'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
              '',
              'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n')))
            controller.close()
          }, 25)
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    await new Promise((resolve) => setTimeout(resolve, 30))
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(upstreamSignal?.aborted).toBe(false)
    expect(text).toContain('content_block_delta')
    expect(text).toContain('ok')
  })

  test('stream proxy does not install a fixed timeout by default', async () => {
    delete process.env.CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS
    process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS = '0'
    process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS = '0'
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'openai-compatible',
      name: 'OpenAI Compatible',
      apiKey: 'openai-key',
      baseUrl: 'https://openai-compatible.test',
      apiFormat: 'openai_chat',
      models: {
        main: 'gpt-test',
        haiku: 'gpt-test',
        sonnet: 'gpt-test',
        opus: 'gpt-test',
      },
    })
    await svc.activateProvider(provider.id)

    let upstreamSignal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal as AbortSignal | undefined
      return new Response([
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}',
        '',
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}',
        '',
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(upstreamSignal?.aborted).toBe(false)
    expect(text).toContain('ok')
  })

  test('stream proxy emits pings without cutting an active long stream', async () => {
    process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS = '0'
    process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS = '5'
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'openai-compatible',
      name: 'OpenAI Compatible',
      apiKey: 'openai-key',
      baseUrl: 'https://openai-compatible.test',
      apiFormat: 'openai_chat',
      models: {
        main: 'gpt-test',
        haiku: 'gpt-test',
        sonnet: 'gpt-test',
        opus: 'gpt-test',
      },
    })
    await svc.activateProvider(provider.id)

    globalThis.fetch = (async () => {
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(encoder.encode([
              'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
              '',
              'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","created":1,"model":"gpt-test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
              '',
              'data: [DONE]',
              '',
            ].join('\n')))
            controller.close()
          }, 20)
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('event: ping')
    expect(text).toContain('ok')
  })

  test('stream proxy closes with a recovery error after upstream idle timeout', async () => {
    process.env.CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS = '20'
    process.env.CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS = '5'
    const svc = new ProviderService()
    const provider = await svc.addProvider({
      presetId: 'openai-compatible',
      name: 'OpenAI Compatible',
      apiKey: 'openai-key',
      baseUrl: 'https://openai-compatible.test',
      apiFormat: 'openai_chat',
      models: {
        main: 'gpt-test',
        haiku: 'gpt-test',
        sonnet: 'gpt-test',
        opus: 'gpt-test',
      },
    })
    await svc.activateProvider(provider.id)

    let upstreamSignal: AbortSignal | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal as AbortSignal | undefined
      return new Response(new ReadableStream<Uint8Array>({
        start() {
          // Keep the upstream stream open without real model chunks.
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const req = new Request('http://127.0.0.1:3456/proxy/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const res = await handleProxyRequest(req, new URL(req.url))
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(upstreamSignal?.aborted).toBe(true)
    expect(text).toContain('event: ping')
    expect(text).toContain('event: error')
    expect(text).toContain('已中止本轮以恢复会话')
  })
})

import { describe, expect, test } from 'bun:test'

import { runChatGPTBridge } from './chatgptBridge.js'
import type { SavedProvider } from '../../server/types/provider.js'

const provider: SavedProvider = {
  id: 'chatgpt-provider-id',
  presetId: 'chatgpt',
  name: 'ChatGPT Connect',
  apiKey: '',
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  apiFormat: 'chatgpt_codex',
  authKind: 'chatgpt_oauth',
  models: {
    main: 'gpt-5.4',
    haiku: 'gpt-5.4-mini',
    sonnet: 'gpt-5.4',
    opus: 'gpt-5.4',
  },
}

describe('chatgpt stage bridge', () => {
  test('uses scoped ChatGPT provider proxy without activating the provider', async () => {
    let activate: boolean | undefined
    let serverStarted = false
    let requestUrl = ''
    let requestBody: Record<string, unknown> | undefined

    const result = await runChatGPTBridge(
      {
        prompt: 'make a plan',
        system: 'planner system',
      },
      {
        providerService: {
          async ensureChatGPTProvider(options) {
            activate = options?.activate
            return provider
          },
          async getProviderRuntimeEnv(id) {
            expect(id).toBe(provider.id)
            return {
              ANTHROPIC_BASE_URL:
                'http://127.0.0.1:3456/proxy/providers/chatgpt-provider-id',
              ANTHROPIC_API_KEY: 'proxy-managed',
              ANTHROPIC_MODEL: 'gpt-5.4',
            }
          },
        },
        async ensureServer() {
          serverStarted = true
        },
        async fetchFn(url, init) {
          requestUrl = String(url)
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
          return Response.json({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'gpt-5.4',
            content: [{ type: 'text', text: 'planned result' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 2 },
          })
        },
      },
    )

    expect(result).toEqual({ ok: true, output: 'planned result', model: 'gpt-5.4' })
    expect(activate).toBe(false)
    expect(serverStarted).toBe(true)
    expect(requestUrl).toBe(
      'http://127.0.0.1:3456/proxy/providers/chatgpt-provider-id/v1/messages',
    )
    expect(requestBody?.model).toBe('gpt-5.4')
    expect(requestBody?.system).toBe('planner system')
  })

  test('returns a /connect hint for authentication failures', async () => {
    const result = await runChatGPTBridge(
      { prompt: 'make a plan' },
      {
        providerService: {
          async ensureChatGPTProvider() {
            return provider
          },
          async getProviderRuntimeEnv() {
            return {
              ANTHROPIC_BASE_URL:
                'http://127.0.0.1:3456/proxy/providers/chatgpt-provider-id',
              ANTHROPIC_API_KEY: 'proxy-managed',
              ANTHROPIC_MODEL: 'gpt-5.4',
            }
          },
        },
        async ensureServer() {},
        async fetchFn() {
          return Response.json(
            {
              error: {
                message: 'ChatGPT is not connected. Use Connect ChatGPT first.',
              },
            },
            { status: 401 },
          )
        },
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('HTTP 401')
      expect(result.error).toContain('/connect')
    }
  })
})

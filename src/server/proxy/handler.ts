/**
 * Proxy Handler — protocol-translating reverse proxy for OpenAI-compatible APIs.
 *
 * Receives Anthropic Messages API requests from the CLI, transforms them to
 * OpenAI Chat Completions or Responses API format, forwards to the upstream
 * provider, and transforms the response back to Anthropic format.
 *
 * Derived from cc-switch (https://github.com/farion1231/cc-switch)
 * Original work by Jason Young, MIT License
 */

import { ProviderService } from '../services/providerService.js'
import { anthropicToOpenaiChat } from './transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from './transform/anthropicToOpenaiResponses.js'
import { anthropicToChatGPTCodexRequest } from './transform/chatgptCodexRequest.js'
import { openaiChatToAnthropic } from './transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from './transform/openaiResponsesToAnthropic.js'
import { openaiChatStreamToAnthropic } from './streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from './streaming/openaiResponsesStreamToAnthropic.js'
import { buildOpenAIEndpoint } from './openaiEndpoint.js'
import type { AnthropicContentBlock, AnthropicRequest, AnthropicResponse } from './transform/types.js'
import {
  CHATGPT_CODEX_API_ENDPOINT,
  chatgptAuthService,
} from '../services/chatgptAuthService.js'
import { billingService } from '../services/billingService.js'

const providerService = new ProviderService()
const DEFAULT_PROXY_STREAM_CONNECT_TIMEOUT_MS = 0
const DEFAULT_PROXY_STREAM_IDLE_TIMEOUT_MS = 300_000
const DEFAULT_PROXY_STREAM_PING_INTERVAL_MS = 15_000
const DEFAULT_PROXY_REQUEST_TIMEOUT_MS = 300_000
const PROXY_STREAM_IDLE_MESSAGE = '模型长时间没有返回内容，已中止本轮以恢复会话。你可以重新发送请求，或稍后再试。'

type UpstreamFetchResult = {
  response: Response
  abort?: () => void
}

type RequestTimeoutOverride = number | null | undefined

function getTimeoutMs(envName: string, fallback: number): number | undefined {
  const raw = process.env[envName]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isFinite(value) || value < 0) return fallback || undefined
  return value === 0 ? undefined : value
}

async function fetchUpstream(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  isStream: boolean,
  options: { requestTimeoutMs?: RequestTimeoutOverride } = {},
): Promise<UpstreamFetchResult> {
  if (!isStream) {
    const timeoutMs = options.requestTimeoutMs === undefined
      ? getTimeoutMs('CC_HAHA_PROXY_REQUEST_TIMEOUT_MS', DEFAULT_PROXY_REQUEST_TIMEOUT_MS)
      : options.requestTimeoutMs
    const response = await fetch(input, {
      ...init,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    })
    return { response }
  }

  const controller = new AbortController()
  const timeoutMs = getTimeoutMs(
    'CC_HAHA_PROXY_STREAM_CONNECT_TIMEOUT_MS',
    DEFAULT_PROXY_STREAM_CONNECT_TIMEOUT_MS,
  )
  if (!timeoutMs) {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    return { response, abort: () => controller.abort(PROXY_STREAM_IDLE_MESSAGE) }
  }

  const timer = setTimeout(() => {
    controller.abort(new DOMException('Upstream stream connection timed out.', 'TimeoutError'))
  }, timeoutMs)
  const unref = (timer as { unref?: () => void }).unref
  if (unref) {
    unref.call(timer)
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    })
    return { response, abort: () => controller.abort(PROXY_STREAM_IDLE_MESSAGE) }
  } finally {
    clearTimeout(timer)
  }
}

function formatSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function getStreamIdleTimeoutMs(): number | undefined {
  return getTimeoutMs(
    'CC_HAHA_PROXY_STREAM_IDLE_TIMEOUT_MS',
    DEFAULT_PROXY_STREAM_IDLE_TIMEOUT_MS,
  )
}

function getStreamPingIntervalMs(): number | undefined {
  return getTimeoutMs(
    'CC_HAHA_PROXY_STREAM_PING_INTERVAL_MS',
    DEFAULT_PROXY_STREAM_PING_INTERVAL_MS,
  )
}

function getRequestTimeoutHeader(req: Request): RequestTimeoutOverride {
  const raw = req.headers.get('x-cc-haha-proxy-request-timeout-ms')
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return undefined
  return value === 0 ? null : value
}

function wrapAnthropicSseStream(
  upstream: ReadableStream<Uint8Array>,
  options: {
    abortUpstream?: () => void
    idleTimeoutMs?: number
    pingIntervalMs?: number
  } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader()
      let pingTimer: ReturnType<typeof setInterval> | null = null
      let closed = false

      const clearTimers = () => {
        if (pingTimer) {
          clearInterval(pingTimer)
          pingTimer = null
        }
      }

      const close = () => {
        if (closed) return
        closed = true
        clearTimers()
        controller.close()
      }

      const enqueue = (chunk: string | Uint8Array) => {
        if (closed) return
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      }

      const emitIdleError = () => {
        if (closed) return
        closed = true
        clearTimers()
        options.abortUpstream?.()
        void reader.cancel(PROXY_STREAM_IDLE_MESSAGE).catch(() => {})
        controller.enqueue(encoder.encode(formatSse('error', {
          type: 'error',
          error: {
            type: 'api_error',
            message: PROXY_STREAM_IDLE_MESSAGE,
          },
        })))
        controller.close()
      }

      if (options.pingIntervalMs) {
        pingTimer = setInterval(() => {
          enqueue(formatSse('ping', { type: 'ping' }))
        }, options.pingIntervalMs)
      }

      try {
        while (!closed) {
          let timeout: ReturnType<typeof setTimeout> | null = null
          const readResult = await Promise.race([
            reader.read().then((result) => ({ kind: 'read' as const, result })),
            ...(options.idleTimeoutMs
              ? [new Promise<{ kind: 'timeout' }>((resolve) => {
                  timeout = setTimeout(() => resolve({ kind: 'timeout' }), options.idleTimeoutMs)
                })]
              : []),
          ])
          if (timeout) clearTimeout(timeout)

          if (readResult.kind === 'timeout') {
            emitIdleError()
            break
          }

          const { done, value } = readResult.result
          if (done) break
          enqueue(value)
        }
        close()
      } catch (err) {
        clearTimers()
        if (!closed) {
          closed = true
          controller.error(err)
        }
      }
    },
    cancel() {
      options.abortUpstream?.()
    },
  })
}

function monitorAnthropicSseStream(
  upstream: ReadableStream<Uint8Array>,
  abortUpstream?: () => void,
): ReadableStream<Uint8Array> {
  return wrapAnthropicSseStream(upstream, {
    abortUpstream,
    idleTimeoutMs: getStreamIdleTimeoutMs(),
    pingIntervalMs: getStreamPingIntervalMs(),
  })
}

export async function handleProxyRequest(req: Request, url: URL): Promise<Response> {
  const providerMatch = url.pathname.match(/^\/proxy\/providers\/([^/]+)\/v1\/messages$/)
  const providerId = providerMatch ? decodeURIComponent(providerMatch[1]!) : undefined
  const isActiveProxyPath = url.pathname === '/proxy/v1/messages'
  const isGuguManagedProxyPath = url.pathname === '/proxy/gugu-managed/v1/messages'

  // Only handle POST /proxy/v1/messages or POST /proxy/providers/:providerId/v1/messages
  if (req.method !== 'POST' || (!isActiveProxyPath && !providerMatch && !isGuguManagedProxyPath)) {
    return Response.json(
      {
        error: 'Not Found',
        message: 'Proxy only handles POST /proxy/v1/messages, POST /proxy/gugu-managed/v1/messages, and POST /proxy/providers/:providerId/v1/messages',
      },
      { status: 404 },
    )
  }

  if (isGuguManagedProxyPath) {
    try {
      return await handleGuguManaged(req)
    } catch (err) {
      console.error('[Proxy] Gugu Gateway request failed:', err)
      return Response.json(
        {
          type: 'error',
          error: {
            type: 'api_error',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        { status: 502 },
      )
    }
  }

  // Read active/default provider config or an explicitly-scoped provider config.
  const config = await providerService.getProviderForProxy(providerId)
  if (!config) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: providerId
            ? `Provider "${providerId}" is not configured for proxy`
            : 'No active provider configured for proxy',
        },
      },
      { status: 400 },
    )
  }

  // Parse request body
  let body: AnthropicRequest
  try {
    body = (await req.json()) as AnthropicRequest
  } catch {
    return Response.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } },
      { status: 400 },
    )
  }

  const isStream = body.stream === true
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const requestTimeoutMs = getRequestTimeoutHeader(req)

  if (hasImageInput(body) && isKnownTextOnlyProvider(baseUrl, body.model)) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: getUnsupportedImageInputMessage(baseUrl, body.model),
        },
      },
      { status: 400 },
    )
  }

  try {
    if (config.apiFormat === 'anthropic') {
      return await handleAnthropicPassThrough(req, body, baseUrl, config.apiKey, isStream, requestTimeoutMs)
    }
    if (config.apiFormat === 'chatgpt_codex') {
      return await handleChatGPTCodex(body, isStream, requestTimeoutMs)
    }
    if (config.apiFormat === 'gugu_managed') {
      return await handleGuguManaged(req, body)
    }
    if (config.apiFormat === 'openai_chat') {
      return await handleOpenaiChat(body, baseUrl, config.apiKey, isStream, requestTimeoutMs)
    } else {
      return await handleOpenaiResponses(body, baseUrl, config.apiKey, isStream, requestTimeoutMs)
    }
  } catch (err) {
    console.error('[Proxy] Upstream request failed:', err)
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 502 },
    )
  }
}

function hasImageInput(body: AnthropicRequest): boolean {
  return body.messages.some((message) => {
    if (!Array.isArray(message.content)) return false
    return message.content.some((block) => {
      if (block.type === 'image') return true
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) return false
      return block.content.some((nested) => nested.type === 'image')
    })
  })
}

function isKnownTextOnlyProvider(baseUrl: string, model: string): boolean {
  const haystack = `${baseUrl} ${model}`.toLowerCase()
  return haystack.includes('deepseek')
}

function getUnsupportedImageInputMessage(baseUrl: string, model: string): string {
  const haystack = `${baseUrl} ${model}`.toLowerCase()
  if (haystack.includes('deepseek')) {
    return `DeepSeek's Anthropic-compatible API currently does not support image content blocks, including DeepSeek V4 models. Model "${model}" can only receive text/tool content through this provider. Switch to a vision-capable provider/model, or send text only.`
  }
  return `Model "${model}" does not support image input on the active provider. Switch to a vision-capable provider/model, or send text only.`
}

async function handleGuguManaged(
  req: Request,
  parsedBody?: AnthropicRequest,
): Promise<Response> {
  let body = parsedBody
  if (!body) {
    try {
      body = (await req.json()) as AnthropicRequest
    } catch {
      return Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON in request body' } },
        { status: 400 },
      )
    }
  }

  const isStream = body.stream === true
  const requestTimeoutMs = getRequestTimeoutHeader(req)
  const auth = await billingService.ensureGatewayDevice()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.deviceToken}`,
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
  }
  const anthropicBeta = req.headers.get('anthropic-beta')
  if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

  const { response: upstream, abort: abortUpstream } = await fetchUpstream(`${auth.gatewayUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, isStream, { requestTimeoutMs })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    const errorBody = parseJsonObject(errText)
    const quotaMessage = readGatewayQuotaMessage(errorBody)
    return Response.json(
      {
        type: 'error',
        error: {
          type: upstream.status === 402 ? 'quota_exceeded' : 'api_error',
          message: quotaMessage || `Gugu Gateway returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
        ...(errorBody ? { gugu: errorBody } : {}),
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Gugu Gateway returned no body for stream' } },
        { status: 502 },
      )
    }
    return new Response(monitorAnthropicSseStream(upstream.body, abortUpstream), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  const responseBody = await upstream.text()
  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  })
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

function readGatewayQuotaMessage(body: Record<string, unknown> | null): string | null {
  const error = body?.error
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  if (record.code !== 'GUGU_QUOTA_EXHAUSTED' && record.code !== 'GUGU_SUBSCRIPTION_INACTIVE') return null
  const message = typeof record.message === 'string' && record.message.trim()
    ? record.message.trim()
    : 'Included credits have been used up. Purchase or activate a plan to continue.'
  return `[GUGU_QUOTA_EXHAUSTED] ${message}`
}

async function handleAnthropicPassThrough(
  req: Request,
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
  requestTimeoutMs?: RequestTimeoutOverride,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
  }
  const anthropicBeta = req.headers.get('anthropic-beta')
  if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

  const { response: upstream, abort: abortUpstream } = await fetchUpstream(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, isStream, { requestTimeoutMs })

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    return new Response(monitorAnthropicSseStream(upstream.body, abortUpstream), {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  const responseBody = await upstream.text()
  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  })
}

async function handleChatGPTCodex(
  body: AnthropicRequest,
  isStream: boolean,
  requestTimeoutMs?: RequestTimeoutOverride,
): Promise<Response> {
  const tokens = await chatgptAuthService.ensureFreshTokens()
  if (!tokens) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'ChatGPT is not connected. Use Connect ChatGPT first.',
        },
      },
      { status: 401 },
    )
  }

  const transformed = anthropicToChatGPTCodexRequest(body)
  transformed.stream = true
  const { response: upstream, abort: abortUpstream } = await fetchUpstream(CHATGPT_CODEX_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      ...(tokens.accountId ? { 'ChatGPT-Account-Id': tokens.accountId } : {}),
      originator: 'cc-haha',
      'User-Agent': `cc-haha (${process.platform} ${process.arch})`,
      session_id: crypto.randomUUID(),
    },
    body: JSON.stringify(transformed),
  }, isStream, { requestTimeoutMs })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: upstream.status === 401 ? 'authentication_error' : 'api_error',
          message: `ChatGPT Codex returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (!upstream.body) {
    return Response.json(
      { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
      { status: 502 },
    )
  }

  const anthropicStream = openaiResponsesStreamToAnthropic(upstream.body, body.model)
  if (isStream) {
    return new Response(monitorAnthropicSseStream(anthropicStream, abortUpstream), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  const anthropicResponse = await collectAnthropicSseStream(anthropicStream, body.model)
  return Response.json(anthropicResponse)
}

async function collectAnthropicSseStream(
  stream: ReadableStream<Uint8Array>,
  fallbackModel: string,
): Promise<AnthropicResponse> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''
  let currentEvent = ''
  let stopped = false
  const content: AnthropicContentBlock[] = []
  const partialJsonByIndex = new Map<number, string>()
  const message: AnthropicResponse = {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: fallbackModel,
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }

  while (!stopped) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('event: ')) {
        currentEvent = trimmed.slice(7).trim()
        continue
      }
      if (!trimmed.startsWith('data: ')) continue
      const jsonStr = trimmed.slice(6)
      if (jsonStr === '[DONE]') {
        stopped = true
        break
      }

      let data: Record<string, unknown>
      try {
        data = JSON.parse(jsonStr) as Record<string, unknown>
      } catch {
        continue
      }

      if (currentEvent === 'message_start') {
        const msg = data.message as Partial<AnthropicResponse> | undefined
        if (msg?.id) message.id = msg.id
        if (msg?.model) message.model = msg.model
        if (msg?.usage) message.usage = msg.usage
      } else if (currentEvent === 'content_block_start') {
        const index = Number(data.index ?? content.length)
        const block = data.content_block as AnthropicContentBlock | undefined
        if (block) content[index] = block
      } else if (currentEvent === 'content_block_delta') {
        const index = Number(data.index ?? content.length - 1)
        const delta = data.delta as Record<string, unknown> | undefined
        const block = content[index]
        if (!delta || !block) continue
        if (delta.type === 'text_delta' && block.type === 'text') {
          block.text += String(delta.text ?? '')
        } else if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
          const nextJson = `${partialJsonByIndex.get(index) ?? ''}${String(delta.partial_json ?? '')}`
          partialJsonByIndex.set(index, nextJson)
        }
      } else if (currentEvent === 'content_block_stop') {
        const index = Number(data.index ?? content.length - 1)
        const block = content[index]
        const partialJson = partialJsonByIndex.get(index)
        if (block?.type === 'tool_use' && partialJson) {
          try {
            block.input = JSON.parse(partialJson) as Record<string, unknown>
          } catch {
            block.input = {}
          }
        }
      } else if (currentEvent === 'message_delta') {
        const delta = data.delta as Record<string, unknown> | undefined
        const usage = data.usage as Record<string, number> | undefined
        if (delta?.stop_reason) message.stop_reason = String(delta.stop_reason)
        if (usage?.output_tokens !== undefined) {
          message.usage.output_tokens = usage.output_tokens
        }
      } else if (currentEvent === 'message_stop') {
        stopped = true
        break
      }
    }
  }

  message.content = content.filter(Boolean)
  return message
}

async function handleOpenaiChat(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
  requestTimeoutMs?: RequestTimeoutOverride,
): Promise<Response> {
  const transformed = anthropicToOpenaiChat(body)
  const url = buildOpenAIEndpoint(baseUrl, 'chat/completions')

  const { response: upstream, abort: abortUpstream } = await fetchUpstream(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
  }, isStream, { requestTimeoutMs })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    const anthropicStream = openaiChatStreamToAnthropic(upstream.body, body.model)
    return new Response(monitorAnthropicSseStream(anthropicStream, abortUpstream), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiChatToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}

async function handleOpenaiResponses(
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
  requestTimeoutMs?: RequestTimeoutOverride,
): Promise<Response> {
  const transformed = anthropicToOpenaiResponses(body)
  const url = buildOpenAIEndpoint(baseUrl, 'responses')

  const { response: upstream, abort: abortUpstream } = await fetchUpstream(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
  }, isStream, { requestTimeoutMs })

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '')
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `Upstream returned HTTP ${upstream.status}: ${errText.slice(0, 500)}`,
        },
      },
      { status: upstream.status },
    )
  }

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream.body, body.model)
    return new Response(monitorAnthropicSseStream(anthropicStream, abortUpstream), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // Non-streaming
  const responseBody = await upstream.json()
  const anthropicResponse = openaiResponsesToAnthropic(responseBody, body.model)
  return Response.json(anthropicResponse)
}

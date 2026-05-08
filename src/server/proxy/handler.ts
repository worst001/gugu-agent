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
import type { AnthropicContentBlock, AnthropicRequest, AnthropicResponse } from './transform/types.js'
import {
  CHATGPT_CODEX_API_ENDPOINT,
  chatgptAuthService,
} from '../services/chatgptAuthService.js'

const providerService = new ProviderService()

export async function handleProxyRequest(req: Request, url: URL): Promise<Response> {
  const providerMatch = url.pathname.match(/^\/proxy\/providers\/([^/]+)\/v1\/messages$/)
  const providerId = providerMatch ? decodeURIComponent(providerMatch[1]!) : undefined
  const isActiveProxyPath = url.pathname === '/proxy/v1/messages'

  // Only handle POST /proxy/v1/messages or POST /proxy/providers/:providerId/v1/messages
  if (req.method !== 'POST' || (!isActiveProxyPath && !providerMatch)) {
    return Response.json(
      {
        error: 'Not Found',
        message: 'Proxy only handles POST /proxy/v1/messages and POST /proxy/providers/:providerId/v1/messages',
      },
      { status: 404 },
    )
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

  if (hasImageInput(body) && isKnownTextOnlyProvider(baseUrl, body.model)) {
    return Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: `Model "${body.model}" does not support image input on the active provider. Switch to a vision-capable provider/model, or send text only.`,
        },
      },
      { status: 400 },
    )
  }

  try {
    if (config.apiFormat === 'anthropic') {
      return await handleAnthropicPassThrough(req, body, baseUrl, config.apiKey, isStream)
    }
    if (config.apiFormat === 'chatgpt_codex') {
      return await handleChatGPTCodex(body, isStream)
    }
    if (config.apiFormat === 'openai_chat') {
      return await handleOpenaiChat(body, baseUrl, config.apiKey, isStream)
    } else {
      return await handleOpenaiResponses(body, baseUrl, config.apiKey, isStream)
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

async function handleAnthropicPassThrough(
  req: Request,
  body: AnthropicRequest,
  baseUrl: string,
  apiKey: string,
  isStream: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
  }
  const anthropicBeta = req.headers.get('anthropic-beta')
  if (anthropicBeta) headers['anthropic-beta'] = anthropicBeta

  const upstream = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

  if (isStream) {
    if (!upstream.body) {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: 'Upstream returned no body for stream' } },
        { status: 502 },
      )
    }
    return new Response(upstream.body, {
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
  const upstream = await fetch(CHATGPT_CODEX_API_ENDPOINT, {
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
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

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
    return new Response(anthropicStream, {
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
): Promise<Response> {
  const transformed = anthropicToOpenaiChat(body)
  const url = `${baseUrl}/v1/chat/completions`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

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
    return new Response(anthropicStream, {
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
): Promise<Response> {
  const transformed = anthropicToOpenaiResponses(body)
  const url = `${baseUrl}/v1/responses`

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(transformed),
    signal: isStream ? AbortSignal.timeout(30_000) : AbortSignal.timeout(300_000),
  })

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
    return new Response(anthropicStream, {
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

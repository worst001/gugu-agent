/**
 * Unit tests for proxy streaming SSE transformation
 */

import { describe, test, expect } from 'bun:test'
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js'

// ─── Helpers ────────────────────────────────────────────────────

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const blocks = text.split('\n\n').filter(Boolean)
  for (const block of blocks) {
    const lines = block.split('\n')
    let event = ''
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7)
      if (line.startsWith('data: ')) data = line.slice(6)
    }
    if (event && data) {
      try {
        events.push({ event, data: JSON.parse(data) })
      } catch {
        // skip unparseable
      }
    }
  }
  return events
}

// ─── OpenAI Chat Completions SSE → Anthropic SSE ───────────────

describe('openaiChatStreamToAnthropic', () => {
  test('basic text streaming', async () => {
    const sseChunks = [
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)

    // Should have: message_start, content_block_start, content_block_delta x2, message_delta, content_block_stop, message_stop
    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe('message_start')
    expect(eventTypes).toContain('content_block_start')
    expect(eventTypes).toContain('content_block_delta')
    expect(eventTypes).toContain('message_delta')
    expect(eventTypes).toContain('message_stop')

    // Check message_start
    const msgStart = events.find((e) => e.event === 'message_start')!
    expect((msgStart.data.message as Record<string, unknown>).model).toBe('gpt-4')
    expect((msgStart.data.message as Record<string, unknown>).role).toBe('assistant')

    // Check text deltas
    const textDeltas = events.filter((e) => e.event === 'content_block_delta')
    const texts = textDeltas.map((e) => (e.data.delta as Record<string, unknown>).text)
    expect(texts).toContain('Hello')
    expect(texts).toContain(' world')

    // Check stop reason
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('end_turn')
  })

  test('keeps identical incremental text chunks', async () => {
    const sseChunks = [
      'data: {"id":"c1-repeat","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-repeat","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"ha"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-repeat","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"ha"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-repeat","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-repeat","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(sseChunks), 'gpt-4'))
    const texts = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as Record<string, unknown>).text)
      .filter((value): value is string => typeof value === 'string')

    expect(texts).toEqual(['ha', 'ha', '!'])
    expect(texts.join('')).toBe('haha!')
  })

  test('deduplicates cumulative text snapshots from OpenAI-compatible providers', async () => {
    const sseChunks = [
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{"content":"alpha"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{"content":"alpha beta"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{"content":"alpha beta"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{"content":"alpha beta gamma"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1-snapshot","object":"chat.completion.chunk","created":0,"model":"compatible-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(
      makeStream(sseChunks),
      'compatible-chat',
      true,
    ))
    const texts = events
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as Record<string, unknown>).text)
      .filter((value): value is string => typeof value === 'string')

    expect(texts).toEqual(['alpha', ' beta', ' gamma'])
    expect(texts.join('')).toBe('alpha beta gamma')
  })
  test('tool call streaming', async () => {
    const sseChunks = [
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":null},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)

    // Should have content_block_start with type tool_use
    const toolStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart!.data.content_block as Record<string, unknown>).name).toBe('get_weather')
    expect((toolStart!.data.content_block as Record<string, unknown>).id).toBe('call_1')

    // Should have input_json_delta
    const jsonDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta',
    )
    expect(jsonDeltas.length).toBeGreaterThan(0)

    // Stop reason should be tool_use
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('tool_use')
  })

  test('empty stream (just DONE)', async () => {
    const upstream = makeStream(['data: [DONE]\n\n'])
    const anthropicStream = openaiChatStreamToAnthropic(upstream, 'gpt-4')
    const events = await collectSse(anthropicStream)
    // Should at least have message_stop
    expect(events.some((e) => e.event === 'message_stop')).toBe(true)
  })

  test('event ordering: content_block_stop before message_delta', async () => {
    const sseChunks = [
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c3","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'gpt-4'))
    const types = events.map((e) => e.event)

    // content_block_stop MUST appear before message_delta
    const stopIdx = types.indexOf('content_block_stop')
    const deltaIdx = types.indexOf('message_delta')
    expect(stopIdx).toBeGreaterThan(-1)
    expect(deltaIdx).toBeGreaterThan(-1)
    expect(stopIdx).toBeLessThan(deltaIdx)

    // message_delta before message_stop
    const msgStopIdx = types.indexOf('message_stop')
    expect(deltaIdx).toBeLessThan(msgStopIdx)
  })

  test('reasoning_content (DeepSeek, OpenRouter, XAI)', async () => {
    const sseChunks = [
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning_content":"Let me think"},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"reasoning_content":" about this..."},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hello!"},"finish_reason":null}]}\n\n',
      'data: {"id":"c4","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'deepseek-chat'))

    // Should have thinking block
    const thinkingStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'thinking',
    )
    expect(thinkingStart).toBeDefined()

    // Should have thinking deltas
    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBeGreaterThan(0)

    // Should have text block after thinking
    const textStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'text',
    )
    expect(textStart).toBeDefined()

    // Text should come after thinking in index order
    expect((textStart!.data as Record<string, unknown>).index).toBeGreaterThan(
      (thinkingStart!.data as Record<string, unknown>).index as number,
    )
  })

  test('reasoning field (GLM-5, Cerebras, Groq)', async () => {
    const sseChunks = [
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"role":"assistant","reasoning":"Thinking here"},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"content":"Result"},"finish_reason":null}]}\n\n',
      'data: {"id":"c5","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'glm-5'))

    // Should produce thinking delta from "reasoning" field
    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBe(1)
    expect((thinkingDeltas[0].data.delta as Record<string, unknown>).thinking).toBe('Thinking here')
  })

  test('thinking_blocks (OpenAI o-series)', async () => {
    const sseChunks = [
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{"role":"assistant","thinking_blocks":[{"type":"thinking","thinking":"Deep thought"}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{"content":"Answer"},"finish_reason":null}]}\n\n',
      'data: {"id":"c6","object":"chat.completion.chunk","created":0,"model":"o3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'o3'))

    const thinkingDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'thinking_delta',
    )
    expect(thinkingDeltas.length).toBe(1)
    expect((thinkingDeltas[0].data.delta as Record<string, unknown>).thinking).toBe('Deep thought')
  })

  test('text + tool transition closes text block first', async () => {
    const sseChunks = [
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Let me search"},"finish_reason":null}]}\n\n',
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c7","object":"chat.completion.chunk","created":0,"model":"gpt-4","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'gpt-4'))
    const types = events.map((e) => e.event)

    // Should see: text block start, text delta, text block stop, tool block start, ...
    const firstBlockStop = types.indexOf('content_block_stop')
    const toolBlockStart = types.findIndex(
      (_, i) => events[i].event === 'content_block_start' && (events[i].data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(firstBlockStop).toBeLessThan(toolBlockStart)
  })

  test('DeepSeek cache usage maps when usage arrives with finish chunk', async () => {
    const sseChunks = [
      'data: {"id":"c8","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c8","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36}}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'deepseek-chat'))
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    const usage = msgDelta.data.usage as Record<string, unknown>

    expect(usage.output_tokens).toBe(5)
    expect(usage.cache_read_input_tokens).toBe(64)
    expect(usage.cache_creation_input_tokens).toBe(36)
  })

  test('DeepSeek cache usage maps when usage arrives as a separate chunk', async () => {
    const sseChunks = [
      'data: {"id":"c9","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
      'data: {"id":"c9","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"c9","object":"chat.completion.chunk","created":0,"model":"deepseek-chat","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":105,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36}}\n\n',
      'data: [DONE]\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const events = await collectSse(openaiChatStreamToAnthropic(upstream, 'deepseek-chat'))
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    const usage = msgDelta.data.usage as Record<string, unknown>

    expect(usage.output_tokens).toBe(5)
    expect(usage.cache_read_input_tokens).toBe(64)
    expect(usage.cache_creation_input_tokens).toBe(36)
  })
})

// ─── OpenAI Responses SSE → Anthropic SSE ──────────────────────

describe('openaiResponsesStreamToAnthropic', () => {
  test('basic text streaming', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r1","model":"gpt-4o","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"message","role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":"Hello"}\n\n',
      'event: response.output_text.delta\ndata: {"output_index":0,"content_index":0,"delta":" world"}\n\n',
      'event: response.output_text.done\ndata: {"output_index":0,"content_index":0,"text":"Hello world"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r1","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream, 'gpt-4o')
    const events = await collectSse(anthropicStream)

    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe('message_start')
    expect(eventTypes).toContain('content_block_start')
    expect(eventTypes).toContain('content_block_delta')
    expect(eventTypes).toContain('content_block_stop')
    expect(eventTypes).toContain('message_delta')
    expect(eventTypes).toContain('message_stop')

    // Check text deltas
    const textDeltas = events.filter((e) => e.event === 'content_block_delta')
    const texts = textDeltas.map((e) => (e.data.delta as Record<string, unknown>).text)
    expect(texts).toContain('Hello')
    expect(texts).toContain(' world')
  })

  test('function call streaming', async () => {
    const sseChunks = [
      'event: response.created\ndata: {"id":"r2","model":"gpt-4o","status":"in_progress"}\n\n',
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"search"}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_1","delta":"{\\"q\\":"}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"item_id":"fc_1","delta":"\\"test\\"}"}\n\n',
      'event: response.function_call_arguments.done\ndata: {"item_id":"fc_1","arguments":"{\\"q\\":\\"test\\"}"}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r2","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":5}}}\n\n',
    ]

    const upstream = makeStream(sseChunks)
    const anthropicStream = openaiResponsesStreamToAnthropic(upstream, 'gpt-4o')
    const events = await collectSse(anthropicStream)

    // Should have tool_use content_block_start
    const toolStart = events.find(
      (e) => e.event === 'content_block_start' && (e.data.content_block as Record<string, unknown>)?.type === 'tool_use',
    )
    expect(toolStart).toBeDefined()
    expect((toolStart!.data.content_block as Record<string, unknown>).name).toBe('search')

    // Should have input_json_delta
    const jsonDeltas = events.filter(
      (e) => e.event === 'content_block_delta' && (e.data.delta as Record<string, unknown>)?.type === 'input_json_delta',
    )
    expect(jsonDeltas.length).toBeGreaterThan(0)

    // Stop reason should be tool_use
    const msgDelta = events.find((e) => e.event === 'message_delta')!
    expect((msgDelta.data.delta as Record<string, unknown>).stop_reason).toBe('tool_use')
  })
})


describe('OpenAI-compatible snapshot streaming regressions', () => {
  test('deduplicates cumulative and repeated reasoning snapshots', async () => {
    const chunks = [
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"reasoning":"Inspecting files"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"reasoning":"Inspecting files and tests"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{"reasoning":"Inspecting files and tests"},"finish_reason":null}]}\n\n',
      'data: {"id":"c1","object":"chat.completion.chunk","created":0,"model":"glm-5","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(chunks), 'glm-5', true))
    const thinking = events
      .filter((event) => event.event === 'content_block_delta')
      .map((event) => event.data.delta as Record<string, unknown>)
      .filter((delta) => delta.type === 'thinking_delta')
      .map((delta) => delta.thinking)

    expect(thinking).toEqual(['Inspecting files', ' and tests'])
  })

  test('preserves identical consecutive text deltas', async () => {
    const repeated = 'repeat this phrase'
    const chunks = [
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"generic","choices":[{"index":0,"delta":{"content":"' + repeated + '"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"generic","choices":[{"index":0,"delta":{"content":"' + repeated + '"},"finish_reason":null}]}\n\n',
      'data: {"id":"c2","object":"chat.completion.chunk","created":0,"model":"generic","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collectSse(openaiChatStreamToAnthropic(makeStream(chunks), 'generic'))
    const text = events
      .filter((event) => event.event === 'content_block_delta')
      .map((event) => event.data.delta as Record<string, unknown>)
      .filter((delta) => delta.type === 'text_delta')
      .map((delta) => delta.text)
      .join('')

    expect(text).toBe(repeated + repeated)
  })
})

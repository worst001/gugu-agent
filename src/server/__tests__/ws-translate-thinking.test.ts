import { describe, expect, it } from 'bun:test'
import { translateCliMessage } from '../ws/handler.js'

describe('translateCliMessage thinking bridge', () => {
  const sid = () => `ws-think-${Math.random().toString(36).slice(2)}`

  it('forwards thinking from final assistant when stream_events ran but no thinking_delta arrived', () => {
    const sessionId = sid()
    translateCliMessage(
      {
        type: 'stream_event',
        event: { type: 'message_start' },
      },
      sessionId,
    )
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
      },
      sessionId,
    )
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Reasoning only in final payload.' },
            { type: 'text', text: 'hello' },
          ],
        },
      },
      sessionId,
    )

    expect(out.some((m) => m.type === 'thinking' && m.text === 'Reasoning only in final payload.')).toBe(
      true,
    )
  })

  it('does not duplicate thinking when thinking_delta already streamed', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'part-a' },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'full duplicate' },
            { type: 'text', text: 'ok' },
          ],
        },
      },
      sessionId,
    )

    expect(out.filter((m) => m.type === 'thinking')).toHaveLength(0)
  })

  it('does not emit content_start for thinking blocks', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
    const out = translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking' },
        },
      },
      sessionId,
    )

    expect(out).toEqual([])
  })

  it('turns repeated assistant snapshots without stream events into suffix deltas', () => {
    const sessionId = sid()
    const first = translateCliMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Configured API key auth.' }] },
      },
      sessionId,
    )
    const second = translateCliMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Configured API key auth. Ready.' }] },
      },
      sessionId,
    )
    const duplicate = translateCliMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Configured API key auth. Ready.' }] },
      },
      sessionId,
    )

    expect(first).toContainEqual({ type: 'content_delta', text: 'Configured API key auth.' })
    expect(second).toContainEqual({ type: 'content_delta', text: ' Ready.' })
    expect(duplicate).toEqual([])

    translateCliMessage({ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } }, sessionId)
    const nextTurn = translateCliMessage(
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Configured API key auth.' }] },
      },
      sessionId,
    )
    expect(nextTurn).toContainEqual({ type: 'content_delta', text: 'Configured API key auth.' })
  })
})

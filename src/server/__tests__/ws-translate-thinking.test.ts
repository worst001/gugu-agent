import { describe, expect, it } from 'bun:test'
import { __testing, translateCliMessage } from '../ws/handler.js'

describe('translateCliMessage thinking bridge', () => {
  const sid = () => `ws-think-${Math.random().toString(36).slice(2)}`

  it('turns max-turn results into a recoverable system notification', () => {
    const out = translateCliMessage(
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        result: '阶段摘要：已经读取了模型目录，下一步应先列目录。',
        errors: ['Reached maximum number of turns (20)'],
        usage: { input_tokens: 3, output_tokens: 5 },
      },
      sid(),
    )

    expect(out).toHaveLength(2)
    expect(out[0]?.type).toBe('system_notification')
    if (out[0]?.type === 'system_notification') {
      expect(out[0].subtype).toBe('max_turns_reached')
      expect(out[0].message).toContain('阶段摘要')
    }
    expect(out[1]).toEqual({
      type: 'message_complete',
      usage: { input_tokens: 3, output_tokens: 5 },
    })
  })

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

  it('emits a final assistant tool_use when stream events never completed the tool input', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu-write',
            name: 'Write',
          },
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
          delta: {
            type: 'input_json_delta',
            partial_json: '{"file_path":"/tmp/index.html"',
          },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu-write',
              name: 'Write',
              input: {
                file_path: '/tmp/index.html',
                content: '<!DOCTYPE html>',
              },
            },
          ],
        },
      },
      sessionId,
    )

    expect(out).toEqual([
      {
        type: 'tool_use_complete',
        toolName: 'Write',
        toolUseId: 'toolu-write',
        input: {
          file_path: '/tmp/index.html',
          content: '<!DOCTYPE html>',
        },
        parentToolUseId: undefined,
      },
    ])
  })

  it('emits final assistant text that never arrived through stream deltas', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
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

    const out = translateCliMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Final text only.' }],
        },
      },
      sessionId,
    )

    expect(out).toContainEqual({ type: 'content_start', blockType: 'text' })
    expect(out).toContainEqual({ type: 'content_delta', text: 'Final text only.' })
  })

  it('does not duplicate final assistant text already streamed as deltas', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Final text only.' },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Final text only.' }],
        },
      },
      sessionId,
    )

    expect(out.filter((message) => message.type === 'content_delta')).toHaveLength(0)
  })

  it('treats text message_stop as a completed turn when result is delayed or missing', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
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
          delta: { type: 'text_delta', text: 'What table should I create?' },
        },
      },
      sessionId,
    )
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { input_tokens: 7, output_tokens: 11 },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      { type: 'stream_event', event: { type: 'message_stop' } },
      sessionId,
    )

    expect(out).toEqual([
      {
        type: 'message_complete',
        usage: { input_tokens: 7, output_tokens: 11 },
      },
    ])
  })

  it('does not complete the turn on tool-use message_stop', () => {
    const sessionId = sid()
    translateCliMessage({ type: 'stream_event', event: { type: 'message_start' } }, sessionId)
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu-read',
            name: 'Read',
          },
        },
      },
      sessionId,
    )
    translateCliMessage(
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
        },
      },
      sessionId,
    )

    const out = translateCliMessage(
      { type: 'stream_event', event: { type: 'message_stop' } },
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

  it('suppresses stop-triggered diagnostic errors when stream key differs from session id', () => {
    const sessionId = sid()
    const streamKey = `${sessionId}:stream`
    const usage = { input_tokens: 0, output_tokens: 0 }

    __testing.markStopRequestedForTest(sessionId)
    const out = translateCliMessage(
      {
        type: 'result',
        is_error: true,
        result: [
          '[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use',
          'Error: 1P event logging: 107 events failed to export (status=403)',
          'Error: No suitable shell found. Claude CLI requires a Posix shell environment.',
        ].join('\n'),
        usage,
      },
      streamKey,
      sessionId,
    )
    __testing.clearStopRequestedForTest(sessionId)

    expect(out).toEqual([{ type: 'message_complete', usage }])
  })

  it('keeps suppressing delayed diagnostic errors shortly after stop', () => {
    const sessionId = sid()
    const usage = { input_tokens: 0, output_tokens: 0 }

    __testing.markStopRequestedForTest(sessionId)
    translateCliMessage(
      {
        type: 'result',
        usage,
      },
      `${sessionId}:first-stream`,
      sessionId,
    )
    const delayedError = translateCliMessage(
      {
        type: 'result',
        is_error: true,
        result: 'Error: 1P event logging: 2 events failed to export (status=403)',
        usage,
      },
      `${sessionId}:second-stream`,
      sessionId,
    )
    __testing.clearStopRequestedForTest(sessionId)

    expect(delayedError).toEqual([{ type: 'message_complete', usage }])
  })
})

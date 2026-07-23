import { describe, expect, test } from 'bun:test'
import { ILinkClient, normalizeInboundText } from './ilink.js'

describe('ILinkClient', () => {
  test('long-polls with the previous cursor and bearer credentials', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const client = new ILinkClient({
      accountId: 'bot-1',
      token: 'secret-token',
      baseUrl: 'https://example.weixin.qq.com',
      fetchFn: async (input, init) => {
        captured = { url: String(input), init }
        return Response.json({
          ret: 0,
          msgs: [],
          get_updates_buf: 'cursor-2',
        })
      },
    })

    const response = await client.getUpdates('cursor-1')

    expect(response.get_updates_buf).toBe('cursor-2')
    expect(captured?.url).toBe(
      'https://example.weixin.qq.com/ilink/bot/getupdates',
    )
    expect(new Headers(captured?.init?.headers).get('Authorization'))
      .toBe('Bearer secret-token')
    expect(JSON.parse(String(captured?.init?.body))).toEqual(
      expect.objectContaining({ get_updates_buf: 'cursor-1' }),
    )
  })

  test('sends text with the inbound context token', async () => {
    let body: Record<string, any> | undefined
    const client = new ILinkClient({
      accountId: 'bot-1',
      token: 'secret-token',
      baseUrl: 'https://example.weixin.qq.com',
      fetchFn: async (_input, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json({ ret: 0 })
      },
    })

    await client.sendText('user-1', 'hello', 'context-1')

    expect(body?.msg).toEqual(expect.objectContaining({
      to_user_id: 'user-1',
      message_type: 2,
      message_state: 2,
      context_token: 'context-1',
      item_list: [{ type: 1, text_item: { text: 'hello' } }],
    }))
  })

  test('keeps the long-poll timeout when a shutdown signal is supplied', async () => {
    const controller = new AbortController()
    const client = new ILinkClient({
      accountId: 'bot-1',
      token: 'secret-token',
      baseUrl: 'https://example.weixin.qq.com',
      longPollTimeoutMs: 5,
      fetchFn: async (_input, init) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason)
          }, { once: true })
        })
      },
    })

    expect(await client.getUpdates('cursor-1', controller.signal)).toEqual({
      ret: 0,
      msgs: [],
      get_updates_buf: 'cursor-1',
    })
  })

  test('treats provider errcode as a send failure', async () => {
    const client = new ILinkClient({
      accountId: 'bot-1',
      token: 'secret-token',
      baseUrl: 'https://example.weixin.qq.com',
      fetchFn: async () => Response.json({
        ret: 0,
        errcode: 40001,
        errmsg: 'invalid token',
      }),
    })

    await expect(client.sendText('user-1', 'hello'))
      .rejects.toThrow('40001 invalid token')
  })
})

describe('normalizeInboundText', () => {
  test('joins text items and namespaces the conversation by account', () => {
    expect(normalizeInboundText('bot-1', {
      message_id: 42,
      from_user_id: 'user-1',
      message_type: 1,
      context_token: 'context-1',
      item_list: [
        { type: 1, text_item: { text: 'first' } },
        { type: 2 },
        { type: 1, text_item: { text: 'second' } },
      ],
    })).toEqual({
      conversationId: 'weixin:bot-1:user-1',
      userId: 'user-1',
      displayName: 'WeChat user',
      text: 'first\nsecond',
      messageId: '42',
      contextToken: 'context-1',
    })
  })

  test('ignores bot messages and empty user messages', () => {
    expect(normalizeInboundText('bot-1', {
      from_user_id: 'user-1',
      message_type: 2,
      item_list: [{ type: 1, text_item: { text: 'bot' } }],
    })).toBeNull()
    expect(normalizeInboundText('bot-1', {
      from_user_id: 'user-1',
      message_type: 1,
      item_list: [{ type: 2 }],
    })).toBeNull()
  })
})

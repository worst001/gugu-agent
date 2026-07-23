import { randomBytes, randomUUID } from 'node:crypto'

export type WeixinMessageItem = {
  type?: number
  text_item?: { text?: string }
}

export type WeixinMessage = {
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  message_type?: number
  message_state?: number
  item_list?: WeixinMessageItem[]
  context_token?: string
}

export type GetUpdatesResponse = {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type NormalizedInboundText = {
  conversationId: string
  userId: string
  displayName: string
  text: string
  messageId?: string
  contextToken?: string
}

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type ILinkClientOptions = {
  accountId: string
  token: string
  baseUrl: string
  fetchFn?: FetchFn
  longPollTimeoutMs?: number
}

const BASE_INFO = {
  channel_version: '1.0.0',
  bot_agent: 'GuguAgent/1.0.0',
}

function randomWechatUin(): string {
  return Buffer.from(
    String(randomBytes(4).readUInt32BE(0)),
    'utf-8',
  ).toString('base64')
}

export function normalizeInboundText(
  accountId: string,
  message: WeixinMessage,
): NormalizedInboundText | null {
  if (message.message_type !== 1 || !message.from_user_id) return null
  const text = (message.item_list ?? [])
    .filter((item) => item.type === 1 && item.text_item?.text?.trim())
    .map((item) => item.text_item!.text!.trim())
    .join('\n')
  if (!text) return null

  return {
    conversationId: `weixin:${accountId}:${message.from_user_id}`,
    userId: message.from_user_id,
    displayName: 'WeChat user',
    text,
    ...(message.message_id !== undefined
      ? { messageId: String(message.message_id) }
      : {}),
    ...(message.context_token
      ? { contextToken: message.context_token }
      : {}),
  }
}

export class ILinkClient {
  private fetchFn: FetchFn
  private baseUrl: string
  private longPollTimeoutMs: number

  constructor(private options: ILinkClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.longPollTimeoutMs = options.longPollTimeoutMs ?? 35_000
  }

  async getUpdates(
    cursor: string,
    signal?: AbortSignal,
  ): Promise<GetUpdatesResponse> {
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(signal?.reason)
    if (signal?.aborted) abortFromCaller()
    else signal?.addEventListener('abort', abortFromCaller, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.longPollTimeoutMs)

    try {
      return await this.post<GetUpdatesResponse>(
        'ilink/bot/getupdates',
        { get_updates_buf: cursor, base_info: BASE_INFO },
        controller.signal,
      )
    } catch (error) {
      if (timedOut) {
        return { ret: 0, msgs: [], get_updates_buf: cursor }
      }
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  async sendText(
    toUserId: string,
    text: string,
    contextToken?: string,
  ): Promise<void> {
    const response = await this.post<{ ret?: number; errcode?: number; errmsg?: string }>(
      'ilink/bot/sendmessage',
      {
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `gugu-weixin-${randomUUID()}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text } }],
          ...(contextToken ? { context_token: contextToken } : {}),
        },
        base_info: BASE_INFO,
      },
      AbortSignal.timeout(15_000),
    )
    if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
      const code = response.errcode ?? response.ret
      throw new Error(
        `WeChat sendMessage failed: ${code} ${response.errmsg ?? ''}`.trim(),
      )
    }
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        Authorization: `Bearer ${this.options.token}`,
        'X-WECHAT-UIN': randomWechatUin(),
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': '65536',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      throw new Error(`WeChat ${endpoint} failed: ${response.status}`)
    }
    return await response.json() as T
  }
}

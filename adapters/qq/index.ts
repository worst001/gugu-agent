import * as fs from 'node:fs/promises'
import { Bot, ReceiverMode, segment, type GroupMessageEvent, type PrivateMessageEvent, type Sendable } from 'qq-official-bot'
import WebSocket from 'ws'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import { loadConfig } from '../common/config.js'
import { splitMessage } from '../common/format.js'
import { inferMimeType, isAudioMime, isImageMime, isVideoMime } from '../common/mime.js'
import { TextChatRunner, type OutboundFilePayload, type OutboundImagePayload } from '../common/text-chat-runner.js'
import {
  collectQqAttachments,
  parseOfficialMessage,
  parseOneBotMessage,
  type OneBotFileResolver,
} from './media.js'

const QQ_TEXT_LIMIT = 1800

const config = loadConfig()
const attachmentStore = new AttachmentStore()
attachmentStore.gc().catch((err) => {
  console.warn('[QQ] AttachmentStore.gc failed:', err instanceof Error ? err.message : err)
})

const hasOfficialBot = Boolean(config.qq.appId && (config.qq.appSecret || config.qq.token))
const hasOneBotBridge = Boolean(config.qq.oneBotUrl)

if (!hasOfficialBot && !hasOneBotBridge) {
  console.error('[QQ] Missing QQ_APP_ID / QQ_APP_SECRET or QQ_ONEBOT_URL. Set env or ~/.claude/adapters.json')
  process.exit(1)
}

if (hasOneBotBridge) {
  startOneBot()
} else {
  startOfficialBot()
}

function conversationTarget(conversationId: string): { kind: 'private' | 'group'; id: string } {
  const [, kind, id] = conversationId.split(':')
  return {
    kind: kind === 'group' ? 'group' : 'private',
    id: id ?? '',
  }
}

function startOfficialBot(): void {
  const bot = new Bot({
    appid: config.qq.appId,
    secret: config.qq.appSecret || config.qq.token,
    sandbox: config.qq.sandbox,
    removeAt: true,
    logLevel: 'info',
    maxRetry: 10,
    intents: ['GROUP_AND_C2C_EVENT'],
    mode: ReceiverMode.WEBSOCKET,
  })

  async function sendOfficialText(conversationId: string, text: string): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    for (const chunk of splitMessage(text, QQ_TEXT_LIMIT)) {
      if (kind === 'group') {
        await bot.sendGroupMessage(id, chunk)
      } else {
        await bot.sendPrivateMessage(id, chunk)
      }
    }
  }

  async function sendOfficialMessage(conversationId: string, message: Sendable): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    if (kind === 'group') {
      await bot.sendGroupMessage(id, message)
    } else {
      await bot.sendPrivateMessage(id, message)
    }
  }

  async function sendOfficialImage(conversationId: string, image: OutboundImagePayload): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    const source = image.replyToMessageId ? { id: image.replyToMessageId } : undefined
    const payload = segment.image(image.buffer, { name: image.fileName }) as Sendable
    if (kind === 'group') {
      await bot.sendGroupMessage(id, payload, source)
    } else {
      await bot.sendPrivateMessage(id, payload, source)
    }
    if (image.caption) {
      await sendOfficialText(conversationId, image.caption)
    }
  }

  async function sendOfficialFile(conversationId: string, file: OutboundFilePayload): Promise<void> {
    const mimeType = file.mimeType ?? inferMimeType(file.path)
    if (isImageMime(mimeType)) {
      const buffer = await fs.readFile(file.path)
      await sendOfficialImage(conversationId, {
        buffer,
        fileName: file.fileName,
        mimeType,
        caption: file.caption,
      })
      return
    }
    if (isVideoMime(mimeType)) {
      await sendOfficialMessage(conversationId, segment.video(file.path, { name: file.fileName }) as Sendable)
      if (file.caption) await sendOfficialText(conversationId, file.caption)
      return
    }
    if (isAudioMime(mimeType)) {
      await sendOfficialMessage(conversationId, segment.audio(file.path, { name: file.fileName }) as Sendable)
      if (file.caption) await sendOfficialText(conversationId, file.caption)
      return
    }
    await sendOfficialText(
      conversationId,
      `已生成文件，但 QQ 官方 Bot 当前只支持直接发送图片、音频和视频。文件位置：${file.path}`,
    )
  }

  const runner = new TextChatRunner({
    platform: 'qq',
    serverUrl: config.serverUrl,
    defaultProjectDir: config.defaultProjectDir,
    sendText: sendOfficialText,
    sendImage: sendOfficialImage,
    sendFile: sendOfficialFile,
    mediaHelpLine: '图片/文件：可直接发给我；需要当前屏幕时发送“截图给我”。官方 Bot 发送通用文件受平台限制，图片/音频/视频可直接回复。',
    screenshotTmpPrefix: 'gugu-qq-shot-',
    userLabel: 'QQ User',
  })

  async function handleOfficialEvent(event: PrivateMessageEvent | GroupMessageEvent, conversationId: string): Promise<void> {
    const parsed = parseOfficialMessage(event.raw_message, event.message)
    const { attachments, rejections } = await collectQqAttachments({
      segments: parsed.segments,
      sessionId: conversationId,
      attachmentStore,
    })

    for (const rejection of rejections) {
      await sendOfficialText(conversationId, rejection).catch(() => {})
    }
    if (!parsed.text && attachments.length === 0) return

    await runner.handleIncomingText({
      conversationId,
      userId: 'group_id' in event ? `group:${event.group_id}` : event.user_id,
      displayName: 'group_name' in event
        ? event.group_name || 'QQ Group'
        : event.sender?.user_name || 'QQ User',
      text: parsed.text,
      messageId: event.message_id,
      attachments,
    })
  }

  bot.on('message.private', (event) => {
    void handleOfficialEvent(event, `qq:private:${event.user_id}`)
  })

  bot.on('message.group', (event) => {
    void handleOfficialEvent(event, `qq:group:${event.group_id}`)
  })

  console.log('[QQ] Starting official bot...')
  console.log(`[QQ] Server: ${config.serverUrl}`)
  console.log(`[QQ] Allowed users: ${config.qq.allowedUsers.length === 0 ? 'paired users only' : config.qq.allowedUsers.join(', ')}`)

  bot.start().then(() => {
    console.log('[QQ] Bot is running! (WebSocket connected)')
  }).catch((err) => {
    console.error('[QQ] Failed to start:', err)
    process.exit(1)
  })

  process.on('SIGINT', () => {
    console.log('[QQ] Shutting down...')
    void bot.stop()
    runner.destroy()
    process.exit(0)
  })
}

type OneBotMessageEvent = {
  post_type?: string
  message_type?: 'private' | 'group'
  user_id?: number | string
  group_id?: number | string
  message_id?: number | string
  raw_message?: string
  message?: unknown
}

type OneBotActionResponse = {
  echo?: string
  status?: string
  retcode?: number
  data?: unknown
  message?: string
  wording?: string
}

function startOneBot(): void {
  const headers = config.qq.oneBotAccessToken
    ? { Authorization: `Bearer ${config.qq.oneBotAccessToken}` }
    : undefined
  const ws = new WebSocket(config.qq.oneBotUrl, { headers })
  let echoSeq = 0
  const pendingActions = new Map<string, {
    resolve: (value: OneBotActionResponse) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  function requestAction(
    action: string,
    params: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<OneBotActionResponse> {
    if (ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not open'))
    }
    const echo = `qq-${Date.now()}-${++echoSeq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingActions.delete(echo)
        reject(new Error(`OneBot action timeout: ${action}`))
      }, timeoutMs)
      pendingActions.set(echo, { resolve, reject, timer })
      ws.send(JSON.stringify({ action, params, echo }))
    })
  }

  async function sendAction(
    action: string,
    params: Record<string, unknown>,
    options: { suppressError?: boolean } = {},
  ): Promise<void> {
    try {
      const response = await requestAction(action, params)
      if (response.status && response.status !== 'ok') {
        throw new Error(response.message || response.wording || `retcode ${response.retcode ?? 'unknown'}`)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[QQ OneBot] action failed:', action, error.message)
      if (!options.suppressError) throw error
    }
  }

  async function sendOneBotText(conversationId: string, text: string): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    for (const chunk of splitMessage(text, QQ_TEXT_LIMIT)) {
      if (kind === 'group') {
        await sendAction('send_group_msg', { group_id: id, message: chunk }, { suppressError: true })
      } else {
        await sendAction('send_private_msg', { user_id: id, message: chunk }, { suppressError: true })
      }
    }
  }

  async function sendOneBotMessage(conversationId: string, message: unknown[]): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    if (kind === 'group') {
      await sendAction('send_group_msg', { group_id: id, message })
    } else {
      await sendAction('send_private_msg', { user_id: id, message })
    }
  }

  async function sendOneBotImage(conversationId: string, image: OutboundImagePayload): Promise<void> {
    const message: unknown[] = [
      { type: 'image', data: { file: `base64://${image.buffer.toString('base64')}`, name: image.fileName } },
    ]
    if (image.caption) message.push({ type: 'text', data: { text: `\n${image.caption}` } })
    await sendOneBotMessage(conversationId, message)
  }

  async function sendOneBotFile(conversationId: string, file: OutboundFilePayload): Promise<void> {
    const { kind, id } = conversationTarget(conversationId)
    const action = kind === 'group' ? 'upload_group_file' : 'upload_private_file'
    const params = kind === 'group'
      ? { group_id: id, file: file.path, name: file.fileName }
      : { user_id: id, file: file.path, name: file.fileName }
    try {
      const response = await requestAction(action, params, 20_000)
      if (response.status && response.status !== 'ok') {
        throw new Error(response.message || response.wording || `retcode ${response.retcode ?? 'unknown'}`)
      }
      if (file.caption) await sendOneBotText(conversationId, file.caption)
    } catch (err) {
      console.warn('[QQ OneBot] upload file failed:', err instanceof Error ? err.message : err)
      await sendOneBotText(conversationId, `文件发送失败，OneBot 实现可能不支持文件上传。文件位置：${file.path}`)
    }
  }

  const resolveOneBotFile: OneBotFileResolver = async (fileId) => {
    const response = await requestAction('get_file', { file_id: fileId }, 10_000)
    return response.data ?? response
  }

  const runner = new TextChatRunner({
    platform: 'qq',
    serverUrl: config.serverUrl,
    defaultProjectDir: config.defaultProjectDir,
    sendText: sendOneBotText,
    sendImage: sendOneBotImage,
    sendFile: sendOneBotFile,
    mediaHelpLine: '图片/文件：可直接发给我；需要当前屏幕时发送“截图给我”。OneBot/NapCat 文件发送依赖 upload_private_file / upload_group_file 支持。',
    screenshotTmpPrefix: 'gugu-qq-shot-',
    userLabel: 'QQ User',
  })

  ws.on('open', () => {
    console.log('[QQ OneBot] Bot is running! (WebSocket connected)')
  })

  ws.on('message', (raw) => {
    let event: OneBotMessageEvent | OneBotActionResponse
    try {
      event = JSON.parse(raw.toString()) as OneBotMessageEvent | OneBotActionResponse
    } catch {
      return
    }

    if ('echo' in event && typeof event.echo === 'string') {
      const pending = pendingActions.get(event.echo)
      if (pending) {
        pendingActions.delete(event.echo)
        clearTimeout(pending.timer)
        pending.resolve(event as OneBotActionResponse)
        return
      }
    }

    const msgEvent = event as OneBotMessageEvent
    if (msgEvent.post_type !== 'message' || !msgEvent.message_type || !msgEvent.user_id) return

    const conversationId = msgEvent.message_type === 'group'
      ? `qq:group:${msgEvent.group_id}`
      : `qq:private:${msgEvent.user_id}`
    const userId = msgEvent.message_type === 'group'
      ? `group:${msgEvent.group_id}`
      : msgEvent.user_id

    void (async () => {
      const parsed = parseOneBotMessage(msgEvent.raw_message, msgEvent.message)
      const { attachments, rejections } = await collectQqAttachments({
        segments: parsed.segments,
        sessionId: conversationId,
        attachmentStore,
        resolveOneBotFile,
      })

      for (const rejection of rejections) {
        await sendOneBotText(conversationId, rejection).catch(() => {})
      }
      if (!parsed.text && attachments.length === 0) return

      await runner.handleIncomingText({
        conversationId,
        userId,
        displayName: msgEvent.message_type === 'group' ? `QQ Group ${msgEvent.group_id}` : `QQ ${msgEvent.user_id}`,
        text: parsed.text,
        messageId: msgEvent.message_id ? String(msgEvent.message_id) : undefined,
        attachments,
      })
    })()
  })

  ws.on('error', (err) => {
    console.error('[QQ OneBot] WebSocket error:', err.message)
  })

  ws.on('close', (code, reason) => {
    console.log(`[QQ OneBot] WebSocket closed: ${code} ${reason}`)
    for (const [echo, pending] of pendingActions) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`WebSocket closed before action completed: ${echo}`))
      pendingActions.delete(echo)
    }
  })

  console.log('[QQ OneBot] Starting bridge...')
  console.log(`[QQ OneBot] Server: ${config.serverUrl}`)
  console.log(`[QQ OneBot] OneBot URL: ${config.qq.oneBotUrl}`)

  process.on('SIGINT', () => {
    console.log('[QQ OneBot] Shutting down...')
    ws.close()
    runner.destroy()
    process.exit(0)
  })
}

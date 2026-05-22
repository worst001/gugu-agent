import {
  DWClient,
  EventAck,
  TOPIC_ROBOT,
  type DWClientDownStream,
  type RobotMessage,
} from 'dingtalk-stream'
import { loadConfig } from '../common/config.js'
import { splitMessage } from '../common/format.js'
import { TextChatRunner } from '../common/text-chat-runner.js'

const config = loadConfig()

if (!config.dingtalk.clientId || !config.dingtalk.clientSecret) {
  console.error('[DingTalk] Missing DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET. Set env or ~/.claude/adapters.json')
  process.exit(1)
}

const webhooks = new Map<string, { url: string; expiresAt: number }>()

async function sendDingText(conversationId: string, text: string): Promise<void> {
  const webhook = webhooks.get(conversationId)
  if (!webhook?.url) {
    console.warn(`[DingTalk] No sessionWebhook for ${conversationId}`)
    return
  }
  if (webhook.expiresAt && Date.now() > webhook.expiresAt) {
    console.warn(`[DingTalk] sessionWebhook expired for ${conversationId}`)
    return
  }

  for (const chunk of splitMessage(text, 1800)) {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: chunk },
      }),
    })
    if (!res.ok) {
      throw new Error(`DingTalk send failed: ${res.status} ${res.statusText}`)
    }
  }
}

const runner = new TextChatRunner({
  platform: 'dingtalk',
  serverUrl: config.serverUrl,
  defaultProjectDir: config.defaultProjectDir,
  sendText: sendDingText,
  userLabel: 'DingTalk User',
})

function parseRobotMessage(message: DWClientDownStream): RobotMessage | null {
  if (message.headers.topic !== TOPIC_ROBOT) return null
  try {
    return JSON.parse(message.data) as RobotMessage
  } catch (err) {
    console.error('[DingTalk] Failed to parse robot message:', err)
    return null
  }
}

function conversationKey(message: RobotMessage): string {
  if (message.conversationType === '1') return `dingtalk:private:${message.senderStaffId || message.senderId}`
  return `dingtalk:chat:${message.conversationId}`
}

async function handleRobotMessage(message: RobotMessage): Promise<void> {
  if (config.dingtalk.robotCode && message.robotCode && config.dingtalk.robotCode !== message.robotCode) {
    return
  }

  const conversationId = conversationKey(message)
  webhooks.set(conversationId, {
    url: message.sessionWebhook,
    expiresAt: message.sessionWebhookExpiredTime,
  })

  if (message.msgtype !== 'text') {
    await sendDingText(conversationId, '钉钉 Adapter 当前仅支持文本消息。')
    return
  }

  await runner.handleIncomingText({
    conversationId,
    userId: message.senderStaffId || message.senderId,
    displayName: message.senderNick || 'DingTalk User',
    text: message.text.content,
    messageId: message.msgId,
  })
}

const client = new DWClient({
  clientId: config.dingtalk.clientId,
  clientSecret: config.dingtalk.clientSecret,
  keepAlive: true,
})

client.registerAllEventListener((message) => {
  const robotMessage = parseRobotMessage(message)
  if (robotMessage) {
    void handleRobotMessage(robotMessage).catch((err) => {
      console.error('[DingTalk] Message handler error:', err)
    })
  }
  return { status: EventAck.SUCCESS }
})

console.log('[DingTalk] Starting bot...')
console.log(`[DingTalk] Server: ${config.serverUrl}`)
console.log(`[DingTalk] Allowed users: ${config.dingtalk.allowedUsers.length === 0 ? 'paired users only' : config.dingtalk.allowedUsers.join(', ')}`)

client.connect().then(() => {
  console.log('[DingTalk] Bot is running! (Stream connected)')
}).catch((err) => {
  console.error('[DingTalk] Failed to start:', err)
  process.exit(1)
})

process.on('SIGINT', () => {
  console.log('[DingTalk] Shutting down...')
  client.disconnect()
  runner.destroy()
  process.exit(0)
})

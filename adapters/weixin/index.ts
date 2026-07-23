import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadConfig } from '../common/config.js'
import { TextChatRunner } from '../common/text-chat-runner.js'
import { loadCursor, saveCursor } from './cursor.js'
import { ILinkClient, normalizeInboundText } from './ilink.js'

type Credentials = {
  accountId: string
  token: string
  baseUrl: string
}

type RuntimeState = 'starting' | 'online' | 'degraded' | 'offline'

function credentialPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'weixin', 'credentials.json')
}

async function loadCredentials(): Promise<Credentials> {
  const credentials = JSON.parse(
    await fs.readFile(credentialPath(), 'utf-8'),
  ) as Partial<Credentials>
  if (
    typeof credentials.accountId !== 'string'
    || !credentials.accountId.trim()
    || typeof credentials.token !== 'string'
    || !credentials.token
    || typeof credentials.baseUrl !== 'string'
  ) {
    throw new Error('WeChat credentials are invalid; reconnect from Phone connection')
  }
  const baseUrl = new URL(credentials.baseUrl)
  if (baseUrl.protocol !== 'https:') {
    throw new Error('WeChat API base URL must use HTTPS')
  }
  return { ...credentials, baseUrl: baseUrl.origin } as Credentials
}

function runtimeEndpoint(serverUrl: string): string {
  const url = new URL(serverUrl)
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'
  url.pathname = '/api/adapters/weixin/runtime'
  url.search = ''
  return url.toString()
}

async function reportRuntime(
  serverUrl: string,
  state: RuntimeState,
  details: { lastPollAt?: number; error?: string } = {},
): Promise<void> {
  try {
    await fetch(runtimeEndpoint(serverUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, ...details }),
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // The adapter keeps polling even if the local diagnostics endpoint restarts.
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export async function startWeixinAdapter(): Promise<void> {
  const config = loadConfig()
  const credentials = await loadCredentials()
  const client = new ILinkClient(credentials)
  const targets = new Map<string, string>()
  const contextTokens = new Map<string, string>()
  const controller = new AbortController()
  const runner = new TextChatRunner({
    platform: 'weixin',
    serverUrl: config.serverUrl,
    defaultProjectDir:
      config.weixin.defaultWorkDir || config.defaultProjectDir,
    userLabel: 'WeChat user',
    sendText: async (conversationId, text) => {
      const target = targets.get(conversationId)
      if (!target) throw new Error(`Missing WeChat target for ${conversationId}`)
      await client.sendText(target, text, contextTokens.get(conversationId))
    },
  })

  const shutdown = () => {
    controller.abort()
    runner.destroy()
    void reportRuntime(config.serverUrl, 'offline')
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  let cursor = await loadCursor(credentials.accountId)
  let consecutiveFailures = 0
  await reportRuntime(config.serverUrl, 'starting')
  console.log(`[WeChat] Starting account ${credentials.accountId}`)

  while (!controller.signal.aborted) {
    try {
      const response = await client.getUpdates(cursor, controller.signal)
      if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
        throw new Error(
          `getUpdates failed: ${response.errcode ?? response.ret} ${response.errmsg ?? ''}`.trim(),
        )
      }
      consecutiveFailures = 0
      await reportRuntime(config.serverUrl, 'online', { lastPollAt: Date.now() })


      for (const message of response.msgs ?? []) {
        const inbound = normalizeInboundText(credentials.accountId, message)
        if (!inbound) continue
        targets.set(inbound.conversationId, inbound.userId)
        if (inbound.contextToken) {
          contextTokens.set(inbound.conversationId, inbound.contextToken)
        }
        await runner.handleIncomingText({
          conversationId: inbound.conversationId,
          userId: inbound.userId,
          displayName: inbound.displayName,
          text: inbound.text,
          messageId: inbound.messageId,
        })
      }

      if (response.get_updates_buf && response.get_updates_buf !== cursor) {
        await saveCursor(credentials.accountId, response.get_updates_buf)
        cursor = response.get_updates_buf
      }
    } catch (error) {
      if (controller.signal.aborted) break
      consecutiveFailures += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[WeChat] Poll failed (${consecutiveFailures}): ${message}`)
      await reportRuntime(config.serverUrl, 'degraded', { error: message })
      await sleep(consecutiveFailures >= 3 ? 30_000 : 2_000, controller.signal)
      if (consecutiveFailures >= 3) consecutiveFailures = 0
    }
  }
}

void startWeixinAdapter().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(
    '[WeChat] Failed to start:',
    message,
  )
  try {
    const config = loadConfig()
    void reportRuntime(config.serverUrl, 'degraded', { error: message })
  } catch {}
})

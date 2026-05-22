/**
 * WeCom Adapter for Claude Code Desktop
 *
 * 企业微信自建应用回调 Adapter：
 * - 用 Token + EncodingAESKey 校验/解密回调
 * - 接收私聊文本消息并桥接到本地 /ws/:sessionId
 * - 通过企业微信应用消息接口回复文本
 *
 * 启动：
 * WECOM_CALLBACK_PORT=3478 bun run wecom
 */

import * as path from 'node:path'
import { enqueue } from '../common/chat-queue.js'
import { loadConfig } from '../common/config.js'
import {
  formatImHelp,
  formatImStatus,
  formatPermissionRequest,
} from '../common/format.js'
import { AdapterHttpClient } from '../common/http-client.js'
import { checkAttachmentLimit } from '../common/attachment/attachment-limits.js'
import { MessageDedup } from '../common/message-dedup.js'
import { isAllowedUser, tryPair } from '../common/pairing.js'
import { SessionStore } from '../common/session-store.js'
import { WsBridge, type ServerMessage } from '../common/ws-bridge.js'
import { redactInternalBranding, wrapImUserMessage } from '../common/brand.js'
import {
  captureDesktopScreenshot,
  DESKTOP_SCREENSHOT_UNSUPPORTED,
} from '../common/desktop-screenshot.js'
import { isScreenshotCommand } from '../common/screenshot-command.js'
import { WecomClient } from './client.js'
import { decryptWecomPayload, verifyWecomSignature } from './crypto.js'
import {
  parseEncryptedEnvelope,
  parseInboundMessage,
  type WecomInboundMessage,
} from './xml.js'

const config = loadConfig()
const callbackPort = Number(process.env.WECOM_CALLBACK_PORT || 3478)
const callbackPath = process.env.WECOM_CALLBACK_PATH || '/wecom/events'
const SCREENSHOT_TIMEOUT_MS = 20_000

const requiredCredentials = [
  ['WECOM_CORP_ID', config.wecom.corpId],
  ['WECOM_AGENT_ID', config.wecom.agentId],
  ['WECOM_SECRET', config.wecom.secret],
  ['WECOM_TOKEN', config.wecom.token],
  ['WECOM_ENCODING_AES_KEY', config.wecom.encodingAesKey],
] as const

const missing = requiredCredentials
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  console.error(`[WeCom] Missing ${missing.join(' / ')}. Set env or ~/.claude/adapters.json`)
  process.exit(1)
}

const bridge = new WsBridge(config.serverUrl, 'wecom')
const dedup = new MessageDedup()
const sessionStore = new SessionStore()
const httpClient = new AdapterHttpClient(config.serverUrl)
const wecomClient = new WecomClient(
  config.wecom.corpId,
  config.wecom.secret,
  config.wecom.agentId,
)

const pendingProjectSelection = new Map<string, boolean>()
const accumulatedText = new Map<string, string>()
const pendingPermissions = new Map<string, Set<string>>()
const runtimeStates = new Map<string, ChatRuntimeState>()

type ChatRuntimeState = {
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'
  verb?: string
  model?: string
  pendingPermissionCount: number
}

function getRuntimeState(chatId: string): ChatRuntimeState {
  let state = runtimeStates.get(chatId)
  if (!state) {
    state = { state: 'idle', pendingPermissionCount: 0 }
    runtimeStates.set(chatId, state)
  }
  return state
}

function addPendingPermission(chatId: string, requestId: string): void {
  let requests = pendingPermissions.get(chatId)
  if (!requests) {
    requests = new Set()
    pendingPermissions.set(chatId, requests)
  }
  requests.add(requestId)
}

function removePendingPermission(chatId: string, requestId: string): void {
  const requests = pendingPermissions.get(chatId)
  if (!requests) return
  requests.delete(requestId)
  if (requests.size === 0) pendingPermissions.delete(chatId)
}

async function sendText(chatId: string, text: string): Promise<void> {
  try {
    await wecomClient.sendText(chatId, redactInternalBranding(text))
  } catch (err) {
    console.error('[WeCom] sendText failed:', err instanceof Error ? err.message : err)
  }
}

async function sendDesktopScreenshot(chatId: string): Promise<void> {
  await sendText(chatId, '正在截取当前屏幕...')

  let buffer: Buffer
  try {
    buffer = await captureDesktopScreenshot({
      timeoutMs: SCREENSHOT_TIMEOUT_MS,
      tmpPrefix: 'gugu-wecom-shot-',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === DESKTOP_SCREENSHOT_UNSUPPORTED) {
      await sendText(chatId, '当前版本只支持在 macOS 上直接截图。')
      return
    }
    await sendText(
      chatId,
      '截图失败。请在 macOS「系统设置 > 隐私与安全性 > 屏幕录制」里允许 Gugu Agent，然后点击“启动/重启本地接入”再试。',
    )
    console.error('[WeCom] desktop screenshot failed:', message)
    return
  }

  const check = checkAttachmentLimit('image', buffer.length, 'image/png')
  if (!check.ok) {
    await sendText(chatId, check.hint)
    return
  }

  try {
    await wecomClient.sendImage(chatId, buffer, `gugu-screenshot-${Date.now()}.png`, 'image/png')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const hint = message.length > 180 ? `${message.slice(0, 180)}...` : message
    await sendText(
      chatId,
      `截图已完成，但发送到企业微信失败。请确认自建应用 Secret 可用、应用可见范围包含当前用户，并且后台已保存接收消息配置。错误：${hint}`,
    )
    console.error('[WeCom] desktop screenshot upload/send failed:', message)
  }
}

function clearTransientChatState(chatId: string): void {
  accumulatedText.delete(chatId)
  pendingPermissions.delete(chatId)
  const runtime = getRuntimeState(chatId)
  runtime.state = 'idle'
  runtime.verb = undefined
  runtime.pendingPermissionCount = 0
}

async function ensureExistingSession(chatId: string): Promise<{ sessionId: string; workDir: string } | null> {
  const stored = sessionStore.get(chatId)
  if (!stored) return null

  if (!bridge.hasSession(chatId)) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) return null
  }

  return stored
}

async function ensureSession(chatId: string): Promise<boolean> {
  if (bridge.hasSession(chatId)) return true

  const stored = sessionStore.get(chatId)
  if (stored) {
    bridge.connectSession(chatId, stored.sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    return await bridge.waitForOpen(chatId)
  }

  if (config.defaultProjectDir) {
    return await createSessionForChat(chatId, config.defaultProjectDir)
  }

  await showProjectPicker(chatId)
  return false
}

async function createSessionForChat(chatId: string, workDir: string): Promise<boolean> {
  try {
    bridge.resetSession(chatId)
    accumulatedText.delete(chatId)

    const sessionId = await httpClient.createSession(workDir)
    sessionStore.set(chatId, sessionId, workDir)
    bridge.connectSession(chatId, sessionId)
    bridge.onServerMessage(chatId, (msg) => handleServerMessage(chatId, msg))
    const opened = await bridge.waitForOpen(chatId)
    if (!opened) {
      await sendText(chatId, '连接服务器超时，请重试。')
      return false
    }
    return true
  } catch (err) {
    await sendText(chatId, `无法创建会话: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

async function showProjectPicker(chatId: string): Promise<void> {
  try {
    const projects = await httpClient.listRecentProjects()
    if (projects.length === 0) {
      await sendText(chatId, '没有找到最近的项目。请先在 Desktop App 中打开一个项目，或在设置中配置默认项目。')
      return
    }

    const lines = projects.slice(0, 10).map((p, i) =>
      `${i + 1}. ${p.projectName}${p.branch ? ` (${p.branch})` : ''}\n   ${p.realPath}`
    )
    pendingProjectSelection.set(chatId, true)
    await sendText(chatId, `选择项目（回复编号）：\n\n${lines.join('\n\n')}\n\n下次可直接 /new <编号或名称> 快速新建会话`)
  } catch (err) {
    await sendText(chatId, `无法获取项目列表: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function startNewSession(chatId: string, query?: string): Promise<void> {
  bridge.resetSession(chatId)
  sessionStore.delete(chatId)
  accumulatedText.delete(chatId)
  pendingProjectSelection.delete(chatId)
  pendingPermissions.delete(chatId)
  runtimeStates.delete(chatId)

  if (query) {
    try {
      const { project, ambiguous } = await httpClient.matchProject(query)
      if (project) {
        const ok = await createSessionForChat(chatId, project.realPath)
        if (ok) {
          await sendText(chatId, `已新建会话：${project.projectName}${project.branch ? ` (${project.branch})` : ''}`)
        }
        return
      }
      if (ambiguous) {
        const list = ambiguous.map((p, i) => `${i + 1}. ${p.projectName} — ${p.realPath}`).join('\n')
        await sendText(chatId, `匹配到多个项目，请更精确：\n\n${list}`)
        return
      }
      await sendText(chatId, `未找到匹配 "${query}" 的项目。发送 /projects 查看完整列表。`)
    } catch (err) {
      await sendText(chatId, err instanceof Error ? err.message : String(err))
    }
  } else if (config.defaultProjectDir) {
    const ok = await createSessionForChat(chatId, config.defaultProjectDir)
    if (ok) await sendText(chatId, '已新建会话，可以开始对话了。')
  } else {
    await showProjectPicker(chatId)
  }
}

async function buildStatusText(chatId: string): Promise<string> {
  const stored = await ensureExistingSession(chatId)
  if (!stored) return formatImStatus(null)

  const runtime = getRuntimeState(chatId)
  let projectName = path.basename(stored.workDir) || stored.workDir
  let branch: string | null = null

  try {
    const gitInfo = await httpClient.getGitInfo(stored.sessionId)
    projectName = gitInfo.repoName || path.basename(gitInfo.workDir) || projectName
    branch = gitInfo.branch
  } catch {
    // Fall back to stored workDir.
  }

  return formatImStatus({
    sessionId: stored.sessionId,
    projectName,
    branch,
    model: runtime.model,
    state: runtime.state,
    verb: runtime.verb,
    pendingPermissionCount: runtime.pendingPermissionCount,
  })
}

function resolvePermissionCommand(chatId: string, text: string): { handled: boolean; requestId?: string; allowed?: boolean; rule?: string } {
  const trimmed = text.trim()
  const match = trimmed.match(/^(?:\/(allow|deny|always)|允许|拒绝|永久允许)(?:\s+(\S+))?$/i)
  if (!match) return { handled: false }

  const command = match[1]?.toLowerCase() || trimmed
  const requests = pendingPermissions.get(chatId)
  if (!requests || requests.size === 0) {
    return { handled: true }
  }

  const explicitId = match[2]
  let requestId = explicitId
  if (!requestId) {
    if (requests.size > 1) return { handled: true }
    requestId = [...requests][0]
  }

  if (!requestId || !requests.has(requestId)) {
    return { handled: true }
  }

  const allowed = command === 'allow' || command === 'always' || command === '允许' || command === '永久允许'
  const rule = command === 'always' || command === '永久允许' ? 'always' : undefined
  return { handled: true, requestId, allowed, rule }
}

async function handleServerMessage(chatId: string, msg: ServerMessage): Promise<void> {
  const runtime = getRuntimeState(chatId)

  switch (msg.type) {
    case 'connected':
      break

    case 'status':
      runtime.state = msg.state
      runtime.verb = typeof msg.verb === 'string' ? msg.verb : undefined
      break

    case 'content_start':
      if (msg.blockType === 'text') {
        accumulatedText.set(chatId, accumulatedText.get(chatId) ?? '')
      }
      break

    case 'content_delta':
      if (typeof msg.text === 'string' && msg.text) {
        accumulatedText.set(chatId, (accumulatedText.get(chatId) ?? '') + msg.text)
      }
      break

    case 'permission_request': {
      runtime.pendingPermissionCount += 1
      runtime.state = 'permission_pending'
      addPendingPermission(chatId, msg.requestId)
      await sendText(
        chatId,
        `${formatPermissionRequest(msg.toolName, msg.input, msg.requestId)}\n\n回复 /allow ${msg.requestId} 允许，/always ${msg.requestId} 本次会话永久允许，或 /deny ${msg.requestId} 拒绝。`,
      )
      break
    }

    case 'message_complete': {
      runtime.state = 'idle'
      runtime.verb = undefined
      const text = accumulatedText.get(chatId)
      accumulatedText.delete(chatId)
      if (text?.trim()) {
        await sendText(chatId, text.trim())
      }
      break
    }

    case 'error':
      runtime.state = 'idle'
      runtime.verb = undefined
      accumulatedText.delete(chatId)
      if (msg.message && /Invalid.*signature.*thinking/i.test(msg.message)) {
        const stored = sessionStore.get(chatId)
        const workDir = stored?.workDir || config.defaultProjectDir
        if (workDir) {
          await sendText(chatId, '会话上下文已失效，正在自动重建...')
          clearTransientChatState(chatId)
          bridge.resetSession(chatId)
          sessionStore.delete(chatId)
          const ok = await createSessionForChat(chatId, workDir)
          await sendText(chatId, ok ? '已重建会话，请重新发送消息。' : '重建会话失败，请发送 /new 手动新建。')
        } else {
          await sendText(chatId, '会话上下文已失效，请发送 /new 新建会话。')
        }
      } else {
        await sendText(chatId, `错误: ${msg.message}`)
      }
      break

    case 'system_notification':
      if (msg.subtype === 'init' && msg.data && typeof msg.data === 'object') {
        const model = (msg.data as Record<string, unknown>).model
        if (typeof model === 'string' && model.trim()) {
          runtime.model = model
        }
      }
      break
  }
}

async function routeTextMessage(chatId: string, text: string): Promise<void> {
  const trimmed = text.trim()

  if (!isAllowedUser('wecom', chatId)) {
    const success = tryPair(trimmed, { userId: chatId, displayName: `WeCom ${chatId}` }, 'wecom')
    await sendText(
      chatId,
      success
        ? '配对成功！现在可以开始聊天了。\n\n发送消息即可与 Gu Agent 对话。'
        : '未授权。请在 Gugu Agent 桌面端生成配对码后发送给我。',
    )
    return
  }

  enqueue(chatId, async () => {
    const permission = resolvePermissionCommand(chatId, trimmed)
    if (permission.handled) {
      if (!permission.requestId) {
        await sendText(chatId, '没有找到待确认的权限请求，或存在多个请求需要带上 requestId。')
        return
      }
      bridge.sendPermissionResponse(chatId, permission.requestId, permission.allowed ?? false, permission.rule)
      removePendingPermission(chatId, permission.requestId)
      const runtime = getRuntimeState(chatId)
      runtime.pendingPermissionCount = Math.max(0, runtime.pendingPermissionCount - 1)
      await sendText(
        chatId,
        permission.allowed
          ? permission.rule === 'always'
            ? '已永久允许（本次会话内不再询问相同操作）。'
            : '已允许。'
          : '已拒绝。',
      )
      return
    }

    if (trimmed === '/help' || trimmed === '帮助') {
      await sendText(chatId, `${formatImHelp()}\n截图 / 截屏 / /screenshot — 截取本机当前屏幕并发回企业微信`)
      return
    }
    if (trimmed === '/new' || trimmed === '新会话' || trimmed.startsWith('/new ')) {
      const arg = trimmed.startsWith('/new ') ? trimmed.slice(5).trim() : ''
      await startNewSession(chatId, arg || undefined)
      return
    }
    if (trimmed === '/projects' || trimmed === '项目列表') {
      await showProjectPicker(chatId)
      return
    }
    if (trimmed === '/status' || trimmed === '状态') {
      await sendText(chatId, await buildStatusText(chatId))
      return
    }
    if (trimmed === '/stop' || trimmed === '停止') {
      const stored = await ensureExistingSession(chatId)
      if (!stored) {
        await sendText(chatId, formatImStatus(null))
        return
      }
      bridge.sendStopGeneration(chatId)
      await sendText(chatId, '已发送停止信号。')
      return
    }
    if (trimmed === '/clear' || trimmed === '清空') {
      const stored = await ensureExistingSession(chatId)
      if (!stored) {
        await sendText(chatId, formatImStatus(null))
        return
      }
      clearTransientChatState(chatId)
      const sent = bridge.sendUserMessage(chatId, '/clear')
      if (!sent) {
        await sendText(chatId, '无法发送 /clear，请先发送 /new 重新连接会话。')
        return
      }
      await sendText(chatId, '已清空当前会话上下文。')
      return
    }

    if (isScreenshotCommand(trimmed)) {
      await sendDesktopScreenshot(chatId)
      return
    }

    if (pendingProjectSelection.has(chatId)) {
      await startNewSession(chatId, trimmed)
      return
    }

    const ready = await ensureSession(chatId)
    if (!ready) return

    const sent = bridge.sendUserMessage(chatId, wrapImUserMessage(trimmed))
    if (!sent) {
      await sendText(chatId, '消息发送失败，连接可能已断开。请发送 /new 重新开始。')
    }
  })
}

async function handleInboundMessage(message: WecomInboundMessage): Promise<void> {
  const chatId = message.fromUserName
  if (!chatId) return
  if (message.agentId && message.agentId !== config.wecom.agentId) return

  const dedupId = message.msgId || `${message.fromUserName}:${message.createTime}:${message.content}`
  if (!dedup.tryRecord(dedupId)) return

  if (message.msgType !== 'text') {
    if (isAllowedUser('wecom', chatId)) {
      await sendText(chatId, '企业微信 Adapter 当前仅支持文本消息。')
    }
    return
  }

  await routeTextMessage(chatId, message.content)
}

function getRequiredQuery(url: URL): {
  signature: string
  timestamp: string
  nonce: string
  echostr: string
} {
  return {
    signature: url.searchParams.get('msg_signature') || '',
    timestamp: url.searchParams.get('timestamp') || '',
    nonce: url.searchParams.get('nonce') || '',
    echostr: url.searchParams.get('echostr') || '',
  }
}

async function handleVerify(url: URL): Promise<Response> {
  const { signature, timestamp, nonce, echostr } = getRequiredQuery(url)
  if (!signature || !timestamp || !nonce || !echostr) {
    return new Response('missing query', { status: 400 })
  }
  if (!verifyWecomSignature(config.wecom.token, timestamp, nonce, echostr, signature)) {
    return new Response('invalid signature', { status: 401 })
  }
  const plain = decryptWecomPayload(echostr, config.wecom.encodingAesKey, config.wecom.corpId)
  return new Response(plain)
}

async function handleCallback(request: Request, url: URL): Promise<Response> {
  const { signature, timestamp, nonce } = getRequiredQuery(url)
  if (!signature || !timestamp || !nonce) {
    return new Response('missing query', { status: 400 })
  }

  const body = await request.text()
  const envelope = parseEncryptedEnvelope(body)
  if (!envelope.encrypt) {
    return new Response('missing encrypt', { status: 400 })
  }
  if (!verifyWecomSignature(config.wecom.token, timestamp, nonce, envelope.encrypt, signature)) {
    return new Response('invalid signature', { status: 401 })
  }

  const plainXml = decryptWecomPayload(envelope.encrypt, config.wecom.encodingAesKey, config.wecom.corpId)
  const message = parseInboundMessage(plainXml)
  void handleInboundMessage(message).catch((err) => {
    console.error('[WeCom] Message handler error:', err)
  })

  return new Response('success')
}

const server = Bun.serve({
  port: callbackPort,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname !== callbackPath && url.pathname !== '/') {
      return new Response('not found', { status: 404 })
    }
    if (request.method === 'GET') {
      return handleVerify(url).catch((err) => {
        console.error('[WeCom] Verify failed:', err)
        return new Response('verify failed', { status: 500 })
      })
    }
    if (request.method === 'POST') {
      return handleCallback(request, url).catch((err) => {
        console.error('[WeCom] Callback failed:', err)
        return new Response('callback failed', { status: 500 })
      })
    }
    return new Response('method not allowed', { status: 405 })
  },
})

console.log('[WeCom] Bot is running!')
console.log(`[WeCom] Server: ${config.serverUrl}`)
console.log(`[WeCom] Callback: http://127.0.0.1:${server.port}${callbackPath}`)
console.log(`[WeCom] Allowed users: ${config.wecom.allowedUsers.length === 0 ? 'paired users only' : config.wecom.allowedUsers.join(', ')}`)

process.on('SIGINT', () => {
  console.log('[WeCom] Shutting down...')
  server.stop()
  bridge.destroy()
  dedup.destroy()
  process.exit(0)
})

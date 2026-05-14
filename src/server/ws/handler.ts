/**
 * WebSocket connection handler
 *
 * 管理 WebSocket 连接生命周期，处理消息路由。
 * 用户消息通过 CLI 子进程（stream-json 模式）处理，
 * CLI stdout 消息被转换为 ServerMessage 并转发到 WebSocket。
 */

import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage } from './events.js'
import * as os from 'node:os'
import {
  ConversationStartupError,
  conversationService,
} from '../services/conversationService.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import {
  ProviderService,
  isProviderModelId,
  resolveProviderModelId,
} from '../services/providerService.js'
import {
  AttachmentParserError,
  attachmentParserService,
} from '../services/attachmentParserService.js'
import { deriveTitle, generateTitle, getTitleInputText, saveAiTitle } from '../services/titleService.js'
import { parseSlashCommand } from '../../utils/slashCommandParsing.js'
import {
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../constants/xml.js'

const settingsService = new SettingsService()
const providerService = new ProviderService()

/**
 * Cache slash commands from CLI init messages, keyed by sessionId.
 */
const sessionSlashCommands = new Map<string, Array<{ name: string; description: string }>>()

/**
 * Timers for delayed session cleanup after client disconnect.
 * If a client reconnects within 5 minutes, the timer is cancelled.
 */
const sessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Track sessions where user requested stop — suppress the CLI_ERROR that
 * follows an interrupt so the frontend doesn't show "处理过程中发生错误".
 */
const sessionStopRequested = new Set<string>()

/**
 * Track user message count and title state per session for auto-title generation.
 */
const sessionTitleState = new Map<string, {
  userMessageCount: number
  hasCustomTitle: boolean
  firstUserMessage: string
  allUserMessages: string[]
}>()

const runtimeOverrides = new Map<string, {
  providerId: string | null
  modelId: string
}>()
const sessionStartupRuntime = new Map<string, {
  providerId?: string | null
  model?: string
}>()

type SessionStartupOverrides = {
  permissionMode?: string
  model?: string
  providerId?: string | null
}

const ALLOWED_STARTUP_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
])

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max'])

const runtimeTransitionPromises = new Map<string, Promise<void>>()
const sessionStartupPromises = new Map<string, Promise<void>>()
const prewarmPendingSessions = new Set<string>()
const prewarmedSessions = new Set<string>()
const prewarmIdleTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DEFAULT_PREWARM_IDLE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_IDLE_SESSION_RECONNECT_GRACE_MS = 30_000
const DEFAULT_ACTIVE_SESSION_RECONNECT_GRACE_MS = 30 * 60_000
const DEFAULT_TURN_WATCHDOG_INTERVAL_MS = 5_000
const DEFAULT_TURN_PROGRESS_NOTICE_MS = 45_000
const DEFAULT_TURN_PROGRESS_REMINDER_MS = 60_000
const DEFAULT_MODEL_STALL_NOTICE_MS = 5 * 60_000
const DEFAULT_SDK_LIVENESS_TIMEOUT_MS = 2 * 60_000
const DEFAULT_TOOL_STALL_NOTICE_MS = 5 * 60_000
const DEFAULT_TOOL_IDLE_TIMEOUT_MS = 30 * 60_000

type TurnPhase = 'thinking' | 'streaming' | 'tool_executing' | 'permission_pending'

type TurnMonitor = {
  sessionId: string
  phase: TurnPhase
  startedAt: number
  lastProgressAt: number
  lastKeepAliveAt: number
  nextNoticeAt: number
  modelStallNoticeSent: boolean
  toolStallNoticeSent: boolean
  callback: (msg: any) => void
  timer: ReturnType<typeof setInterval> | null
}

const sessionTurnMonitors = new Map<string, TurnMonitor>()

export function getSlashCommands(sessionId: string): Array<{ name: string; description: string }> {
  return sessionSlashCommands.get(sessionId) || []
}

export type WebSocketData = {
  sessionId: string
  connectedAt: number
  channel: 'client' | 'sdk'
  sdkToken: string | null
  serverPort: number
  serverHost: string
  outputCallback?: (msg: any) => void
  outputStreamKey?: string
}

// Active WebSocket sessions
const activeSessions = new Map<string, Set<ServerWebSocket<WebSocketData>>>()
const prewarmMetadataCallbacks = new Map<string, (msg: any) => void>()

function getEnvMs(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function getSessionReconnectGraceMs(sessionId: string): number {
  return sessionTurnMonitors.has(sessionId)
    ? getEnvMs('CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS', DEFAULT_ACTIVE_SESSION_RECONNECT_GRACE_MS)
    : DEFAULT_IDLE_SESSION_RECONNECT_GRACE_MS
}

function broadcastToSession(sessionId: string, message: ServerMessage): void {
  const clients = activeSessions.get(sessionId)
  if (!clients) return
  for (const client of clients) {
    sendMessage(client, message)
  }
}

function scheduleSessionCleanup(sessionId: string, delayMs: number): void {
  const existing = sessionCleanupTimers.get(sessionId)
  if (existing) clearTimeout(existing)

  const cleanupTimer = setTimeout(() => {
    sessionCleanupTimers.delete(sessionId)
    if (!hasActiveClient(sessionId)) {
      console.log(`[WS] Session ${sessionId} not reconnected after ${delayMs}ms, stopping CLI subprocess`)
      stopTurnMonitor(sessionId)
      conversationService.stopSession(sessionId)
      cleanupSessionRuntimeState(sessionId)
    }
  }, delayMs)
  sessionCleanupTimers.set(sessionId, cleanupTimer)
}

function getFirstActiveClient(sessionId: string): ServerWebSocket<WebSocketData> | null {
  const clients = activeSessions.get(sessionId)
  return clients?.values().next().value ?? null
}

function getTurnStatusVerb(phase: TurnPhase): string {
  if (phase === 'tool_executing') return '工具仍在执行中'
  if (phase === 'permission_pending') return '等待权限确认'
  if (phase === 'streaming') return '仍在接收模型输出'
  return '仍在等待模型响应'
}

function startTurnMonitor(sessionId: string): void {
  stopTurnMonitor(sessionId)

  const now = Date.now()
  const monitor: TurnMonitor = {
    sessionId,
    phase: 'thinking',
    startedAt: now,
    lastProgressAt: now,
    lastKeepAliveAt: now,
    nextNoticeAt: now + getEnvMs('CC_HAHA_TURN_PROGRESS_NOTICE_MS', DEFAULT_TURN_PROGRESS_NOTICE_MS),
    modelStallNoticeSent: false,
    toolStallNoticeSent: false,
    callback: (msg: any) => noteTurnActivity(sessionId, msg),
    timer: null,
  }
  monitor.timer = setInterval(
    () => tickTurnMonitor(sessionId),
    getEnvMs('CC_HAHA_TURN_WATCHDOG_INTERVAL_MS', DEFAULT_TURN_WATCHDOG_INTERVAL_MS),
  )
  const unref = (monitor.timer as { unref?: () => void }).unref
  if (unref) unref.call(monitor.timer)

  sessionTurnMonitors.set(sessionId, monitor)
  conversationService.onOutput(sessionId, monitor.callback)
}

function stopTurnMonitor(sessionId: string): void {
  const monitor = sessionTurnMonitors.get(sessionId)
  if (!monitor) return
  if (monitor.timer) clearInterval(monitor.timer)
  conversationService.removeOutputCallback(sessionId, monitor.callback)
  sessionTurnMonitors.delete(sessionId)
}

function completeTurnMonitor(sessionId: string): void {
  stopTurnMonitor(sessionId)
  if (!hasActiveClient(sessionId) && conversationService.hasSession(sessionId)) {
    scheduleSessionCleanup(sessionId, DEFAULT_IDLE_SESSION_RECONNECT_GRACE_MS)
  }
}

function noteTurnActivity(sessionId: string, cliMsg: any): void {
  const monitor = sessionTurnMonitors.get(sessionId)
  if (!monitor) return

  const now = Date.now()
  if (cliMsg?.type === 'keep_alive') {
    monitor.lastKeepAliveAt = now
    return
  }

  monitor.lastProgressAt = now
  monitor.nextNoticeAt = now + getEnvMs('CC_HAHA_TURN_PROGRESS_NOTICE_MS', DEFAULT_TURN_PROGRESS_NOTICE_MS)

  if (cliMsg?.type === 'result') {
    completeTurnMonitor(sessionId)
    return
  }
  if (cliMsg?.type === 'stream_event') {
    const eventType = cliMsg.event?.type
    const contentBlock = cliMsg.event?.content_block
    if (eventType === 'content_block_start' && contentBlock?.type === 'tool_use') {
      monitor.phase = 'tool_executing'
    } else if (eventType === 'content_block_delta') {
      monitor.phase = cliMsg.event?.delta?.type === 'thinking_delta' ? 'thinking' : 'streaming'
    } else if (eventType === 'message_start') {
      monitor.phase = 'thinking'
    }
    return
  }
  if (
    cliMsg?.type === 'control_request' ||
    cliMsg?.type === 'permission_request' ||
    cliMsg?.request?.subtype === 'can_use_tool'
  ) {
    monitor.phase = 'permission_pending'
    return
  }
  if (cliMsg?.type === 'assistant') {
    monitor.phase = 'streaming'
    return
  }
  if (cliMsg?.type === 'user' && Array.isArray(cliMsg.message?.content)) {
    const hasToolResult = cliMsg.message.content.some((block: any) => block?.type === 'tool_result')
    if (hasToolResult) monitor.phase = 'thinking'
  }
}

function tickTurnMonitor(sessionId: string): void {
  const monitor = sessionTurnMonitors.get(sessionId)
  if (!monitor) return
  if (!conversationService.hasSession(sessionId)) {
    stopTurnMonitor(sessionId)
    return
  }

  const now = Date.now()
  const noProgressMs = now - monitor.lastProgressAt
  const noLivenessMs = now - Math.max(monitor.lastProgressAt, monitor.lastKeepAliveAt)

  if (noLivenessMs >= getEnvMs('CC_HAHA_SDK_LIVENESS_TIMEOUT_MS', DEFAULT_SDK_LIVENESS_TIMEOUT_MS)) {
    recoverStalledTurn(sessionId, 'Agent 连接长时间没有心跳，已中止本轮以恢复会话。')
    return
  }

  if (now >= monitor.nextNoticeAt) {
    broadcastToSession(sessionId, {
      type: 'status',
      state: monitor.phase,
      verb: getTurnStatusVerb(monitor.phase),
    })
    monitor.nextNoticeAt = now + getEnvMs('CC_HAHA_TURN_PROGRESS_REMINDER_MS', DEFAULT_TURN_PROGRESS_REMINDER_MS)
  }

  if (
    (monitor.phase === 'thinking' || monitor.phase === 'streaming') &&
    noProgressMs >= getEnvMs('CC_HAHA_MODEL_STALL_NOTICE_MS', DEFAULT_MODEL_STALL_NOTICE_MS) &&
    !monitor.modelStallNoticeSent
  ) {
    monitor.modelStallNoticeSent = true
    broadcastToSession(sessionId, {
      type: 'system_notification',
      subtype: 'agent_recovery',
      message: '模型已经较长时间没有返回内容，正在等待上游恢复或自动超时收口。',
      data: { reason: 'model_stream_stalled', idleMs: noProgressMs },
    })
  }

  if (monitor.phase === 'tool_executing') {
    const toolNoticeMs = getEnvMs('CC_HAHA_TOOL_STALL_NOTICE_MS', DEFAULT_TOOL_STALL_NOTICE_MS)
    if (noProgressMs >= toolNoticeMs && !monitor.toolStallNoticeSent) {
      monitor.toolStallNoticeSent = true
      broadcastToSession(sessionId, {
        type: 'status',
        state: 'tool_executing',
        verb: '工具执行时间较长，仍在等待结果',
      })
    }

    const toolTimeoutMs = getEnvMs('CC_HAHA_TOOL_IDLE_TIMEOUT_MS', DEFAULT_TOOL_IDLE_TIMEOUT_MS)
    if (toolTimeoutMs > 0 && noProgressMs >= toolTimeoutMs) {
      recoverStalledTurn(sessionId, '工具长时间没有返回结果，已中止本轮以恢复会话。')
    }
  }
}

function recoverStalledTurn(sessionId: string, message: string): void {
  stopTurnMonitor(sessionId)
  sessionStopRequested.add(sessionId)
  conversationService.stopSession(sessionId)
  broadcastToSession(sessionId, {
    type: 'system_notification',
    subtype: 'agent_recovery',
    message,
    data: { reason: 'agent_stalled' },
  })
  broadcastToSession(sessionId, { type: 'status', state: 'idle' })

  const ws = getFirstActiveClient(sessionId)
  if (ws) {
    handlePrewarmSession(ws)
  }
}

function syncTurnMonitorStatus(ws: ServerWebSocket<WebSocketData>, sessionId: string): void {
  const monitor = sessionTurnMonitors.get(sessionId)
  if (!monitor) return
  sendMessage(ws, {
    type: 'status',
    state: monitor.phase,
    verb: getTurnStatusVerb(monitor.phase),
  })
}

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId, channel, sdkToken } = ws.data

    if (channel === 'sdk') {
      if (!conversationService.authorizeSdkConnection(sessionId, sdkToken)) {
        console.warn(`[WS] Rejected SDK connection for session: ${sessionId}`)
        ws.close(1008, 'Invalid SDK token')
        return
      }

      conversationService.attachSdkConnection(sessionId, ws)
      console.log(`[WS] SDK connected for session: ${sessionId}`)
      return
    }

    console.log(`[WS] Client connected for session: ${sessionId}`)

    // Cancel pending cleanup timer if client reconnects
    const pendingTimer = sessionCleanupTimers.get(sessionId)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      sessionCleanupTimers.delete(sessionId)
    }

    addActiveClient(sessionId, ws)
    if (prewarmedSessions.has(sessionId)) {
      bindPrewarmMetadataCapture(sessionId)
    } else {
      rebindSessionOutput(sessionId, ws)
    }

    const msg: ServerMessage = { type: 'connected', sessionId }
    ws.send(JSON.stringify(msg))
    syncTurnMonitorStatus(ws, sessionId)
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    if (ws.data.channel === 'sdk') {
      const payload = typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      conversationService.handleSdkPayload(ws.data.sessionId, payload)
      return
    }

    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'computer_use_permission_response':
          handleComputerUsePermissionResponse(ws, message)
          break

        case 'set_permission_mode':
          handleSetPermissionMode(ws, message)
          break

        case 'set_effort':
          void handleSetEffort(ws, message)
          break

        case 'set_runtime_config':
          void handleSetRuntimeConfig(ws, message)
          break

        case 'prewarm_session':
          handlePrewarmSession(ws)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId, channel } = ws.data

    if (channel === 'sdk') {
      console.log(`[WS] SDK disconnected from session: ${sessionId} (${code}: ${reason})`)
      conversationService.detachSdkConnection(sessionId)
      return
    }

    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    computerUseApprovalService.cancelSession(sessionId)
    removeOutputCallbackForSocket(sessionId, ws)
    removeActiveClient(sessionId, ws)

    // Give active turns a longer reconnect grace so a transient GUI reload does
    // not kill a long-running agent task.
    const cleanupDelayMs = getSessionReconnectGraceMs(sessionId)
    scheduleSessionCleanup(sessionId, cleanupDelayMs)
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
    // Backpressure handling - called when the socket is ready to receive more data
  },
}

// ============================================================================
// Message handlers
// ============================================================================

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data
  const startupOverrides = await getUserMessageRuntimeOverrides(message)

  // Clear any stale stop flag from a previous turn
  sessionStopRequested.delete(sessionId)
  clearPrewarmState(sessionId)

  const desktopSlashCommand = getDesktopSlashCommand(message.content)
  if (desktopSlashCommand?.commandName === 'clear' && desktopSlashCommand.args.trim()) {
    sendMessage(ws, {
      type: 'error',
      message: 'The /clear command does not accept arguments.',
      code: 'INVALID_SLASH_COMMAND_ARGS',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  if (desktopSlashCommand?.commandName === 'clear') {
    await handleDesktopClearCommand(ws)
    return
  }

  // Send thinking status
  sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Thinking' })

  const pendingRuntimeTransition = runtimeTransitionPromises.get(sessionId)
  if (pendingRuntimeTransition) {
    try {
      await pendingRuntimeTransition
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[WS] Runtime transition failed before handling user message for ${sessionId}: ${errMsg}`)
      sendMessage(ws, {
        type: 'error',
        message: `Failed to switch provider/model: ${errMsg}`,
        code: 'CLI_RESTART_FAILED',
      })
      sendMessage(ws, { type: 'status', state: 'idle' })
      return
    }
  }

  // 启动 CLI 子进程（如果还没有）
  let cliContent = message.content
  let cliAttachments = message.attachments
  if (message.attachments?.length) {
    try {
      sendMessage(ws, { type: 'status', state: 'thinking', verb: '正在解析附件' })
      const prepared = await attachmentParserService.prepareMessageContent(
        message.content,
        sessionId,
        message.attachments,
      )
      if (prepared.usedParser) {
        cliContent = prepared.content
        cliAttachments = prepared.attachments
        sendMessage(ws, {
          type: 'system_notification',
          subtype: 'attachment_parser',
          data: {
            status: 'parsed',
            preview: prepared.preview,
          },
        })
      }
    } catch (err) {
      const messageText = err instanceof AttachmentParserError
        ? err.message
        : '附件解析失败，请检查 GLM 配置后重试。'
      console.warn(`[WS] Attachment parsing failed for ${sessionId}: ${messageText}`)
      sendMessage(ws, {
        type: 'system_notification',
        subtype: 'attachment_parser',
        message: messageText,
      })
      sendMessage(ws, { type: 'status', state: 'idle' })
      return
    }
  }

  try {
    await restartSessionForStartupOverrides(ws, sessionId, startupOverrides)
    await ensureCliSessionStarted(ws, sessionId, 'user_message', startupOverrides)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof ConversationStartupError ? err.code : 'CLI_START_FAILED'
    console.error(`[WS] CLI start failed for ${sessionId}: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: errMsg,
      code,
      retryable:
        err instanceof ConversationStartupError ? err.retryable : false,
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  // Track user message for title generation
  let titleState = sessionTitleState.get(sessionId)
  if (!titleState) {
    titleState = { userMessageCount: 0, hasCustomTitle: false, firstUserMessage: '', allUserMessages: [] }
    sessionTitleState.set(sessionId, titleState)
  }
  const titleInputText = getTitleInputText(message.content)
  titleState.userMessageCount++
  titleState.allUserMessages.push(titleInputText)
  if (titleState.userMessageCount === 1) {
    titleState.firstUserMessage = titleInputText
  }

  // Register the callback before sending the turn so startup errors are not lost.
  // Keep output muted until the current user turn is enqueued to avoid forwarding
  // any pre-turn SDK chatter as fresh chat history.
  let userMessageSent = false

  rebindSessionOutputs(sessionId, {
    shouldForward: (cliMsg) => userMessageSent || (cliMsg.type === 'result' && cliMsg.is_error),
  })

  startTurnMonitor(sessionId)
  const sent = conversationService.sendMessage(
    sessionId,
    cliContent,
    cliAttachments
  )
  if (!sent) {
    stopTurnMonitor(sessionId)
    sendMessage(ws, {
      type: 'error',
      message: 'CLI process is not running. The session may have ended or the process crashed.',
      code: 'CLI_NOT_RUNNING',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  userMessageSent = true
}

async function handleDesktopClearCommand(
  ws: ServerWebSocket<WebSocketData>,
) {
  const { sessionId } = ws.data

  const workDir = conversationService.getSessionWorkDir(sessionId)
  stopTurnMonitor(sessionId)
  conversationService.stopSession(sessionId)
  conversationService.clearOutputCallbacks(sessionId)
  sessionSlashCommands.delete(sessionId)
  sessionTitleState.delete(sessionId)
  cleanupStreamState(sessionId)

  try {
    await sessionService.clearSessionTranscript(sessionId, workDir || undefined)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    sendMessage(ws, {
      type: 'error',
      message: errMsg,
      code: 'SESSION_CLEAR_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
    return
  }

  sendMessage(ws, {
    type: 'system_notification',
    subtype: 'session_cleared',
    message: 'Conversation cleared',
  })
  sendMessage(ws, {
    type: 'message_complete',
    usage: { input_tokens: 0, output_tokens: 0 },
  })
}

function handlePrewarmSession(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  if (conversationService.hasSession(sessionId) || sessionStartupPromises.has(sessionId)) {
    return
  }

  prewarmPendingSessions.add(sessionId)
  void ensureCliSessionStarted(ws, sessionId, 'prewarm_session')
    .then(() => {
      if (!prewarmPendingSessions.delete(sessionId)) return
      bindPrewarmMetadataCapture(sessionId)
      markPrewarmed(sessionId)
    })
    .catch((err) => {
      prewarmPendingSessions.delete(sessionId)
      console.warn(
        `[WS] Prewarm failed for ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  conversationService.respondToPermission(
    sessionId,
    message.requestId,
    message.allowed,
    message.rule,
    message.updatedInput,
  )
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

function handleComputerUsePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'computer_use_permission_response' }>
) {
  const { sessionId } = ws.data
  const ok = computerUseApprovalService.resolveApproval(
    message.requestId,
    message.response,
  )
  if (!ok) {
    console.warn(
      `[WS] Ignored Computer Use permission response for unknown request ${message.requestId} from ${sessionId}`
    )
  }
}

function handleSetPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_permission_mode' }>
) {
  const { sessionId } = ws.data

  // Switching to/from bypassPermissions requires the CLI to be (re)started with
  // --dangerously-skip-permissions. The CLI rejects a runtime set_permission_mode
  // to bypassPermissions if it wasn't launched with that flag.  Rather than just
  // sending the SDK message (which would silently fail), restart the CLI subprocess
  // with the correct arguments so the new permission mode takes effect.
  const needsRestart =
    conversationService.hasSession(sessionId) &&
    (message.mode === 'bypassPermissions' || conversationService.getSessionPermissionMode(sessionId) === 'bypassPermissions')

  if (needsRestart) {
    void restartSessionWithPermissionMode(ws, sessionId, message.mode)
    return
  }

  const ok = conversationService.setPermissionMode(sessionId, message.mode)
  if (!ok) {
    console.warn(`[WS] Ignored permission mode update for inactive session ${sessionId}`)
  }
}

async function handleSetRuntimeConfig(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_runtime_config' }>
) {
  const { sessionId } = ws.data
  const modelId = typeof message.modelId === 'string' ? message.modelId.trim() : ''
  if (!modelId) {
    sendMessage(ws, {
      type: 'error',
      message: 'Runtime model selection is invalid.',
      code: 'RUNTIME_CONFIG_INVALID',
    })
    return
  }

  const nextOverride = {
    providerId: message.providerId ?? null,
    modelId,
  }
  const prevOverride = runtimeOverrides.get(sessionId)
  runtimeOverrides.set(sessionId, nextOverride)

  if (
    prevOverride &&
    prevOverride.providerId === nextOverride.providerId &&
    prevOverride.modelId === nextOverride.modelId
  ) {
    return
  }

  if (!conversationService.hasSession(sessionId)) {
    const pendingStartup = sessionStartupPromises.get(sessionId)
    if (pendingStartup) {
      await enqueueRuntimeTransition(sessionId, async () => {
        await pendingStartup.catch(() => undefined)
        const currentOverride = runtimeOverrides.get(sessionId)
        if (
          currentOverride?.providerId !== nextOverride.providerId ||
          currentOverride.modelId !== nextOverride.modelId ||
          !conversationService.hasSession(sessionId)
        ) {
          return
        }
        await restartSessionWithRuntimeConfig(ws, sessionId)
      })
    }
    return
  }

  await enqueueRuntimeTransition(sessionId, () =>
    restartSessionWithRuntimeConfig(ws, sessionId),
  )
}

async function handleSetEffort(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_effort' }>
) {
  const { sessionId } = ws.data
  const level = typeof message.level === 'string' ? message.level.trim() : ''
  if (!EFFORT_LEVELS.has(level)) {
    sendMessage(ws, {
      type: 'error',
      message: 'Effort level is invalid.',
      code: 'EFFORT_INVALID',
    })
    return
  }

  try {
    await settingsService.updateUserSettings({ effort: level })
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    sendMessage(ws, {
      type: 'error',
      message: `Failed to update effort: ${errMsg}`,
      code: 'EFFORT_UPDATE_FAILED',
    })
    return
  }

  if (!conversationService.hasSession(sessionId)) return

  await enqueueRuntimeTransition(sessionId, () =>
    restartSessionWithRuntimeConfig(
      ws,
      sessionId,
      'Updating reasoning effort...',
      'effort setting',
      'Failed to update effort',
    ),
  )
}

async function restartSessionWithPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  mode: string,
): Promise<void> {
  try {
    sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Restarting session with new permissions...' })

    // Persist the new mode first so it's read on restart
    await settingsService.setPermissionMode(mode)

    const workDir = conversationService.getSessionWorkDir(sessionId)
    conversationService.stopSession(sessionId)

    // Rebuild runtime settings (will pick up the persisted mode)
    const runtimeSettings = await getRuntimeSettings(sessionId)
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
    rememberSessionRuntime(sessionId, runtimeSettings)

    sendMessage(ws, { type: 'status', state: 'idle' })
    console.log(`[WS] Restarted CLI for ${sessionId} with permission mode: ${mode}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[WS] Failed to restart CLI for ${sessionId}: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: `Failed to restart session with new permission mode: ${errMsg}`,
      code: 'CLI_RESTART_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
  }
}

async function restartSessionWithRuntimeConfig(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  verb = 'Switching provider and model...',
  reason = 'runtime override',
  errorPrefix = 'Failed to switch provider/model',
): Promise<void> {
  try {
    sendMessage(ws, {
      type: 'status',
      state: 'thinking',
      verb,
    })

    const workDir = conversationService.getSessionWorkDir(sessionId)
    conversationService.stopSession(sessionId)

    const runtimeSettings = await getRuntimeSettings(sessionId)
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
    rememberSessionRuntime(sessionId, runtimeSettings)

    sendMessage(ws, { type: 'status', state: 'idle' })
    console.log(`[WS] Restarted CLI for ${sessionId} with ${reason}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[WS] Failed to restart CLI for ${sessionId} after runtime override: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: `${errorPrefix}: ${errMsg}`,
      code: 'CLI_RESTART_FAILED',
    })
    sendMessage(ws, { type: 'status', state: 'idle' })
  }
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  sessionStopRequested.add(sessionId)
  stopTurnMonitor(sessionId)

  if (conversationService.hasSession(sessionId)) {
    // First try graceful interrupt via SDK control message
    conversationService.sendInterrupt(sessionId)

    // Force-kill if still running after 3 seconds
    setTimeout(() => {
      if (conversationService.hasSession(sessionId)) {
        console.log(`[WS] Force-killing CLI subprocess for session: ${sessionId}`)
        conversationService.stopSession(sessionId)
      }
    }, 3_000)
  }

  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// Title generation
// ============================================================================

function triggerTitleGeneration(ws: ServerWebSocket<WebSocketData>, sessionId: string): void {
  const state = sessionTitleState.get(sessionId)
  if (!state || state.hasCustomTitle) return

  const count = state.userMessageCount

  // Generate on count 1 (first response) and count 3 (with more context)
  if (count !== 1 && count !== 3) return

  const text = count === 1
    ? state.firstUserMessage
    : state.allUserMessages.join('\n')
  const runtimeProviderId = runtimeOverrides.get(sessionId)?.providerId

  // Fire-and-forget: derive quick title, then upgrade with AI
  void (async () => {
    try {
      // Stage 1: quick placeholder (only on first message)
      if (count === 1) {
        const placeholder = deriveTitle(text)
        if (placeholder) {
          await saveAiTitle(sessionId, placeholder)
          sendMessage(ws, { type: 'session_title_updated', sessionId, title: placeholder })
        }
      }

      // Stage 2: AI-generated title
      const aiTitle = await generateTitle(text, runtimeProviderId)
      if (aiTitle) {
        await saveAiTitle(sessionId, aiTitle)
        sendMessage(ws, { type: 'session_title_updated', sessionId, title: aiTitle })
      }
    } catch (err) {
      console.error(`[Title] Failed to generate title for ${sessionId}:`, err)
    }
  })()
}

// ============================================================================
// CLI message translation
// ============================================================================

/**
 * Per-session streaming state to avoid cross-session interference.
 * Each session tracks its own dedup flag, active block types, and tool blocks.
 */
type SessionStreamState = {
  hasReceivedStreamEvents: boolean
  /**
   * True after at least one thinking_delta was forwarded for the current
   * assistant message. When stream_events exist but the model only puts
   * thinking in the final assistant payload (no streaming reasoning), we must
   * still forward that block — but if we already streamed deltas, the final
   * block is usually redundant and would duplicate the UI.
   */
  receivedThinkingDelta: boolean
  activeBlockTypes: Map<number, 'text' | 'tool_use' | 'thinking'>
  activeToolBlocks: Map<number, { toolName: string; toolUseId: string; inputJson: string }>
  /** Tool blocks whose input JSON failed to parse in content_block_stop.
   *  The assistant message carries the complete input — defer to that. */
  pendingToolBlocks: Map<string, { toolName: string; toolUseId: string; parentToolUseId?: string }>
  assistantTextSnapshot: string
  assistantThinkingSnapshot: string
  emittedAssistantToolUseIds: Set<string>
}

const sessionStreamStates = new Map<string, SessionStreamState>()

function getStreamState(sessionId: string): SessionStreamState {
  let state = sessionStreamStates.get(sessionId)
  if (!state) {
    state = {
      hasReceivedStreamEvents: false,
      receivedThinkingDelta: false,
      activeBlockTypes: new Map(),
      activeToolBlocks: new Map(),
      pendingToolBlocks: new Map(),
      assistantTextSnapshot: '',
      assistantThinkingSnapshot: '',
      emittedAssistantToolUseIds: new Set(),
    }
    sessionStreamStates.set(sessionId, state)
  }
  return state
}

function getSnapshotDelta(previous: string, next: string): string {
  if (!next) return ''
  if (!previous) return next
  if (next === previous) return ''
  return next.startsWith(previous) ? next.slice(previous.length) : next
}

function resetAssistantSnapshots(streamState: SessionStreamState) {
  streamState.assistantTextSnapshot = ''
  streamState.assistantThinkingSnapshot = ''
  streamState.emittedAssistantToolUseIds.clear()
}

function resetStreamStateForTurn(streamState: SessionStreamState) {
  streamState.hasReceivedStreamEvents = false
  streamState.receivedThinkingDelta = false
  streamState.activeBlockTypes.clear()
  streamState.activeToolBlocks.clear()
  streamState.pendingToolBlocks.clear()
  resetAssistantSnapshots(streamState)
}

/** Clean up stream state when an output binding disconnects */
function cleanupStreamState(streamKey: string) {
  sessionStreamStates.delete(streamKey)
}

function cleanupStreamStatesForSession(sessionId: string) {
  for (const key of sessionStreamStates.keys()) {
    if (key === sessionId || key.startsWith(`${sessionId}:`)) {
      sessionStreamStates.delete(key)
    }
  }
}

function cleanupSessionRuntimeState(sessionId: string) {
  stopTurnMonitor(sessionId)
  const prewarmCallback = prewarmMetadataCallbacks.get(sessionId)
  if (prewarmCallback) {
    conversationService.removeOutputCallback(sessionId, prewarmCallback)
    prewarmMetadataCallbacks.delete(sessionId)
  }
  cleanupStreamStatesForSession(sessionId)
  sessionSlashCommands.delete(sessionId)
  sessionTitleState.delete(sessionId)
  runtimeOverrides.delete(sessionId)
  sessionStartupRuntime.delete(sessionId)
  runtimeTransitionPromises.delete(sessionId)
  sessionStartupPromises.delete(sessionId)
  clearPrewarmState(sessionId)
}

function getPrewarmIdleTimeoutMs(): number {
  const raw = process.env.CC_HAHA_PREWARM_IDLE_TIMEOUT_MS
  if (!raw) return DEFAULT_PREWARM_IDLE_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_PREWARM_IDLE_TIMEOUT_MS
}

function clearPrewarmState(sessionId: string) {
  prewarmPendingSessions.delete(sessionId)
  prewarmedSessions.delete(sessionId)
  const timer = prewarmIdleTimers.get(sessionId)
  if (timer) {
    clearTimeout(timer)
    prewarmIdleTimers.delete(sessionId)
  }
}

function markPrewarmed(sessionId: string) {
  prewarmedSessions.add(sessionId)
  const timeoutMs = getPrewarmIdleTimeoutMs()
  if (timeoutMs === 0) return

  const existingTimer = prewarmIdleTimers.get(sessionId)
  if (existingTimer) clearTimeout(existingTimer)

  const timer = setTimeout(() => {
    prewarmIdleTimers.delete(sessionId)
    if (!prewarmedSessions.has(sessionId)) return
    console.log(`[WS] Prewarmed session ${sessionId} idle for ${timeoutMs}ms, stopping CLI subprocess`)
    conversationService.stopSession(sessionId)
    prewarmedSessions.delete(sessionId)
  }, timeoutMs)
  prewarmIdleTimers.set(sessionId, timer)
}

function cacheSessionInitMetadata(sessionId: string, cliMsg: any) {
  if (cliMsg?.type !== 'system' || cliMsg.subtype !== 'init') return
  if (cliMsg.slash_commands && Array.isArray(cliMsg.slash_commands)) {
    sessionSlashCommands.set(sessionId, cliMsg.slash_commands.map((cmd: any) => ({
      name: typeof cmd === 'string' ? cmd : (cmd.name || cmd.command || ''),
      description: typeof cmd === 'string' ? '' : (cmd.description || ''),
    })))
  }
}

function bindPrewarmMetadataCapture(sessionId: string) {
  for (const msg of conversationService.getRecentSdkMessages(sessionId)) {
    cacheSessionInitMetadata(sessionId, msg)
  }
  if (!conversationService.hasSession(sessionId)) return

  const previous = prewarmMetadataCallbacks.get(sessionId)
  if (previous) {
    conversationService.removeOutputCallback(sessionId, previous)
  }

  const callback = (cliMsg: any) => {
    cacheSessionInitMetadata(sessionId, cliMsg)
  }
  prewarmMetadataCallbacks.set(sessionId, callback)
  conversationService.onOutput(sessionId, callback)
}

async function resolveSessionWorkDir(sessionId: string, fallback = os.homedir()): Promise<string> {
  let workDir = fallback
  try {
    const resolved = await sessionService.getSessionWorkDir(sessionId)
    if (resolved) workDir = resolved
    console.log(
      `[WS] resolveSessionWorkDir: sessionId=${sessionId}, resolved workDir=${JSON.stringify(
        resolved,
      )}, will spawn CLI with workDir=${workDir}`,
    )
  } catch (resolveErr) {
    console.warn(
      `[WS] resolveSessionWorkDir: failed to resolve workDir for ${sessionId}, using fallback=${workDir}: ${
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr)
      }`,
    )
  }
  return workDir
}

async function getUserMessageRuntimeOverrides(
  message: Extract<ClientMessage, { type: 'user_message' }>,
): Promise<SessionStartupOverrides | undefined> {
  const mode = typeof message.permissionMode === 'string' ? message.permissionMode : undefined
  const overrides: SessionStartupOverrides = {}
  if (mode && ALLOWED_STARTUP_PERMISSION_MODES.has(mode)) {
    overrides.permissionMode = mode
  }

  const ceRuntime = await resolveCeModelStartupOverride(message.ceModelPreference)
  if (ceRuntime) {
    overrides.providerId = ceRuntime.providerId
    overrides.model = ceRuntime.model
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined
}

async function resolveCeModelStartupOverride(
  preference: Extract<ClientMessage, { type: 'user_message' }>['ceModelPreference'],
): Promise<{ providerId: string; model: string } | null> {
  if (preference !== 'fast' && preference !== 'strong') return null
  try {
    const { providers, activeId } = await providerService.listProviders()
    const provider = activeId ? providers.find((item) => item.id === activeId) : null
    if (!provider) return null

    const model = preference === 'fast'
      ? provider.models.haiku || provider.models.main
      : provider.models.opus || provider.models.sonnet || provider.models.main
    const trimmed = typeof model === 'string' ? model.trim() : ''
    if (!trimmed) return null
    return { providerId: provider.id, model: trimmed }
  } catch (error) {
    console.warn('[WS] Failed to resolve CE model preference:', error)
    return null
  }
}

async function restartSessionForStartupOverrides(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  startupOverrides?: SessionStartupOverrides,
): Promise<void> {
  const requestedMode = startupOverrides?.permissionMode
  const requestedRuntime = startupOverrides?.model
    ? { providerId: startupOverrides.providerId, model: startupOverrides.model }
    : undefined
  if ((!requestedMode && !requestedRuntime) || !conversationService.hasSession(sessionId)) return

  const currentMode = requestedMode ? conversationService.getSessionPermissionMode(sessionId) : undefined
  const currentRuntime = sessionStartupRuntime.get(sessionId)
  const needsPermissionRestart = Boolean(requestedMode && currentMode !== requestedMode)
  const needsRuntimeRestart = Boolean(
    requestedRuntime &&
    (
      currentRuntime?.providerId !== requestedRuntime.providerId ||
      currentRuntime?.model !== requestedRuntime.model
    ),
  )
  if (!needsPermissionRestart && !needsRuntimeRestart) return

  const workDir = conversationService.getSessionWorkDir(sessionId)
  conversationService.stopSession(sessionId)
  const sdkUrl =
    `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
    `?token=${encodeURIComponent(crypto.randomUUID())}`
  const runtimeSettings = {
    ...(await getRuntimeSettings(sessionId)),
    ...startupOverrides,
  }
  await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
  rememberSessionRuntime(sessionId, runtimeSettings)
  console.log(`[WS] Restarted CLI for ${sessionId} with startup overrides: ${JSON.stringify({
    permissionMode: startupOverrides?.permissionMode,
    model: startupOverrides?.model,
    providerId: startupOverrides?.providerId,
  })}`)
}

function rememberSessionRuntime(
  sessionId: string,
  runtimeSettings: { providerId?: string | null; model?: string },
): void {
  sessionStartupRuntime.set(sessionId, {
    providerId: runtimeSettings.providerId,
    model: runtimeSettings.model,
  })
}

async function ensureCliSessionStarted(
  ws: ServerWebSocket<WebSocketData>,
  sessionId: string,
  reason: 'user_message' | 'prewarm_session',
  startupOverrides?: SessionStartupOverrides,
): Promise<void> {
  const pendingStartup = sessionStartupPromises.get(sessionId)
  if (pendingStartup) {
    await pendingStartup
    await restartSessionForStartupOverrides(ws, sessionId, startupOverrides)
    return
  }

  if (conversationService.hasSession(sessionId)) return

  const startup = (async () => {
    const workDir = await resolveSessionWorkDir(sessionId)
    const runtimeSettings = {
      ...(await getRuntimeSettings(sessionId)),
      ...startupOverrides,
    }
    const sdkUrl =
      `ws://${ws.data.serverHost}:${ws.data.serverPort}/sdk/${sessionId}` +
      `?token=${encodeURIComponent(crypto.randomUUID())}`
    console.log(`[WS] Starting CLI for ${sessionId} due to ${reason}`)
    await conversationService.startSession(sessionId, workDir, sdkUrl, runtimeSettings)
    rememberSessionRuntime(sessionId, runtimeSettings)
  })()

  sessionStartupPromises.set(sessionId, startup)
  try {
    await startup
  } finally {
    if (sessionStartupPromises.get(sessionId) === startup) {
      sessionStartupPromises.delete(sessionId)
    }
  }
}

/** Exported for unit tests — translates one CLI stdout JSON line into WS payloads. */
export function translateCliMessage(cliMsg: any, sessionId: string): ServerMessage[] {
  const streamState = getStreamState(sessionId)
  switch (cliMsg.type) {
    case 'assistant': {
      if (cliMsg.error) {
        return [{
          type: 'error',
          message: cliMsg.message?.content?.[0]?.text || cliMsg.error,
          code: cliMsg.error,
        }]
      }

      // If we already received stream_events, text/thinking were already sent.
      // Only extract tool_use blocks (stream_event's content_block_stop lacks complete tool info).
      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        const messages: ServerMessage[] = []

        for (const block of cliMsg.message.content) {
          if (streamState.hasReceivedStreamEvents) {
            // Stream events handled most blocks — but any tool_use whose
            // input JSON failed to parse in content_block_stop was deferred.
            // Emit those now with the complete input from the assistant message.
            if (block.type === 'tool_use' && streamState.pendingToolBlocks.has(block.id)) {
              const pending = streamState.pendingToolBlocks.get(block.id)!
              streamState.pendingToolBlocks.delete(block.id)
              messages.push({
                type: 'tool_use_complete',
                toolName: pending.toolName || block.name,
                toolUseId: block.id,
                input: block.input,
                parentToolUseId: pending.parentToolUseId,
              })
            } else if (
              block.type === 'thinking' &&
              typeof block.thinking === 'string' &&
              block.thinking.length > 0 &&
              !streamState.receivedThinkingDelta
            ) {
              // Many providers stream text/tool_use but attach reasoning only on
              // the final assistant message (no thinking_delta). Without this,
              // the desktop never shows thinking while stream_events were seen.
              messages.push({ type: 'thinking', text: block.thinking })
            }
          } else {
            // No stream events received — this is the only source, process everything
            if (block.type === 'thinking' && block.thinking) {
              const thinkingDelta = getSnapshotDelta(
                streamState.assistantThinkingSnapshot,
                block.thinking,
              )
              streamState.assistantThinkingSnapshot = block.thinking
              if (thinkingDelta) {
                messages.push({ type: 'thinking', text: thinkingDelta })
              }
            } else if (block.type === 'text' && block.text) {
              const textDelta = getSnapshotDelta(streamState.assistantTextSnapshot, block.text)
              streamState.assistantTextSnapshot = block.text
              if (textDelta) {
                messages.push({ type: 'content_start', blockType: 'text' })
                messages.push({ type: 'content_delta', text: textDelta })
              }
            } else if (
              block.type === 'tool_use' &&
              !streamState.emittedAssistantToolUseIds.has(block.id)
            ) {
              streamState.emittedAssistantToolUseIds.add(block.id)
              messages.push({
                type: 'tool_use_complete',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input,
                parentToolUseId:
                  typeof cliMsg.parent_tool_use_id === 'string'
                    ? cliMsg.parent_tool_use_id
                    : undefined,
              })
            }
          }
        }

        if (streamState.hasReceivedStreamEvents) {
          resetStreamStateForTurn(streamState)
        }
        return messages
      }
      return []
    }

    case 'user': {
      // Bug #1: 处理 tool_result 消息
      // CLI 发送 type:'user' 消息，其中 content 包含 tool_result 块
      const messages: ServerMessage[] = []

      const localCommandOutput = extractLocalCommandOutput(
        cliMsg.message?.content,
      )
      if (localCommandOutput) {
        messages.push({ type: 'content_start', blockType: 'text' })
        messages.push({ type: 'content_delta', text: localCommandOutput })
      }

      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_result') {
            messages.push({
              type: 'tool_result',
              toolUseId: block.tool_use_id,
              content: block.content,
              isError: !!block.is_error,
              parentToolUseId:
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined,
            })
          }
        }
      }

      return messages
    }

    case 'stream_event': {
      streamState.hasReceivedStreamEvents = true
      const event = cliMsg.event
      if (!event) return []

      switch (event.type) {
        case 'message_start': {
          resetStreamStateForTurn(streamState)
          streamState.hasReceivedStreamEvents = true
          streamState.receivedThinkingDelta = false
          return [{ type: 'status', state: 'streaming' }]
        }

        case 'content_block_start': {
          const contentBlock = event.content_block
          if (!contentBlock) return []

          const index = event.index ?? 0

          if (contentBlock.type === 'thinking') {
            streamState.activeBlockTypes.set(index, 'thinking')
            // Thinking UI is driven by thinking_delta / final assistant block — do not
            // emit content_start:text (would clear the thinking spinner state wrongly).
            return []
          }

          streamState.activeBlockTypes.set(index, contentBlock.type === 'tool_use' ? 'tool_use' : 'text')

          if (contentBlock.type === 'tool_use') {
            // Track tool info so content_block_stop can emit complete data
            streamState.activeToolBlocks.set(index, {
              toolName: contentBlock.name || '',
              toolUseId: contentBlock.id || '',
              inputJson: '',
            })
            return [{
              type: 'content_start',
              blockType: 'tool_use',
              toolName: contentBlock.name,
              toolUseId: contentBlock.id,
              parentToolUseId:
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined,
            }]
          }
          return [{ type: 'content_start', blockType: 'text' }]
        }

        case 'content_block_delta': {
          const delta = event.delta
          if (!delta) return []

          if (delta.type === 'text_delta' && delta.text) {
            return [{ type: 'content_delta', text: delta.text }]
          }
          if (delta.type === 'input_json_delta' && delta.partial_json) {
            // Accumulate tool input JSON
            const index = event.index ?? 0
            const toolBlock = streamState.activeToolBlocks.get(index)
            if (toolBlock) toolBlock.inputJson += delta.partial_json
            return [{ type: 'content_delta', toolInput: delta.partial_json }]
          }
          if (delta.type === 'thinking_delta' && delta.thinking) {
            streamState.receivedThinkingDelta = true
            return [{ type: 'thinking', text: delta.thinking }]
          }
          return []
        }

        case 'content_block_stop': {
          const index = event.index ?? 0
          const blockType = streamState.activeBlockTypes.get(index)
          streamState.activeBlockTypes.delete(index)

          if (blockType === 'tool_use') {
            const toolBlock = streamState.activeToolBlocks.get(index)
            streamState.activeToolBlocks.delete(index)
            if (toolBlock) {
              const parentToolUseId =
                typeof cliMsg.parent_tool_use_id === 'string'
                  ? cliMsg.parent_tool_use_id
                  : undefined
              let parsedInput = null
              try { parsedInput = JSON.parse(toolBlock.inputJson) } catch {}

              if (parsedInput !== null) {
                return [{
                  type: 'tool_use_complete',
                  toolName: toolBlock.toolName,
                  toolUseId: toolBlock.toolUseId,
                  input: parsedInput,
                  parentToolUseId,
                }]
              }

              // JSON parse failed — defer to the assistant message which
              // carries the complete, already-parsed tool input.
              console.warn(
                `[WS] Tool input JSON parse failed for ${toolBlock.toolName} (${toolBlock.toolUseId}), deferring to assistant message`,
              )
              streamState.pendingToolBlocks.set(toolBlock.toolUseId, {
                toolName: toolBlock.toolName,
                toolUseId: toolBlock.toolUseId,
                parentToolUseId,
              })
            }
          }
          return []
        }

        case 'message_stop': {
          // message_stop is handled by the 'result' message
          return []
        }

        case 'message_delta': {
          // message_delta may contain stop_reason or usage updates
          return []
        }

        default:
          return []
      }
    }

    case 'control_request': {
      // 权限请求 — CLI 需要用户授权才能执行工具
      if (cliMsg.request?.subtype === 'can_use_tool') {
        return [{
          type: 'permission_request',
          requestId: cliMsg.request_id,
          toolName: cliMsg.request.tool_name || 'Unknown',
          toolUseId:
            typeof cliMsg.request.tool_use_id === 'string'
              ? cliMsg.request.tool_use_id
              : undefined,
          input: cliMsg.request.input || {},
          description: cliMsg.request.description,
        }]
      }
      return []
    }

    case 'control_response':
      return []

    case 'result': {
      resetStreamStateForTurn(streamState)
      // 对话结果（成功或错误）
      const usage = {
        input_tokens: cliMsg.usage?.input_tokens || 0,
        output_tokens: cliMsg.usage?.output_tokens || 0,
      }

      if (cliMsg.is_error) {
        // If the user requested stop, this "error" is just the interrupt
        // result — don't show it as an error in the chat UI.
        if (sessionStopRequested.has(sessionId)) {
          sessionStopRequested.delete(sessionId)
          return [{ type: 'message_complete', usage }]
        }

        const resultMessage =
          (typeof cliMsg.result === 'string' && cliMsg.result) ||
          (Array.isArray(cliMsg.errors) && cliMsg.errors.length > 0
            ? cliMsg.errors.join('\n')
            : 'Unknown error')
        // 错误和完成消息都发送
        return [
          {
            type: 'error',
            message: resultMessage,
            code: 'CLI_ERROR',
          },
          { type: 'message_complete', usage },
        ]
      }

      // Clear stop flag on successful completion too
      sessionStopRequested.delete(sessionId)
      return [{ type: 'message_complete', usage }]
    }

    case 'system': {
      // 区分不同的 system 子类型
      const subtype = cliMsg.subtype
      if (subtype === 'init') {
        // CLI 初始化完成 — 缓存 slash commands 并发送模型信息
        // NOTE: Do NOT send status:idle here — the CLI init fires while
        // processing the first user message, and sending idle would reset
        // the frontend's streaming state prematurely.
        cacheSessionInitMetadata(sessionId, cliMsg)
        const messages: ServerMessage[] = [
          // Send model info as a system notification, not a status change
          { type: 'system_notification', subtype: 'init', message: `Model: ${cliMsg.model || 'unknown'}`, data: { model: cliMsg.model } },
        ]
        // Send slash commands to frontend
        const cmds = sessionSlashCommands.get(sessionId)
        if (cmds && cmds.length > 0) {
          messages.push({
            type: 'system_notification',
            subtype: 'slash_commands',
            data: cmds,
          })
        }
        return messages
      }
      if (subtype === 'hook_started' || subtype === 'hook_response') {
        // Hook 执行中 — 不转发给前端
        return []
      }
      if (subtype === 'local_command' || subtype === 'local_command_output') {
        const localCommandOutput = extractLocalCommandOutput(
          cliMsg.content ?? cliMsg.message,
          { allowUntagged: subtype === 'local_command_output' },
        )
        if (!localCommandOutput) return []
        return [
          { type: 'content_start', blockType: 'text' },
          { type: 'content_delta', text: localCommandOutput },
        ]
      }
      // Bug #7: 处理 task/team system 消息
      if (subtype === 'task_notification') {
        return [{
          type: 'system_notification',
          subtype: 'task_notification',
          message: cliMsg.message || cliMsg.title,
          data: cliMsg,
        }]
      }
      if (subtype === 'task_started') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task started',
        }]
      }
      if (subtype === 'task_progress') {
        return [{
          type: 'status',
          state: 'tool_executing',
          verb: cliMsg.message || 'Task in progress',
        }]
      }
      if (subtype === 'session_state_changed') {
        return [{
          type: 'system_notification',
          subtype: 'session_state_changed',
          message: cliMsg.message,
          data: cliMsg,
        }]
      }
      if (subtype === 'compact_boundary') {
        return [{
          type: 'system_notification',
          subtype: 'compact_boundary',
          message: getCompactBoundaryMessage(cliMsg),
          data: cliMsg.compact_metadata ?? cliMsg,
        }]
      }
      // 其他 system 消息
      return []
    }

    case 'keep_alive':
      return []

    default:
      // 未知类型 — 调试输出但不转发
      console.log(`[WS] Unknown CLI message type: ${cliMsg.type}`, JSON.stringify(cliMsg).substring(0, 200))
      return []
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

function addActiveClient(sessionId: string, ws: ServerWebSocket<WebSocketData>) {
  let clients = activeSessions.get(sessionId)
  if (!clients) {
    clients = new Set()
    activeSessions.set(sessionId, clients)
  }
  clients.add(ws)
}

function removeActiveClient(sessionId: string, ws: ServerWebSocket<WebSocketData>) {
  const clients = activeSessions.get(sessionId)
  if (!clients) return
  clients.delete(ws)
  if (clients.size === 0) {
    activeSessions.delete(sessionId)
  }
}

function hasActiveClient(sessionId: string): boolean {
  return (activeSessions.get(sessionId)?.size ?? 0) > 0
}

function removeOutputCallbackForSocket(
  sessionId: string,
  ws: ServerWebSocket<WebSocketData>,
) {
  const callback = ws.data.outputCallback
  if (callback) {
    conversationService.removeOutputCallback(sessionId, callback)
  }
  if (ws.data.outputStreamKey) {
    cleanupStreamState(ws.data.outputStreamKey)
  }
  ws.data.outputCallback = undefined
  ws.data.outputStreamKey = undefined
}

function rebindSessionOutputs(
  sessionId: string,
  options?: {
    shouldForward?: (cliMsg: any) => boolean
  },
) {
  const clients = activeSessions.get(sessionId)
  if (!clients) return
  for (const ws of clients) {
    rebindSessionOutput(sessionId, ws, options)
  }
}

function getDesktopSlashCommand(content: string): ReturnType<typeof parseSlashCommand> {
  const parsed = parseSlashCommand(content.trim())
  if (!parsed || parsed.isMcp) return null
  return parsed
}

function extractLocalCommandOutput(
  content: unknown,
  options: { allowUntagged?: boolean } = {},
): string | null {
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
        .flatMap((block) => {
          if (!block || typeof block !== 'object') return []
          const text = (block as { text?: unknown }).text
          return typeof text === 'string' ? [text] : []
        })
        .join('\n')
      : ''

  if (!raw) return null

  const stdout = extractTaggedContent(raw, LOCAL_COMMAND_STDOUT_TAG)
  if (stdout !== null) return stdout

  const stderr = extractTaggedContent(raw, LOCAL_COMMAND_STDERR_TAG)
  if (stderr !== null) return stderr

  if (options.allowUntagged) {
    const normalized = raw.trim()
    return normalized || null
  }

  return null
}

function extractTaggedContent(raw: string, tag: string): string | null {
  const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return match?.[1]?.trim() ?? null
}

function getCompactBoundaryMessage(cliMsg: any): string {
  const message = typeof cliMsg?.message === 'string' ? cliMsg.message.trim() : ''
  if (message) return message

  const content = typeof cliMsg?.content === 'string' ? cliMsg.content.trim() : ''
  if (content) return content

  return 'Context compacted'
}

function rebindSessionOutput(
  sessionId: string,
  ws: ServerWebSocket<WebSocketData>,
  options?: {
    shouldForward?: (cliMsg: any) => boolean
  },
) {
  if (!conversationService.hasSession(sessionId)) return

  removeOutputCallbackForSocket(sessionId, ws)

  const streamKey = `${sessionId}:${crypto.randomUUID()}`
  const callback = (cliMsg: any) => {
    if (options?.shouldForward && !options.shouldForward(cliMsg)) {
      return
    }

    const serverMsgs = translateCliMessage(cliMsg, streamKey)
    for (const msg of serverMsgs) {
      sendMessage(ws, msg)
    }

    if (cliMsg.type === 'result') {
      triggerTitleGeneration(ws, sessionId)
    }
  }

  ws.data.outputCallback = callback
  ws.data.outputStreamKey = streamKey
  conversationService.onOutput(sessionId, callback)
}

async function getRuntimeSettings(sessionId?: string): Promise<{
  permissionMode?: string
  model?: string
  effort?: string
  providerId?: string | null
}> {
  const runtimeOverride = sessionId ? runtimeOverrides.get(sessionId) : undefined
  if (runtimeOverride) {
    const userSettings = await settingsService.getUserSettings()
    const effort =
      typeof userSettings.effort === 'string' && userSettings.effort.trim()
        ? userSettings.effort
        : undefined
    const model =
      typeof runtimeOverride.providerId === 'string'
        ? resolveProviderModelId(
            await providerService.getProvider(runtimeOverride.providerId),
            runtimeOverride.modelId,
          )
        : runtimeOverride.modelId

    return {
      permissionMode: await settingsService.getPermissionMode().catch(() => undefined),
      model,
      effort,
      providerId: runtimeOverride.providerId,
    }
  }

  // Check if a custom provider is active
  const { providers, activeId } = await providerService.listProviders()
  const activeProvider = activeId ? providers.find((p) => p.id === activeId) : null
  const userSettings = await settingsService.getUserSettings()
  const providerSettings = activeProvider
    ? await providerService.getManagedSettings()
    : undefined
  const modelSettings = providerSettings ?? userSettings
  const modelContext =
    typeof modelSettings.modelContext === 'string' && modelSettings.modelContext.trim()
      ? modelSettings.modelContext
      : undefined
  const effort =
    typeof userSettings.effort === 'string' && userSettings.effort.trim()
      ? userSettings.effort
      : undefined

  let model: string | undefined
  if (activeProvider) {
    // Provider is active — only consult provider-managed cc-haha settings.
    // Global ~/.claude/settings.json model values must not bleed into provider mode.
    const baseModel =
      typeof modelSettings.model === 'string' && modelSettings.model.trim()
        ? modelSettings.model
        : ''
    const env = (providerSettings?.env as Record<string, string> | undefined) ?? {}
    const explicitModelIsValid = isProviderModelId(activeProvider, baseModel)
    model = resolveProviderModelId(activeProvider, baseModel, env.ANTHROPIC_MODEL)
    if (explicitModelIsValid && modelContext) {
      model += `:${modelContext}`
    }
  } else {
    // No provider — pass model normally
    const baseModel =
      typeof userSettings.model === 'string' && userSettings.model.trim()
        ? userSettings.model
        : undefined
    model = baseModel ? (modelContext ? `${baseModel}:${modelContext}` : baseModel) : undefined
  }

  return {
    permissionMode: await settingsService.getPermissionMode().catch(() => undefined),
    model,
    effort,
    providerId: activeId,
  }
}

function enqueueRuntimeTransition(
  sessionId: string,
  transition: () => Promise<void>,
): Promise<void> {
  const previous = runtimeTransitionPromises.get(sessionId) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(transition)
    .finally(() => {
      if (runtimeTransitionPromises.get(sessionId) === next) {
        runtimeTransitionPromises.delete(sessionId)
      }
    })
  runtimeTransitionPromises.set(sessionId, next)
  return next
}

/**
 * Send a message to a specific session's WebSocket (for use by services)
 */
export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const clients = activeSessions.get(sessionId)
  if (!clients || clients.size === 0) return false
  for (const ws of clients) {
    ws.send(JSON.stringify(message))
  }
  return true
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}

export const __testing = {
  clearTurnMonitor(sessionId: string) {
    stopTurnMonitor(sessionId)
  },
  getReconnectGraceMs(sessionId: string) {
    return getSessionReconnectGraceMs(sessionId)
  },
  getTurnMonitorSnapshot(sessionId: string) {
    const monitor = sessionTurnMonitors.get(sessionId)
    if (!monitor) return null
    return {
      phase: monitor.phase,
      startedAt: monitor.startedAt,
      lastProgressAt: monitor.lastProgressAt,
      lastKeepAliveAt: monitor.lastKeepAliveAt,
      nextNoticeAt: monitor.nextNoticeAt,
    }
  },
  noteTurnActivity(sessionId: string, cliMsg: any) {
    noteTurnActivity(sessionId, cliMsg)
  },
  setTurnMonitor(
    sessionId: string,
    partial: Partial<Omit<TurnMonitor, 'sessionId' | 'callback' | 'timer'>> = {},
  ) {
    stopTurnMonitor(sessionId)
    const now = Date.now()
    sessionTurnMonitors.set(sessionId, {
      sessionId,
      phase: partial.phase ?? 'thinking',
      startedAt: partial.startedAt ?? now,
      lastProgressAt: partial.lastProgressAt ?? now,
      lastKeepAliveAt: partial.lastKeepAliveAt ?? now,
      nextNoticeAt: partial.nextNoticeAt ?? now + DEFAULT_TURN_PROGRESS_NOTICE_MS,
      modelStallNoticeSent: partial.modelStallNoticeSent ?? false,
      toolStallNoticeSent: partial.toolStallNoticeSent ?? false,
      callback: () => {},
      timer: null,
    })
  },
}

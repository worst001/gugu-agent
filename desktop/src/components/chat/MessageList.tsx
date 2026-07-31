import { useRef, useEffect, useMemo, memo, useState, useCallback } from 'react'
import { ApiError } from '../../api/client'
import { sessionsApi, type SessionCheckpoint, type SessionRewindResponse } from '../../api/sessions'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTeamStore } from '../../stores/teamStore'
import { useUIStore } from '../../stores/uiStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { isUnsupportedAttachmentInputError } from '../../utils/attachmentErrors'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { AskUserQuestion } from './AskUserQuestion'
import { AgentActivityPanel } from './AgentActivityPanel'
import { InlineTaskSummary } from './InlineTaskSummary'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { isHiddenToolErrorContent } from './toolResultDisplay'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type RenderItem =
  | { kind: 'tool_group'; toolCalls: ToolCall[]; id: string }
  | { kind: 'message'; message: UIMessage }

type RenderModel = {
  renderItems: RenderItem[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
}

function isHiddenProactiveTickMessage(message: UIMessage): boolean {
  if (message.type === 'thinking' || message.type === 'tool_use') {
    return message.origin === 'proactive_tick'
  }
  if (message.type === 'tool_result') {
    return message.origin === 'proactive_tick' && !message.isError
  }
  return false
}

type AssistantTextMessage = Extract<UIMessage, { type: 'assistant_text' }>
type UserTextMessage = Extract<UIMessage, { type: 'user_text' }>

type RewindTarget = {
  messageId: string
  userMessageIndex: number
  content: string
  attachments?: UserTextMessage['attachments']
}

type MessageActionTarget = {
  message: UserTextMessage
  userMessageIndex: number
}

type PlanConfirmationTarget = {
  sessionId: string
  message: AssistantTextMessage
}

function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return typeof error.body === 'object' && error.body && 'message' in error.body
      ? String((error.body as { message: unknown }).message)
      : error.message
  }
  return error instanceof Error ? error.message : String(error)
}

function isSessionTranscriptMissingError(error: unknown, message: string): boolean {
  return /Session not found/i.test(message) &&
    (!(error instanceof ApiError) || error.status === 404)
}

function findLocalRewindStartIndex(messages: UIMessage[], target: RewindTarget): number {
  const idIndex = messages.findIndex((message) => message.id === target.messageId)
  if (idIndex >= 0) return idIndex

  let userMessageIndex = -1
  return messages.findIndex((message) => {
    if (message.type !== 'user_text' || message.pending) return false
    userMessageIndex += 1
    return userMessageIndex === target.userMessageIndex
  })
}

function createLocalRewindPreview(
  messages: UIMessage[],
  target: RewindTarget,
  reason: string,
): SessionRewindResponse | null {
  const startIndex = findLocalRewindStartIndex(messages, target)
  if (startIndex < 0) return null
  const removedMessages = messages.slice(startIndex)
  return {
    target: {
      targetUserMessageId: target.messageId,
      userMessageIndex: target.userMessageIndex,
      userMessageCount: messages.filter((message) => message.type === 'user_text' && !message.pending).length,
    },
    conversation: {
      messagesRemoved: Math.max(1, removedMessages.length),
      removedMessageIds: removedMessages.map((message) => message.id),
    },
    code: {
      available: false,
      reason,
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    },
  }
}

function appendChildToolCall(
  childToolCallsByParent: Map<string, ToolCall[]>,
  parentToolUseId: string,
  toolCall: ToolCall,
) {
  const siblings = childToolCallsByParent.get(parentToolUseId)
  if (siblings) {
    siblings.push(toolCall)
  } else {
    childToolCallsByParent.set(parentToolUseId, [toolCall])
  }
}

function isGuguQuotaError(message: Extract<UIMessage, { type: 'error' }>): boolean {
  return message.code === 'GUGU_QUOTA_EXHAUSTED' ||
    message.code === 'GUGU_SUBSCRIPTION_INACTIVE' ||
    message.message.includes('[GUGU_QUOTA_EXHAUSTED]') ||
    message.message.includes('[GUGU_SUBSCRIPTION_INACTIVE]') ||
    message.message.includes('quota_exceeded')
}

function getGuguBillingMessage(message: string): string {
  return message
    .replace('[GUGU_QUOTA_EXHAUSTED]', '')
    .replace('[GUGU_SUBSCRIPTION_INACTIVE]', '')
    .trim()
}

type FriendlyErrorCopy = {
  title: string
  reason: string
  impact: string
  nextStep: string
  detail?: string
}

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function buildFriendlyErrorCopy(
  message: Extract<UIMessage, { type: 'error' }>,
  displayMessage: string,
  t: ReturnType<typeof useTranslation>,
): FriendlyErrorCopy {
  const rawMessage = message.message.trim()
  const code = message.code ?? ''
  const combined = `${code}\n${rawMessage}`

  const base: FriendlyErrorCopy = {
    title: t('chat.errorCard.title'),
    reason: displayMessage || t('chat.errorCard.reason.generic'),
    impact: t('chat.errorCard.impact.generic'),
    nextStep: t('chat.errorCard.next.generic'),
  }

  if (isSessionTranscriptMissingError({ status: 404 }, rawMessage)) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.sessionMissing'),
      impact: t('chat.errorCard.impact.sessionMissing'),
      nextStep: t('chat.errorCard.next.sessionMissing'),
    }
  }

  if (includesAny(combined, [/1P event logging:/i, /Failed to export \d+ events/i, /\[ede_diagnostic\]/i])) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.telemetry'),
      impact: t('chat.errorCard.impact.telemetry'),
      nextStep: t('chat.errorCard.next.telemetry'),
      detail: rawMessage,
    }
  }

  if (includesAny(combined, [/attachment parsing timed out/i, /parsing timed out/i, /timed out before responding/i, /附件.*超时/u])) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.attachmentTimeout'),
      impact: t('chat.errorCard.impact.attachmentTimeout'),
      nextStep: t('chat.errorCard.next.attachmentTimeout'),
      detail: rawMessage,
    }
  }

  if (includesAny(combined, [/over the \d+\s*MB/i, /超过.*\d+\s*MB/u, /exceeds?.*(limit|maximum|max)/i, /file too large/i, /文件.*过大/u])) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.fileTooLarge'),
      impact: t('chat.errorCard.impact.fileTooLarge'),
      nextStep: t('chat.errorCard.next.fileTooLarge'),
      detail: rawMessage,
    }
  }

  if (includesAny(combined, [/custom mode.*without a GLM key/i, /GLM.*not.*configured/i, /GLM.*未配置/u, /GLM.*未激活/u])) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.glmUnavailable'),
      impact: t('chat.errorCard.impact.glmUnavailable'),
      nextStep: t('chat.errorCard.next.glmUnavailable'),
      detail: rawMessage,
    }
  }

  if (includesAny(combined, [/No suitable shell found/i, /requires a Posix shell/i, /git-bash/i, /missing mode argument/i])) {
    return {
      ...base,
      reason: t('chat.errorCard.reason.runtimeMissing'),
      impact: t('chat.errorCard.impact.runtimeMissing'),
      nextStep: t('chat.errorCard.next.runtimeMissing'),
      detail: rawMessage,
    }
  }

  if (code.startsWith('CLI_')) {
    return {
      ...base,
      reason: displayMessage || t('chat.errorCard.reason.runtimeMissing'),
      impact: t('chat.errorCard.impact.runtimeMissing'),
      nextStep: t('chat.errorCard.next.runtimeMissing'),
      detail: rawMessage !== displayMessage ? rawMessage : undefined,
    }
  }

  return {
    ...base,
    detail: rawMessage !== displayMessage ? rawMessage : undefined,
  }
}

function FriendlyErrorCard({
  message,
  displayMessage,
}: {
  message: Extract<UIMessage, { type: 'error' }>
  displayMessage: string
}) {
  const t = useTranslation()
  const copy = buildFriendlyErrorCopy(message, displayMessage, t)
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/28 px-4 py-3 text-sm text-[var(--color-on-error-container)]">
      <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--color-error)]">
        <span className="material-symbols-outlined text-[18px]">error</span>
        {copy.title}
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-xs font-medium text-[var(--color-error)]">{t('chat.errorCard.reasonLabel')}</div>
          <div className="mt-0.5 text-[var(--color-on-error-container)]">{copy.reason}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-error)]">{t('chat.errorCard.impactLabel')}</div>
          <div className="mt-0.5 text-[var(--color-on-error-container)]">{copy.impact}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--color-error)]">{t('chat.errorCard.nextLabel')}</div>
          <div className="mt-0.5 text-[var(--color-on-error-container)]">{copy.nextStep}</div>
        </div>
      </div>
      {copy.detail && (
        <details className="mt-3 text-xs text-[var(--color-on-error-container)]/85">
          <summary className="cursor-pointer select-none text-[var(--color-error)]">{t('chat.errorCard.details')}</summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--color-surface-container-high)] px-3 py-2 font-mono text-[11px] leading-5">
            {copy.detail}
          </pre>
        </details>
      )}
    </div>
  )
}

function GuguQuotaCard({
  code,
  message,
}: {
  code?: string
  message: string
}) {
  const t = useTranslation()
  const openBilling = () => {
    useUIStore.getState().setPendingSettingsTab('billing')
    useUIStore.getState().setActiveView('settings')
  }
  const isSubscriptionInactive =
    code === 'GUGU_SUBSCRIPTION_INACTIVE' ||
    message.includes('[GUGU_SUBSCRIPTION_INACTIVE]')
  const fallbackMessage = isSubscriptionInactive
    ? t('chat.guguSubscription.message')
    : t('chat.guguQuota.message')
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <span className="material-symbols-outlined text-[18px] text-[var(--color-warning)]">workspace_premium</span>
        {isSubscriptionInactive ? t('chat.guguSubscription.title') : t('chat.guguQuota.title')}
      </div>
      <p className="text-[var(--color-text-secondary)]">
        {getGuguBillingMessage(message) || fallbackMessage}
      </p>
      <div className="mt-3">
        <Button size="sm" variant="secondary" onClick={openBilling}>
          <span className="material-symbols-outlined text-[15px]">open_in_new</span>
          {t('chat.guguQuota.action')}
        </Button>
      </div>
    </div>
  )
}

export function buildRenderModel(messages: UIMessage[]): RenderModel {
  const items: RenderItem[] = []
  const toolResultMap = new Map<string, ToolResult>()
  const childToolCallsByParent = new Map<string, ToolCall[]>()
  const toolUseIds = new Set<string>()
  const hiddenToolUseIds = new Set<string>()
  let pendingToolCalls: ToolCall[] = []

  const flushGroup = () => {
    if (pendingToolCalls.length > 0) {
      items.push({
        kind: 'tool_group',
        toolCalls: [...pendingToolCalls],
        id: `group-${pendingToolCalls[0]!.id}`,
      })
      pendingToolCalls = []
    }
  }

  for (const msg of messages) {
    if (isHiddenProactiveTickMessage(msg)) continue
    if (msg.type === 'tool_result' && msg.isError && isHiddenToolErrorContent(msg.content)) {
      hiddenToolUseIds.add(msg.toolUseId)
    }
  }

  for (const msg of messages) {
    if (isHiddenProactiveTickMessage(msg)) continue
    if (msg.type === 'tool_use') {
      if (hiddenToolUseIds.has(msg.toolUseId)) continue
      toolUseIds.add(msg.toolUseId)
    }
    if (msg.type === 'tool_result') {
      if (hiddenToolUseIds.has(msg.toolUseId)) continue
      toolResultMap.set(msg.toolUseId, msg)
    }
  }

  for (const msg of messages) {
    if (isHiddenProactiveTickMessage(msg)) {
      continue
    }
    if (msg.type === 'assistant_text' && !msg.content.trim()) {
      continue
    }
    if (
      (msg.type === 'tool_use' || msg.type === 'tool_result') &&
      hiddenToolUseIds.has(msg.toolUseId)
    ) {
      continue
    }
    if (msg.type === 'tool_result' && toolUseIds.has(msg.toolUseId)) {
      continue
    }
    if (msg.type === 'tool_result' && msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) {
      continue
    }

    if (msg.type === 'tool_use') {
      if (msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) {
        flushGroup()
        appendChildToolCall(childToolCallsByParent, msg.parentToolUseId, msg)
        continue
      }
      if (msg.toolName === 'AskUserQuestion') {
        flushGroup()
        items.push({ kind: 'message', message: msg })
      } else {
        pendingToolCalls.push(msg)
      }
    } else {
      flushGroup()
      items.push({ kind: 'message', message: msg })
    }
  }

  flushGroup()
  return { renderItems: coalesceWebSearchGroups(items), toolResultMap, childToolCallsByParent }
}

function isWebSearchGroup(item: RenderItem): item is Extract<RenderItem, { kind: 'tool_group' }> {
  return item.kind === 'tool_group' &&
    item.toolCalls.length > 0 &&
    item.toolCalls.every((toolCall) => toolCall.toolName === 'WebSearch')
}

function canBridgeWebSearchGroup(item: RenderItem): boolean {
  return item.kind === 'message' && item.message.type === 'thinking'
}

function coalesceWebSearchGroups(items: RenderItem[]): RenderItem[] {
  const merged: RenderItem[] = []
  let activeWebSearchGroupIndex = -1
  let bridgedThinkingItems: RenderItem[] = []

  for (const item of items) {
    if (isWebSearchGroup(item)) {
      if (activeWebSearchGroupIndex >= 0) {
        const active = merged[activeWebSearchGroupIndex]
        if (active?.kind === 'tool_group') {
          active.toolCalls.push(...item.toolCalls)
        }
      } else {
        merged.push({
          ...item,
          toolCalls: [...item.toolCalls],
        })
        activeWebSearchGroupIndex = merged.length - 1
      }
      bridgedThinkingItems = []
      continue
    }

    if (activeWebSearchGroupIndex >= 0 && canBridgeWebSearchGroup(item)) {
      bridgedThinkingItems.push(item)
      continue
    }

    if (bridgedThinkingItems.length > 0) {
      if (!(item.kind === 'message' && item.message.type === 'assistant_text')) {
        merged.push(...bridgedThinkingItems)
      }
      bridgedThinkingItems = []
    }

    merged.push(item)

    if (!canBridgeWebSearchGroup(item)) {
      activeWebSearchGroupIndex = -1
    }
  }

  return merged
}

function isStageResult(items: RenderItem[], index: number): boolean {
  const current = items[index]
  if (current?.kind !== 'message' || current.message.type !== 'assistant_text') {
    return false
  }

  for (let nextIndex = index + 1; nextIndex < items.length; nextIndex += 1) {
    const next = items[nextIndex]
    if (!next) continue
    if (next.kind === 'tool_group') return true
    if (next.message.type === 'thinking' || next.message.type === 'system') continue
    return next.message.type === 'tool_use'
  }

  return false
}

type MessageListProps = {
  sessionId?: string | null
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48
const JUMP_TO_BOTTOM_THRESHOLD_PX = 160
const EMPTY_SCROLL_METRICS = {
  scrollable: false,
  awayFromBottom: false,
  topPercent: 0,
  viewportPercent: 100,
}

const PLAN_CONFIRMATION_RECENT_MS = 5 * 60 * 1000

function isNearScrollBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  )
}

function getLatestAssistantPlanCandidate(messages: UIMessage[]): Extract<UIMessage, { type: 'assistant_text' }> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message) continue
    if (message.type === 'thinking' || message.type === 'system') continue
    return message.type === 'assistant_text' ? message : null
  }
  return null
}

function isRecentLiveMessage(message: UIMessage): boolean {
  return Date.now() - message.timestamp <= PLAN_CONFIRMATION_RECENT_MS
}

function looksLikePlanConfirmation(content: string): boolean {
  const text = content.replace(/\s+/g, ' ').trim()
  if (!text) return false

  const hasPlanShape =
    /(计划|规划|方案|范围|实施|步骤|plan|scope|approach|implementation)/i.test(text) ||
    /(Stated|Inferred|Out of scope)\s*[:：]/i.test(text)
  const asksForConfirmation =
    /(是否|是不是|能否|确认|继续|实施|调整|修改|补充|删除).{0,24}(符合|可行|继续|实施|调整|修改|补充|意图|计划|方案)/u.test(text) ||
    /(does this|is this|confirm|continue|implement|revise|adjust|update).{0,48}(plan|approach|scope|work|implementation|right|okay|ok)/i.test(text)

  return hasPlanShape && asksForConfirmation
}

function getPlanConfirmationKey(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`
}

export function MessageList({ sessionId }: MessageListProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const openTab = useTabStore((s) => s.openTab)
  const resolvedSessionId = sessionId ?? activeTabId
  const sessionState = useChatStore((s) =>
    resolvedSessionId ? s.sessions[resolvedSessionId] : undefined,
  )
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const reloadHistory = useChatStore((s) => s.reloadHistory)
  const forgetLocalUserEcho = useChatStore((s) => s.forgetLocalUserEcho)
  const rewindLocalMessages = useChatStore((s) => s.rewindLocalMessages)
  const restartSessionRuntime = useChatStore((s) => s.restartSessionRuntime)
  const queueComposerPrefill = useChatStore((s) => s.queueComposerPrefill)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const forkSession = useSessionStore((s) => s.forkSession)
  const sessionListItem = useSessionStore((s) =>
    resolvedSessionId ? s.sessions.find((session) => session.id === resolvedSessionId) : undefined,
  )
  const sessionWorkDir = sessionListItem?.workDir ?? null
  const sessionMessageCount = sessionListItem?.messageCount ?? 0
  const sessionModifiedAt = sessionListItem?.modifiedAt ?? ''
  const isMemberSession = useTeamStore((s) =>
    resolvedSessionId ? Boolean(s.getMemberBySessionId(resolvedSessionId)) : false,
  )
  const addToast = useUIStore((s) => s.addToast)
  const messages = sessionState?.messages ?? []
  const chatState = sessionState?.chatState ?? 'idle'
  const streamingText = sessionState?.streamingText ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const statusVerb = sessionState?.statusVerb ?? ''
  const statusElapsedSeconds = sessionState?.statusElapsedSeconds ?? elapsedSeconds
  const activeToolName = sessionState?.activeToolName ?? null
  const activeToolUseId = sessionState?.activeToolUseId ?? null
  const pendingPermission = sessionState?.pendingPermission ?? null
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null
  const historyLoading = sessionState?.historyLoading ?? false
  const historyLoadError = sessionState?.historyLoadError ?? null
  const activeThinkingId = sessionState?.activeThinkingId ?? null
  const currentTurnOrigin = sessionState?.currentTurnOrigin ?? null
  const isWaitingForFirstResponseToken =
    chatState === 'streaming' && streamingText.trim().length === 0
  const agentTaskNotifications = sessionState?.agentTaskNotifications ?? {}
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const lastSessionIdRef = useRef<string | null | undefined>(resolvedSessionId)
  const historyAutoloadKeyRef = useRef<string | null>(null)
  const t = useTranslation()
  const [rewindTarget, setRewindTarget] = useState<RewindTarget | null>(null)
  const [rewindPreview, setRewindPreview] = useState<SessionRewindResponse | null>(null)
  const [rewindError, setRewindError] = useState<string | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isExecutingRewind, setIsExecutingRewind] = useState(false)
  const [forkTarget, setForkTarget] = useState<{
    messageId: string
    userMessageIndex: number
    content: string
  } | null>(null)
  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([])
  const [forkError, setForkError] = useState<string | null>(null)
  const [isLoadingCheckpoints, setIsLoadingCheckpoints] = useState(false)
  const [isExecutingFork, setIsExecutingFork] = useState(false)
  const [planConfirmationTarget, setPlanConfirmationTarget] = useState<PlanConfirmationTarget | null>(null)
  const [planUpdateText, setPlanUpdateText] = useState('')
  const dismissedPlanConfirmationIdsRef = useRef<Set<string>>(new Set())
  const [scrollMetrics, setScrollMetrics] = useState(EMPTY_SCROLL_METRICS)

  const stopActiveTurn = useCallback(() => {
    if (!resolvedSessionId || isMemberSession) return
    stopGeneration(resolvedSessionId)
  }, [isMemberSession, resolvedSessionId, stopGeneration])

  const continueFromCurrentRecoveryPoint = useCallback(() => {
    if (!resolvedSessionId || isMemberSession) return
    const prompt = t('chat.activity.continueFromHere')
    const sendWhenIdle = (attempt = 0) => {
      const state = useChatStore.getState().sessions[resolvedSessionId]?.chatState
      if (state === 'idle') {
        sendMessage(resolvedSessionId, prompt)
        return
      }
      // Wait for backend stop acknowledgement before injecting the recovery prompt.
      if (attempt < 40) window.setTimeout(() => sendWhenIdle(attempt + 1), 250)
    }
    stopGeneration(resolvedSessionId)
    window.setTimeout(() => sendWhenIdle(), 250)
  }, [isMemberSession, resolvedSessionId, sendMessage, stopGeneration, t])

  const updateAutoScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    shouldAutoScrollRef.current = isNearScrollBottom(container)
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    const scrollHeight = Math.max(container.scrollHeight, 1)
    const next = {
      scrollable: container.scrollHeight - container.clientHeight > 1,
      awayFromBottom: distanceToBottom > JUMP_TO_BOTTOM_THRESHOLD_PX,
      topPercent: Math.round((container.scrollTop / scrollHeight) * 100),
      viewportPercent: Math.round((container.clientHeight / scrollHeight) * 100),
    }
    setScrollMetrics((current) => (
      current.scrollable === next.scrollable &&
      current.awayFromBottom === next.awayFromBottom &&
      current.topPercent === next.topPercent &&
      current.viewportPercent === next.viewportPercent
        ? current
        : next
    ))
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    shouldAutoScrollRef.current = true
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (lastSessionIdRef.current !== resolvedSessionId) {
      shouldAutoScrollRef.current = true
      lastSessionIdRef.current = resolvedSessionId
      setScrollMetrics(EMPTY_SCROLL_METRICS)
    }

    if (!shouldAutoScrollRef.current) return

    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages.length, resolvedSessionId, streamingText])

  useEffect(() => {
    if (!resolvedSessionId || !rewindTarget) return

    let cancelled = false
    setIsLoadingPreview(true)
    setRewindPreview(null)
    setRewindError(null)

    void sessionsApi
      .rewind(resolvedSessionId, {
        targetUserMessageId: rewindTarget.messageId,
        userMessageIndex: rewindTarget.userMessageIndex,
        expectedContent: rewindTarget.content,
        dryRun: true,
      })
      .then((preview) => {
        if (!cancelled) {
          setRewindPreview(preview)
        }
      })
      .catch((error) => {
        if (cancelled) return
        const message = getApiErrorMessage(error)
        if (isSessionTranscriptMissingError(error, message)) {
          const localPreview = createLocalRewindPreview(
            messages,
            rewindTarget,
            t('chat.rewindLocalOnlyReason'),
          )
          if (localPreview) {
            setRewindPreview(localPreview)
            return
          }
          setRewindError(t('chat.rewindSessionMissing'))
          return
        }
        setRewindError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPreview(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [messages, resolvedSessionId, rewindTarget, t])

  useEffect(() => {
    if (!resolvedSessionId || !forkTarget) return

    let cancelled = false
    setIsLoadingCheckpoints(true)
    setCheckpoints([])
    setForkError(null)

    void sessionsApi
      .getCheckpoints(resolvedSessionId)
      .then((result) => {
        if (!cancelled) {
          setCheckpoints(result.checkpoints)
        }
      })
      .catch((error) => {
        if (cancelled) return
        const message =
          error instanceof ApiError
            ? typeof error.body === 'object' && error.body && 'message' in error.body
              ? String((error.body as { message: unknown }).message)
              : error.message
            : error instanceof Error
              ? error.message
              : String(error)
        setForkError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCheckpoints(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [resolvedSessionId, forkTarget])

  const { toolResultMap, childToolCallsByParent, renderItems } = useMemo(
    () => buildRenderModel(messages),
    [messages],
  )
  const shouldRenderPendingPermissionFallback =
    Boolean(pendingPermission) &&
    pendingPermission?.toolName !== 'AskUserQuestion' &&
    !messages.some((message) =>
      message.type === 'permission_request' &&
      message.requestId === pendingPermission?.requestId
    )
  const hasActiveThinkingBlock = activeThinkingId
    ? messages.some((message) => message.type === 'thinking' && message.id === activeThinkingId)
    : false
  const suppressTickActivityPanel =
    currentTurnOrigin === 'proactive_tick' &&
    !pendingPermission &&
    !pendingComputerUsePermission
  const shouldShowActivityPanel =
    !suppressTickActivityPanel &&
    (chatState !== 'idle' || Boolean(streamingText))
  const shouldShowHistoryUnavailableFallback =
    sessionMessageCount > 0 &&
    renderItems.length === 0 &&
    !streamingText &&
    !historyLoading &&
    !historyLoadError

  useEffect(() => {
    if (!resolvedSessionId || sessionMessageCount <= 0) return
    if (messages.length > 0 || historyLoading || historyLoadError) return
    const autoloadKey = `${resolvedSessionId}:${sessionMessageCount}:${sessionModifiedAt}`
    if (historyAutoloadKeyRef.current === autoloadKey) return
    historyAutoloadKeyRef.current = autoloadKey

    void reloadHistory(resolvedSessionId)
  }, [
    historyLoadError,
    historyLoading,
    messages.length,
    reloadHistory,
    resolvedSessionId,
    sessionModifiedAt,
    sessionMessageCount,
  ])

  useEffect(() => {
    if (!resolvedSessionId) {
      setPlanConfirmationTarget(null)
      return
    }

    if (isMemberSession || chatState !== 'idle') {
      if (planConfirmationTarget?.sessionId === resolvedSessionId) {
        setPlanConfirmationTarget(null)
        setPlanUpdateText('')
      }
      return
    }

    const candidate = getLatestAssistantPlanCandidate(messages)
    if (
      !candidate ||
      dismissedPlanConfirmationIdsRef.current.has(getPlanConfirmationKey(resolvedSessionId, candidate.id)) ||
      !isRecentLiveMessage(candidate) ||
      !looksLikePlanConfirmation(candidate.content)
    ) {
      if (planConfirmationTarget?.sessionId === resolvedSessionId) {
        setPlanConfirmationTarget(null)
        setPlanUpdateText('')
      }
      return
    }

    if (
      planConfirmationTarget?.sessionId === resolvedSessionId &&
      planConfirmationTarget.message.id === candidate.id
    ) {
      return
    }

    setPlanUpdateText('')
    setPlanConfirmationTarget({ sessionId: resolvedSessionId, message: candidate })
  }, [chatState, isMemberSession, messages, planConfirmationTarget, resolvedSessionId])

  const closeRewindModal = useCallback(() => {
    if (isExecutingRewind) return
    setRewindTarget(null)
    setRewindPreview(null)
    setRewindError(null)
    setIsLoadingPreview(false)
  }, [isExecutingRewind])

  const closeForkModal = useCallback(() => {
    if (isExecutingFork) return
    setForkTarget(null)
    setCheckpoints([])
    setForkError(null)
    setIsLoadingCheckpoints(false)
  }, [isExecutingFork])

  const closePlanConfirmation = useCallback(() => {
    if (planConfirmationTarget) {
      dismissedPlanConfirmationIdsRef.current.add(
        getPlanConfirmationKey(planConfirmationTarget.sessionId, planConfirmationTarget.message.id),
      )
    }
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
  }, [planConfirmationTarget])

  const handleImplementPlan = useCallback(() => {
    if (!resolvedSessionId || !planConfirmationTarget) return
    if (planConfirmationTarget.sessionId !== resolvedSessionId) return
    dismissedPlanConfirmationIdsRef.current.add(
      getPlanConfirmationKey(planConfirmationTarget.sessionId, planConfirmationTarget.message.id),
    )
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
    sendMessage(planConfirmationTarget.sessionId, t('chat.planConfirm.implementPrompt'))
  }, [planConfirmationTarget, resolvedSessionId, sendMessage, t])

  const handleUpdatePlan = useCallback(() => {
    if (!resolvedSessionId || !planConfirmationTarget) return
    if (planConfirmationTarget.sessionId !== resolvedSessionId) return
    const notes = planUpdateText.trim()
    if (!notes) return

    dismissedPlanConfirmationIdsRef.current.add(
      getPlanConfirmationKey(planConfirmationTarget.sessionId, planConfirmationTarget.message.id),
    )
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
    queueComposerPrefill(planConfirmationTarget.sessionId, {
      text: t('chat.planConfirm.updatePrompt', { notes }),
    })
  }, [planConfirmationTarget, planUpdateText, queueComposerPrefill, resolvedSessionId, t])

  const handleConfirmRewind = useCallback(async () => {
    if (!resolvedSessionId || !rewindTarget || isExecutingRewind) return

    setIsExecutingRewind(true)
    setRewindError(null)

    try {
      if (chatState !== 'idle') {
        stopGeneration(resolvedSessionId)
      }

      const result = await sessionsApi.rewind(resolvedSessionId, {
        targetUserMessageId: rewindTarget.messageId,
        userMessageIndex: rewindTarget.userMessageIndex,
        expectedContent: rewindTarget.content,
      })

      const rewindStartIndex = findLocalRewindStartIndex(messages, rewindTarget)
      const removedLocalMessages = rewindStartIndex >= 0 ? messages.slice(rewindStartIndex) : []
      const removedUserMessages = removedLocalMessages.filter(
        (message): message is UserTextMessage => message.type === 'user_text',
      )
      const userMessagesToForget =
        removedUserMessages.length > 0
          ? removedUserMessages
          : [{
              id: rewindTarget.messageId,
              type: 'user_text' as const,
              content: rewindTarget.content,
              attachments: rewindTarget.attachments,
              timestamp: 0,
            }]

      for (const message of userMessagesToForget) {
        forgetLocalUserEcho(resolvedSessionId, {
          id: message.id,
          content: message.content,
          attachments: message.attachments,
        })
      }
      await reloadHistory(resolvedSessionId)
      restartSessionRuntime(resolvedSessionId)
      queueComposerPrefill(resolvedSessionId, {
        text: rewindTarget.content,
        attachments: rewindTarget.attachments,
      })

      addToast({
        type: 'success',
        message: result.code.available
          ? t('chat.rewindSuccessWithCode', {
              count: result.conversation.messagesRemoved,
            })
          : t('chat.rewindSuccessConversationOnly', {
              count: result.conversation.messagesRemoved,
            }),
      })

      setRewindTarget(null)
      setRewindPreview(null)
    } catch (error) {
      const message = getApiErrorMessage(error)
      if (isSessionTranscriptMissingError(error, message)) {
        const result = rewindLocalMessages(resolvedSessionId, {
          id: rewindTarget.messageId,
          content: rewindTarget.content,
          attachments: rewindTarget.attachments,
          userMessageIndex: rewindTarget.userMessageIndex,
        })
        if (result) {
          queueComposerPrefill(resolvedSessionId, {
            text: rewindTarget.content,
            attachments: rewindTarget.attachments,
          })
          addToast({
            type: 'success',
            message: t('chat.rewindSuccessLocalOnly', {
              count: result.messagesRemoved,
            }),
          })
          setRewindTarget(null)
          setRewindPreview(null)
          return
        }
        setRewindError(t('chat.rewindSessionMissing'))
        return
      }
      setRewindError(message)
    } finally {
      setIsExecutingRewind(false)
    }
  }, [
    addToast,
    chatState,
    forgetLocalUserEcho,
    isExecutingRewind,
    messages,
    queueComposerPrefill,
    reloadHistory,
    restartSessionRuntime,
    resolvedSessionId,
    rewindLocalMessages,
    rewindTarget,
    stopGeneration,
    t,
  ])

  const handleConfirmFork = useCallback(async () => {
    if (!resolvedSessionId || !forkTarget || isExecutingFork) return

    setIsExecutingFork(true)
    setForkError(null)

    try {
      const result = await forkSession(resolvedSessionId, {
        targetUserMessageId: forkTarget.messageId,
        userMessageIndex: forkTarget.userMessageIndex,
        expectedContent: forkTarget.content,
      })
      openTab(result.sessionId, result.title)
      addToast({
        type: 'success',
        message: t('chat.forkSuccess'),
      })
      setForkTarget(null)
      setCheckpoints([])
    } catch (error) {
      const message =
        error instanceof ApiError
          ? typeof error.body === 'object' && error.body && 'message' in error.body
            ? String((error.body as { message: unknown }).message)
            : error.message
          : error instanceof Error
            ? error.message
            : String(error)
      setForkError(message)
    } finally {
      setIsExecutingFork(false)
    }
  }, [
    addToast,
    forkSession,
    forkTarget,
    isExecutingFork,
    openTab,
    resolvedSessionId,
    t,
  ])

  let visibleUserMessageIndex = -1
  let latestMessageActionTarget: MessageActionTarget | null = null

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollContainerRef}
        onScroll={updateAutoScrollState}
        className="flex-1 overflow-y-auto px-4 py-4"
        data-testid="message-scroll-container"
        style={{ height: '100%' }}
      >
      <div className="mx-auto max-w-[860px]">
        {renderItems.map((item, itemIndex) => {
          if (item.kind === 'tool_group') {
            return (
              <ToolCallGroup
                key={item.id}
                toolCalls={item.toolCalls}
                resultMap={toolResultMap}
                childToolCallsByParent={childToolCallsByParent}
                agentTaskNotifications={agentTaskNotifications}
                isStreaming={
                  chatState === 'tool_executing' &&
                  item.toolCalls.some((tc) => !toolResultMap.has(tc.toolUseId))
                }
              />
            )
          }

          const msg = item.message
          if (msg.type === 'user_text' && !msg.pending) {
            visibleUserMessageIndex += 1
            latestMessageActionTarget = {
              message: msg,
              userMessageIndex: visibleUserMessageIndex,
            }
          }
          const userActionTarget =
            msg.type === 'user_text' && !msg.pending
              ? latestMessageActionTarget
              : null
          const assistantActionTarget =
            msg.type === 'assistant_text' && msg.origin !== 'proactive_tick'
              ? latestMessageActionTarget
              : null
          const showPlanConfirmation =
            msg.type === 'assistant_text' &&
            planConfirmationTarget?.sessionId === resolvedSessionId &&
            planConfirmationTarget.message.id === msg.id
          return (
            <div key={msg.id}>
              <MessageBlock
                sessionId={resolvedSessionId ?? undefined}
                localPathBase={sessionWorkDir}
                message={msg}
                isStageResult={isStageResult(renderItems, itemIndex)}
                activeThinkingId={activeThinkingId}
                agentTaskNotifications={agentTaskNotifications}
                toolResult={
                  msg.type === 'tool_use'
                    ? (() => {
                        const r = toolResultMap.get(msg.toolUseId)
                        return r ? { content: r.content, isError: r.isError } : null
                      })()
                    : null
                }
                actionTarget={userActionTarget ?? assistantActionTarget}
                onRequestRewind={
                  !isMemberSession
                    ? (message, userMessageIndex) => {
                        setRewindTarget({
                          messageId: message.id,
                          userMessageIndex,
                          content: message.content,
                          attachments: message.attachments,
                        })
                      }
                    : undefined
                }
                onRequestFork={
                  !isMemberSession
                    ? (message, userMessageIndex) => {
                        setForkTarget({
                          messageId: message.id,
                          userMessageIndex,
                          content: message.content,
                        })
                      }
                    : undefined
                }
              />
              {showPlanConfirmation && (
                <InlinePlanConfirmation
                  targetId={msg.id}
                  updateText={planUpdateText}
                  onUpdateText={setPlanUpdateText}
                  onDismiss={closePlanConfirmation}
                  onUpdate={handleUpdatePlan}
                  onImplement={handleImplementPlan}
                />
              )}
            </div>
          )
        })}

        {shouldShowHistoryUnavailableFallback && (
          <div className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-4 text-sm text-[var(--color-text-secondary)]">
            <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
              <span className="material-symbols-outlined text-[18px] text-[var(--color-warning)]">history</span>
              {t('chat.historyUnavailableTitle')}
            </div>
            <p className="leading-relaxed">
              {t('chat.historyUnavailableBody')}
            </p>
            {resolvedSessionId && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  void reloadHistory(resolvedSessionId)
                }}
              >
                <span className="material-symbols-outlined text-[15px]">refresh</span>
                {t('chat.historyLoadRetry')}
              </Button>
            )}
          </div>
        )}

        {renderItems.length === 0 && !streamingText && historyLoadError && (
          <div className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 px-4 py-4 text-sm text-[var(--color-text-secondary)]">
            <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--color-text-primary)]">
              <span className="material-symbols-outlined text-[18px] text-[var(--color-warning)]">history</span>
              {t('chat.historyLoadFailedTitle')}
            </div>
            <p className="leading-relaxed">
              {t('chat.historyLoadFailedBody')}
            </p>
            <p className="mt-2 break-all text-xs text-[var(--color-text-tertiary)]">
              {historyLoadError}
            </p>
            {resolvedSessionId && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  void reloadHistory(resolvedSessionId)
                }}
              >
                <span className="material-symbols-outlined text-[15px]">refresh</span>
                {t('chat.historyLoadRetry')}
              </Button>
            )}
          </div>
        )}

        {renderItems.length === 0 && !streamingText && !historyLoadError && historyLoading && (
          <div className="mt-10 text-center text-sm text-[var(--color-text-tertiary)]">
            {t('chat.historyLoading')}
          </div>
        )}

        {shouldShowActivityPanel && (
          <AgentActivityPanel
            sessionId={resolvedSessionId}
            chatState={chatState}
            elapsedSeconds={elapsedSeconds}
            statusElapsedSeconds={statusElapsedSeconds}
            statusVerb={statusVerb}
            activeToolName={activeToolName}
            activeToolUseId={activeToolUseId}
            activeThinkingId={activeThinkingId}
            streamingText={streamingText}
            messages={messages}
            resultMap={toolResultMap}
            pendingPermission={pendingPermission}
            onStopTurn={!isMemberSession ? stopActiveTurn : undefined}
            onContinueFromHere={!isMemberSession ? continueFromCurrentRecoveryPoint : undefined}
            showAwaitingThinkingHint={
              chatState === 'thinking' && (!activeThinkingId || !hasActiveThinkingBlock)
            }
            showPreResponseHint={isWaitingForFirstResponseToken}
          />
        )}

        {shouldRenderPendingPermissionFallback && pendingPermission && (
          <PermissionDialog
            requestId={pendingPermission.requestId}
            toolName={pendingPermission.toolName}
            input={pendingPermission.input}
            description={pendingPermission.description}
          />
        )}

        {streamingText && (
          <AssistantMessage
            content={streamingText}
            isStreaming={chatState === 'streaming'}
            localPathBase={sessionWorkDir}
            sessionId={resolvedSessionId ?? undefined}
          />
        )}

        <div ref={bottomRef} />
      </div>

      <Modal
        open={Boolean(rewindTarget)}
        onClose={closeRewindModal}
        title={t('chat.rewindModalTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeRewindModal}
              disabled={isExecutingRewind}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                void handleConfirmRewind()
              }}
              loading={isExecutingRewind}
              disabled={isLoadingPreview || Boolean(rewindError)}
              icon={
                !isExecutingRewind ? (
                  <span className="material-symbols-outlined text-[16px]">undo</span>
                ) : undefined
              }
            >
              {t('chat.rewindConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
              {t('chat.rewindPromptLabel')}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">
              {rewindTarget?.content || t('chat.rewindAttachmentOnly')}
            </div>
          </div>

          {isLoadingPreview && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              {t('chat.rewindLoading')}
            </div>
          )}

          {!isLoadingPreview && rewindPreview && (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <span className="material-symbols-outlined text-[16px] text-[var(--color-brand)]">history</span>
                  {t('chat.rewindConversationCardTitle')}
                </div>
                <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                  {t('chat.rewindConversationCardBody', {
                    count: rewindPreview.conversation.messagesRemoved,
                  })}
                </p>
              </div>

              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  <span className="material-symbols-outlined text-[16px] text-[var(--color-brand)]">code</span>
                  {t('chat.rewindCodeCardTitle')}
                </div>
                {rewindPreview.code.available ? (
                  <div className="space-y-1 text-sm text-[var(--color-text-secondary)]">
                    <div>{t('chat.rewindCodeFiles', { count: rewindPreview.code.filesChanged.length })}</div>
                    <div>{t('chat.rewindCodeInsertions', { count: rewindPreview.code.insertions })}</div>
                    <div>{t('chat.rewindCodeDeletions', { count: rewindPreview.code.deletions })}</div>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
                    {rewindPreview.code.reason || t('chat.rewindCodeUnavailable')}
                  </p>
                )}
              </div>
            </div>
          )}

          {!isLoadingPreview && rewindPreview?.code.available && rewindPreview.code.filesChanged.length > 0 && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
                {t('chat.rewindFilesLabel')}
              </div>
              <div className="flex flex-wrap gap-2">
                {rewindPreview.code.filesChanged.slice(0, 8).map((filePath) => (
                  <span
                    key={filePath}
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]"
                  >
                    {filePath}
                  </span>
                ))}
                {rewindPreview.code.filesChanged.length > 8 && (
                  <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                    {t('chat.rewindFilesMore', {
                      count: rewindPreview.code.filesChanged.length - 8,
                    })}
                  </span>
                )}
              </div>
            </div>
          )}

          {rewindError && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-error)]/30 bg-[var(--color-error-container)]/22 px-4 py-3 text-sm text-[var(--color-error)]">
              {rewindError}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(forkTarget)}
        onClose={closeForkModal}
        title={t('chat.forkModalTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeForkModal}
              disabled={isExecutingFork}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                void handleConfirmFork()
              }}
              loading={isExecutingFork}
              disabled={isLoadingCheckpoints || Boolean(forkError)}
              icon={
                !isExecutingFork ? (
                  <span className="material-symbols-outlined text-[16px]">fork_right</span>
                ) : undefined
              }
            >
              {t('chat.forkConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
              {t('chat.forkPromptLabel')}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">
              {forkTarget?.content || t('chat.forkAttachmentOnly')}
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
              <span className="material-symbols-outlined text-[16px] text-[var(--color-brand)]">fork_right</span>
              {t('chat.forkConversationCardTitle')}
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
              {t('chat.forkConversationCardBody')}
            </p>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('chat.forkTimelineTitle')}
              </div>
              {checkpoints.length > 0 && (
                <div className="text-xs text-[var(--color-text-tertiary)]">
                  {checkpoints.length}
                </div>
              )}
            </div>

            {isLoadingCheckpoints && (
              <div className="text-sm text-[var(--color-text-secondary)]">
                {t('chat.forkLoading')}
              </div>
            )}

            {!isLoadingCheckpoints && checkpoints.length === 0 && !forkError && (
              <div className="text-sm text-[var(--color-text-secondary)]">
                {t('chat.forkTimelineEmpty')}
              </div>
            )}

            {!isLoadingCheckpoints && checkpoints.length > 0 && (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {checkpoints.map((checkpoint) => {
                  const selected = checkpoint.messageId === forkTarget?.messageId
                  return (
                    <div
                      key={checkpoint.id}
                      data-selected={selected ? 'true' : 'false'}
                      className={`rounded-[var(--radius-md)] border px-3 py-2 ${
                        selected
                          ? 'border-[var(--color-brand)]/45 bg-[var(--color-brand)]/10'
                          : 'border-[var(--color-border)] bg-[var(--color-surface)]'
                      }`}
                    >
                      <div className="line-clamp-2 text-sm font-medium text-[var(--color-text-primary)]">
                        {checkpoint.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-tertiary)]">
                        <span>
                          {t('chat.forkTimelineCheckpoint', {
                            index: checkpoint.userMessageIndex + 1,
                            count: checkpoint.messagesIncluded,
                          })}
                        </span>
                        <span>{new Date(checkpoint.timestamp).toLocaleString()}</span>
                        {checkpoint.trackedFileCount > 0 && (
                          <span>
                            {t('chat.forkTimelineFiles', {
                              count: checkpoint.trackedFileCount,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {forkError && (
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-error)]/30 bg-[var(--color-error-container)]/22 px-4 py-3 text-sm text-[var(--color-error)]">
              {forkError}
            </div>
          )}
        </div>
      </Modal>

      </div>

      {scrollMetrics.scrollable && (
        <button
          type="button"
          aria-label={t('chat.conversationOverview')}
          title={t('chat.conversationOverview')}
          onClick={(event) => {
            const container = scrollContainerRef.current
            if (!container) return
            const bounds = event.currentTarget.getBoundingClientRect()
            if (bounds.height <= 0) return
            const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
            container.scrollTo({
              top: ratio * Math.max(0, container.scrollHeight - container.clientHeight),
              behavior: 'smooth',
            })
          }}
          className="absolute right-2 top-1/2 z-10 h-[min(42vh,280px)] min-h-24 w-3 -translate-y-1/2 rounded-full opacity-45 transition-opacity hover:opacity-90 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          style={{
            backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 6px, var(--color-text-tertiary) 6px 7px, transparent 7px 10px)',
          }}
        >
          <span
            aria-hidden="true"
            className="absolute left-1/2 w-2 -translate-x-1/2 rounded-full border border-[var(--color-text-secondary)] bg-[var(--color-surface)]/80"
            style={{
              top: `${Math.min(
                scrollMetrics.topPercent,
                100 - Math.max(6, scrollMetrics.viewportPercent),
              )}%`,
              height: `${Math.max(6, scrollMetrics.viewportPercent)}%`,
            }}
          />
        </button>
      )}

      {scrollMetrics.awayFromBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('chat.scrollToBottom')}
          title={t('chat.scrollToBottom')}
          className="absolute bottom-5 left-1/2 z-20 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] text-[var(--color-text-secondary)] shadow-lg transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px]">arrow_downward</span>
        </button>
      )}
    </div>
  )
}

function InlinePlanConfirmation({
  targetId,
  updateText,
  onUpdateText,
  onDismiss,
  onUpdate,
  onImplement,
}: {
  targetId: string
  updateText: string
  onUpdateText: (value: string) => void
  onDismiss: () => void
  onUpdate: () => void
  onImplement: () => void
}) {
  const t = useTranslation()
  const updateFieldId = `plan-confirmation-update-${targetId}`

  return (
    <section
      aria-label={t('chat.planConfirm.title')}
      className="mb-5 ml-0 max-w-[88%] rounded-[18px] rounded-tl-[8px] border border-[var(--color-border-focus)]/45 bg-[var(--color-surface-container-low)] px-4 py-3 shadow-sm sm:max-w-[80%] lg:max-w-[72%]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--color-brand)]">fact_check</span>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('chat.planConfirm.title')}
            </div>
            <div className="mt-0.5 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('chat.planConfirm.updateTip')}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('common.cancel')}
          onClick={onDismiss}
          className="shrink-0 px-1.5"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">close</span>
        </Button>
      </div>

      <label
        htmlFor={updateFieldId}
        className="mb-2 block text-xs font-medium text-[var(--color-text-secondary)]"
      >
        {t('chat.planConfirm.updateLabel')}
      </label>
      <textarea
        id={updateFieldId}
        value={updateText}
        onChange={(event) => onUpdateText(event.target.value)}
        placeholder={t('chat.planConfirm.updatePlaceholder')}
        className="min-h-[82px] w-full resize-y rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
      />

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onUpdate}
          disabled={!updateText.trim()}
          icon={<span aria-hidden="true" className="material-symbols-outlined text-[16px]">edit_note</span>}
        >
          {t('chat.planConfirm.updatePlan')}
        </Button>
        <Button
          size="sm"
          onClick={onImplement}
          icon={<span aria-hidden="true" className="material-symbols-outlined text-[16px]">play_arrow</span>}
        >
          {t('chat.planConfirm.implementPlan')}
        </Button>
      </div>
    </section>
  )
}

function CompactStatusDivider({
  message,
}: {
  message: Extract<UIMessage, { type: 'system' }>
}) {
  const isPending = message.variant === 'compact_pending'
  return (
    <div
      className="my-5 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]"
      role="status"
      aria-label={message.content}
    >
      <div className="h-px flex-1 bg-[var(--color-border-separator)]" />
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1">
        <span className={`material-symbols-outlined text-[14px] ${isPending ? 'animate-spin' : ''}`}>
          {isPending ? 'autorenew' : 'check_circle'}
        </span>
        <span className="truncate">{message.content}</span>
      </div>
      <div className="h-px flex-1 bg-[var(--color-border-separator)]" />
    </div>
  )
}

export const MessageBlock = memo(function MessageBlock({
  sessionId,
  localPathBase,
  message,
  isStageResult = false,
  activeThinkingId,
  agentTaskNotifications,
  toolResult,
  actionTarget,
  onRequestRewind,
  onRequestFork,
}: {
  sessionId?: string
  localPathBase?: string | null
  message: UIMessage
  isStageResult?: boolean
  activeThinkingId: string | null
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  actionTarget?: MessageActionTarget | null
  onRequestRewind?: (
    message: Extract<UIMessage, { type: 'user_text' }>,
    userMessageIndex: number,
  ) => void
  onRequestFork?: (
    message: Extract<UIMessage, { type: 'user_text' }>,
    userMessageIndex: number,
  ) => void
}) {
  const t = useTranslation()
  const openWorkbench = useWorkbenchStore((s) => s.openWorkbench)

  switch (message.type) {
    case 'user_text':
      return (
        <UserMessage
          content={message.content}
          attachments={message.attachments}
          attachmentParser={message.attachmentParser}
          onOpenAttachment={
            sessionId && message.attachments?.length
              ? (index) => openWorkbench(sessionId, {
                  activeTab: 'preview',
                  selectedAttachmentId: `${message.id}:attachment-${index}`,
                  selectedToolUseId: null,
                  selectedFilePath: null,
                })
              : undefined
          }
          onRewind={
            actionTarget && onRequestRewind
              ? () => onRequestRewind(actionTarget.message, actionTarget.userMessageIndex)
              : undefined
          }
          rewindLabel={t('chat.rewindAction')}
          onFork={undefined}
        />
      )
    case 'assistant_text':
      return (
        <AssistantMessage
          content={
            isUnsupportedAttachmentInputError(message.content)
              ? t('chat.unsupportedAttachmentInput')
              : message.content
          }
          isStageResult={isStageResult}
          localPathBase={localPathBase}
          sessionId={sessionId}
          onRewind={undefined}
          onFork={
            actionTarget && onRequestFork
              ? () => onRequestFork(actionTarget.message, actionTarget.userMessageIndex)
              : undefined
          }
          forkLabel={t('chat.forkAction')}
        />
      )
    case 'thinking':
      return <ThinkingBlock content={message.content} isActive={message.id === activeThinkingId} />
    case 'tool_use':
      if (message.toolName === 'AskUserQuestion') {
        return (
          <AskUserQuestion
            toolUseId={message.toolUseId}
            input={message.input}
            result={toolResult?.content}
          />
        )
      }
      return (
        <ToolCallBlock
          toolUseId={message.toolUseId}
          toolName={message.toolName}
          input={message.input}
          result={toolResult}
          agentTaskNotification={
            message.toolName === 'Agent'
              ? agentTaskNotifications[message.toolUseId]
              : undefined
          }
        />
      )
    case 'tool_result':
      return (
        <ToolResultBlock
          content={message.content}
          isError={message.isError}
          standalone
        />
      )
    case 'permission_request':
      return (
        <PermissionDialog
          requestId={message.requestId}
          toolName={message.toolName}
          input={message.input}
          description={message.description}
        />
      )
    case 'error': {
      if (isUnsupportedAttachmentInputError(message.message)) {
        return (
          <AssistantMessage
            content={t('chat.unsupportedAttachmentInput')}
            localPathBase={localPathBase}
            sessionId={sessionId}
          />
        )
      }
      if (isGuguQuotaError(message)) {
        return <GuguQuotaCard code={message.code} message={message.message} />
      }
      const errorKey = message.code ? `error.${message.code}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage = (errorText && errorText !== errorKey) ? errorText : message.message
      return <FriendlyErrorCard message={message} displayMessage={displayMessage} />
    }
    case 'task_summary':
      return <InlineTaskSummary tasks={message.tasks} />
    case 'system':
      if (message.variant === 'stage_result') {
        return (
          <AssistantMessage
            content={message.content}
            isStageResult
            localPathBase={localPathBase}
            sessionId={sessionId}
          />
        )
      }
      if (message.variant === 'compact_pending' || message.variant === 'compact_complete') {
        return <CompactStatusDivider message={message} />
      }
      return (
        <div className="mb-3 whitespace-pre-wrap text-center text-xs leading-5 text-[var(--color-text-tertiary)]">
          {message.content}
        </div>
      )
  }
})

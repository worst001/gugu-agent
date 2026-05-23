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
import { StreamingIndicator } from './StreamingIndicator'
import { InlineTaskSummary } from './InlineTaskSummary'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { isHiddenToolErrorContent } from './toolResultDisplay'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'

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
    message.message.includes('[GUGU_QUOTA_EXHAUSTED]') ||
    message.message.includes('quota_exceeded')
}

function GuguQuotaCard({ message }: { message: string }) {
  const t = useTranslation()
  const openBilling = () => {
    useUIStore.getState().setPendingSettingsTab('billing')
    useUIStore.getState().setActiveView('settings')
  }
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3 text-sm text-[var(--color-text-primary)]">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <span className="material-symbols-outlined text-[18px] text-[var(--color-warning)]">workspace_premium</span>
        {t('chat.guguQuota.title')}
      </div>
      <p className="text-[var(--color-text-secondary)]">
        {message.replace('[GUGU_QUOTA_EXHAUSTED]', '').trim() || t('chat.guguQuota.message')}
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
    if (msg.type === 'tool_result' && msg.isError && isHiddenToolErrorContent(msg.content)) {
      hiddenToolUseIds.add(msg.toolUseId)
    }
  }

  for (const msg of messages) {
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

type MessageListProps = {
  sessionId?: string | null
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48
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
  const queueComposerPrefill = useChatStore((s) => s.queueComposerPrefill)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const forkSession = useSessionStore((s) => s.forkSession)
  const isMemberSession = useTeamStore((s) =>
    resolvedSessionId ? Boolean(s.getMemberBySessionId(resolvedSessionId)) : false,
  )
  const addToast = useUIStore((s) => s.addToast)
  const messages = sessionState?.messages ?? []
  const chatState = sessionState?.chatState ?? 'idle'
  const streamingText = sessionState?.streamingText ?? ''
  const historyLoading = sessionState?.historyLoading ?? false
  const historyLoadError = sessionState?.historyLoadError ?? null
  const activeThinkingId = sessionState?.activeThinkingId ?? null
  const isWaitingForFirstResponseToken =
    chatState === 'streaming' && streamingText.trim().length === 0
  const agentTaskNotifications = sessionState?.agentTaskNotifications ?? {}
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const lastSessionIdRef = useRef<string | null | undefined>(resolvedSessionId)
  const t = useTranslation()
  const [rewindTarget, setRewindTarget] = useState<{
    messageId: string
    userMessageIndex: number
    content: string
    attachments?: Extract<UIMessage, { type: 'user_text' }>['attachments']
  } | null>(null)
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
  const [planConfirmationTarget, setPlanConfirmationTarget] = useState<Extract<UIMessage, { type: 'assistant_text' }> | null>(null)
  const [planUpdateText, setPlanUpdateText] = useState('')
  const dismissedPlanConfirmationIdsRef = useRef<Set<string>>(new Set())

  const updateAutoScrollState = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    shouldAutoScrollRef.current = isNearScrollBottom(container)
  }, [])

  useEffect(() => {
    if (lastSessionIdRef.current !== resolvedSessionId) {
      shouldAutoScrollRef.current = true
      lastSessionIdRef.current = resolvedSessionId
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
        const message =
          error instanceof ApiError
            ? typeof error.body === 'object' && error.body && 'message' in error.body
              ? String((error.body as { message: unknown }).message)
              : error.message
            : error instanceof Error
              ? error.message
              : String(error)
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
  }, [resolvedSessionId, rewindTarget])

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

  useEffect(() => {
    if (!resolvedSessionId || isMemberSession || chatState !== 'idle') return
    const candidate = getLatestAssistantPlanCandidate(messages)
    if (!candidate) return
    if (dismissedPlanConfirmationIdsRef.current.has(candidate.id)) return
    if (!isRecentLiveMessage(candidate)) return
    if (!looksLikePlanConfirmation(candidate.content)) return

    setPlanUpdateText('')
    setPlanConfirmationTarget(candidate)
  }, [chatState, isMemberSession, messages, resolvedSessionId])

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

  const closePlanConfirmationModal = useCallback(() => {
    if (planConfirmationTarget) {
      dismissedPlanConfirmationIdsRef.current.add(planConfirmationTarget.id)
    }
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
  }, [planConfirmationTarget])

  const handleImplementPlan = useCallback(() => {
    if (!resolvedSessionId || !planConfirmationTarget) return
    dismissedPlanConfirmationIdsRef.current.add(planConfirmationTarget.id)
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
    sendMessage(resolvedSessionId, t('chat.planConfirm.implementPrompt'))
  }, [planConfirmationTarget, resolvedSessionId, sendMessage, t])

  const handleUpdatePlan = useCallback(() => {
    if (!resolvedSessionId || !planConfirmationTarget) return
    const notes = planUpdateText.trim()
    if (!notes) return

    dismissedPlanConfirmationIdsRef.current.add(planConfirmationTarget.id)
    setPlanConfirmationTarget(null)
    setPlanUpdateText('')
    queueComposerPrefill(resolvedSessionId, {
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

      forgetLocalUserEcho(resolvedSessionId, {
        id: rewindTarget.messageId,
        content: rewindTarget.content,
        attachments: rewindTarget.attachments,
      })
      await reloadHistory(resolvedSessionId)
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
      const message =
        error instanceof ApiError
          ? typeof error.body === 'object' && error.body && 'message' in error.body
            ? String((error.body as { message: unknown }).message)
            : error.message
          : error instanceof Error
            ? error.message
            : String(error)
      setRewindError(message)
    } finally {
      setIsExecutingRewind(false)
    }
  }, [
    addToast,
    chatState,
    forgetLocalUserEcho,
    isExecutingRewind,
    queueComposerPrefill,
    reloadHistory,
    resolvedSessionId,
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

  return (
    <div
      ref={scrollContainerRef}
      onScroll={updateAutoScrollState}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="mx-auto max-w-[860px]">
        {renderItems.map((item) => {
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
          const rewindableUserIndex =
            msg.type === 'user_text' && !msg.pending
              ? ++visibleUserMessageIndex
              : null
          return (
            <MessageBlock
              key={msg.id}
              sessionId={resolvedSessionId ?? undefined}
              message={msg}
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
              rewindableUserIndex={rewindableUserIndex}
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
          )
        })}

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

        {streamingText && (
          <AssistantMessage content={streamingText} isStreaming={chatState === 'streaming'} />
        )}

        {/* Show StreamingIndicator when:
            - tool_executing: tool is running
            - thinking but no active ThinkingBlock yet: the gap between
              sending a message and receiving the first thinking delta
            - streaming has started but the first visible answer token has not
              arrived yet, so the UI does not appear to go blank */}
        {(chatState === 'tool_executing' ||
          (chatState === 'thinking' && !activeThinkingId) ||
          isWaitingForFirstResponseToken) && (
          <StreamingIndicator
            sessionId={resolvedSessionId}
            showAwaitingThinkingHint={chatState === 'thinking' && !activeThinkingId}
            showPreResponseHint={isWaitingForFirstResponseToken}
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

      <Modal
        open={Boolean(planConfirmationTarget)}
        onClose={closePlanConfirmationModal}
        title={t('chat.planConfirm.title')}
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={closePlanConfirmationModal}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleUpdatePlan}
              disabled={!planUpdateText.trim()}
              icon={<span aria-hidden="true" className="material-symbols-outlined text-[16px]">edit_note</span>}
            >
              {t('chat.planConfirm.updatePlan')}
            </Button>
            <Button
              onClick={handleImplementPlan}
              icon={<span aria-hidden="true" className="material-symbols-outlined text-[16px]">play_arrow</span>}
            >
              {t('chat.planConfirm.implementPlan')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="max-h-[42vh] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-4 py-3">
            <MarkdownRenderer
              content={planConfirmationTarget?.content ?? ''}
              variant="document"
              className="text-[13px] leading-6 text-[var(--color-text-secondary)] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-[13px] [&_p]:leading-6"
            />
          </div>

          <div>
            <label
              htmlFor="plan-confirmation-update"
              className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]"
            >
              {t('chat.planConfirm.updateLabel')}
            </label>
            <textarea
              id="plan-confirmation-update"
              value={planUpdateText}
              onChange={(event) => setPlanUpdateText(event.target.value)}
              placeholder={t('chat.planConfirm.updatePlaceholder')}
              className="min-h-[96px] w-full resize-y rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
            />
            <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t('chat.planConfirm.updateTip')}
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export const MessageBlock = memo(function MessageBlock({
  sessionId,
  message,
  activeThinkingId,
  agentTaskNotifications,
  toolResult,
  rewindableUserIndex,
  onRequestRewind,
  onRequestFork,
}: {
  sessionId?: string
  message: UIMessage
  activeThinkingId: string | null
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  rewindableUserIndex?: number | null
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
            typeof rewindableUserIndex === 'number' && onRequestRewind
              ? () => onRequestRewind(message, rewindableUserIndex)
              : undefined
          }
          onFork={
            typeof rewindableUserIndex === 'number' && onRequestFork
              ? () => onRequestFork(message, rewindableUserIndex)
              : undefined
          }
          rewindLabel={t('chat.rewindAction')}
          forkLabel={t('chat.forkAction')}
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
        return <AssistantMessage content={t('chat.unsupportedAttachmentInput')} />
      }
      if (isGuguQuotaError(message)) {
        return <GuguQuotaCard message={message.message} />
      }
      const errorKey = message.code ? `error.${message.code}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage = (errorText && errorText !== errorKey) ? errorText : message.message
      const showRawDetail =
        Boolean(message.message) &&
        message.message.trim() !== '' &&
        message.message !== displayMessage
      return (
        <div className="mb-3 px-4 py-2.5 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/28 text-sm text-[var(--color-error)]">
          <strong>Error:</strong> {displayMessage}
          {showRawDetail && (
            <div className="mt-1 whitespace-pre-wrap text-xs text-[var(--color-on-error-container)]/85">
              {message.message}
            </div>
          )}
        </div>
      )
    }
    case 'task_summary':
      return <InlineTaskSummary tasks={message.tasks} />
    case 'system':
      return (
        <div className="mb-3 text-center text-xs text-[var(--color-text-tertiary)]">
          {message.content}
        </div>
      )
  }
})

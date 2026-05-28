import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionsApi, type SessionContextSnapshot } from '../../api/sessions'
import { useTranslation } from '../../i18n'
import type { ChatState } from '../../types/chat'

const CONTEXT_REFRESH_MS = 45_000
const AUTO_COMPACT_PERCENT = 99
const AUTO_COMPACT_RESET_PERCENT = 95

type Props = {
  sessionId?: string
  chatState: ChatState
  disabled?: boolean
  autoCompactSupported?: boolean
  onOpen: () => void
  onAutoCompact: (context: SessionContextSnapshot) => void
}

export function ContextUsageIndicator({
  sessionId,
  chatState,
  disabled = false,
  autoCompactSupported = false,
  onOpen,
  onAutoCompact,
}: Props) {
  const t = useTranslation()
  const [context, setContext] = useState<SessionContextSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const autoCompactKeyRef = useRef<string | null>(null)
  const previousChatStateRef = useRef<ChatState>(chatState)

  const refreshContext = useCallback(async (options?: { quiet?: boolean }) => {
    if (!sessionId || chatState !== 'idle') return
    const requestId = ++requestIdRef.current
    if (!options?.quiet) setLoading(true)
    setError(null)

    try {
      const inspection = await sessionsApi.getInspection(sessionId, {
        contextEstimateOnly: true,
        timeout: 12_000,
      })
      if (requestId !== requestIdRef.current) return
      const nextContext = inspection.context ?? inspection.contextEstimate ?? null
      setContext(nextContext)
      setError(inspection.errors?.context ?? null)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [chatState, sessionId])

  useEffect(() => {
    requestIdRef.current += 1
    setContext(null)
    setError(null)
    autoCompactKeyRef.current = null
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || chatState !== 'idle') return
    void refreshContext()
  }, [chatState, refreshContext, sessionId])

  useEffect(() => {
    if (!sessionId) return
    const intervalId = window.setInterval(() => {
      void refreshContext({ quiet: true })
    }, CONTEXT_REFRESH_MS)
    return () => window.clearInterval(intervalId)
  }, [refreshContext, sessionId])

  useEffect(() => {
    const previous = previousChatStateRef.current
    previousChatStateRef.current = chatState
    if (previous !== 'idle' && chatState === 'idle') {
      void refreshContext({ quiet: true })
    }
  }, [chatState, refreshContext])

  useEffect(() => {
    if (!sessionId || !context) return
    const percent = Math.max(0, Math.min(100, Math.round(context.percentage)))
    if (percent < AUTO_COMPACT_RESET_PERCENT) {
      autoCompactKeyRef.current = null
      return
    }
    if (
      percent < AUTO_COMPACT_PERCENT ||
      chatState !== 'idle' ||
      disabled ||
      !autoCompactSupported
    ) {
      return
    }

    const key = `${sessionId}:${context.totalTokens}:${context.rawMaxTokens}`
    if (autoCompactKeyRef.current === key) return
    autoCompactKeyRef.current = key
    onAutoCompact(context)
  }, [autoCompactSupported, chatState, context, disabled, onAutoCompact, sessionId])

  const percent = context
    ? Math.max(0, Math.min(100, Math.round(context.percentage)))
    : 0
  const ringColor = getRingColor(percent, Boolean(error))
  const label = context ? `${percent}%` : loading ? '...' : '--'
  const title = context
    ? t('chat.contextIndicator.title', {
        percent,
        used: formatCompactNumber(context.totalTokens),
        total: formatCompactNumber(context.rawMaxTokens),
      })
    : error
      ? t('chat.contextIndicator.unavailable')
      : t('chat.contextIndicator.loading')

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled || !sessionId}
      title={title}
      aria-label={title}
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        background: `conic-gradient(${ringColor} ${percent * 3.6}deg, color-mix(in srgb, var(--color-border) 58%, transparent) 0deg)`,
      }}
    >
      <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[var(--color-surface-container-low)]">
        {label}
      </span>
    </button>
  )
}

function getRingColor(percent: number, hasError: boolean) {
  if (hasError) return 'var(--color-error)'
  if (percent >= 90) return '#c51616'
  if (percent >= 75) return '#b25b00'
  return 'var(--color-brand)'
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

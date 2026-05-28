import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

const LONG_RUNNING_HINT_SECONDS = 30

type StreamingIndicatorProps = {
  sessionId?: string | null
  /** True while waiting for the first thinking_delta (spinner only, no ThinkingBlock yet) */
  showAwaitingThinkingHint?: boolean
  /** True after thinking ends but before the first answer token arrives. */
  showPreResponseHint?: boolean
}

export function StreamingIndicator({
  sessionId,
  showAwaitingThinkingHint = false,
  showPreResponseHint = false,
}: StreamingIndicatorProps) {
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const sessionState = useChatStore((s) => targetSessionId ? s.sessions[targetSessionId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const activeToolName = sessionState?.activeToolName ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  const showLongRunningHint =
    chatState !== 'idle' && elapsedSeconds >= LONG_RUNNING_HINT_SECONDS
  let verb: string
  if (statusVerb) {
    verb = statusVerb
  } else {
    verb =
      chatState === 'thinking'
        ? t('streaming.thinking')
        : chatState === 'tool_executing'
          ? activeToolName
            ? t('streaming.runningTool', { toolName: activeToolName })
            : t('streaming.running')
          : showPreResponseHint
            ? t('streaming.preparingResponse')
          : t('streaming.working')
  }

  return (
    <div className="mb-2 flex w-fit max-w-full flex-col gap-0.5">
      <div className="flex w-fit items-center gap-2 rounded-full border border-[var(--color-border)]/40 bg-[var(--color-surface-container-low)] px-3 py-1">
        <span className="text-[var(--color-brand)] animate-shimmer text-xs">✦</span>
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{verb}...</span>
        {elapsedSeconds > 0 && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            {formatElapsed(elapsedSeconds)}
          </span>
        )}
        {tokenUsage.output_tokens > 0 && (
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            · ↓ {tokenUsage.output_tokens}
          </span>
        )}
      </div>
      {showAwaitingThinkingHint && (
        <p className="max-w-md pl-1 text-[10px] leading-snug text-[var(--color-text-tertiary)]">
          {t('streaming.awaitingThinkingHint')}
        </p>
      )}
      {showPreResponseHint && (
        <p className="max-w-md pl-1 text-[10px] leading-snug text-[var(--color-text-tertiary)]">
          {t('streaming.preResponseHint')}
        </p>
      )}
      {showLongRunningHint && (
        <p className="max-w-md pl-1 text-[10px] leading-snug text-[var(--color-text-tertiary)]">
          {t('streaming.longRunningHint')}
        </p>
      )}
    </div>
  )
}

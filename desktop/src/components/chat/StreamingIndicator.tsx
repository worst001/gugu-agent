import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

type StreamingIndicatorProps = {
  /** True while waiting for the first thinking_delta (spinner only, no ThinkingBlock yet) */
  showAwaitingThinkingHint?: boolean
}

export function StreamingIndicator({ showAwaitingThinkingHint = false }: StreamingIndicatorProps) {
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  let verb: string
  if (statusVerb) {
    verb = statusVerb
  } else {
    verb =
      chatState === 'thinking'
        ? t('streaming.thinking')
        : chatState === 'tool_executing'
          ? t('streaming.running')
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
    </div>
  )
}

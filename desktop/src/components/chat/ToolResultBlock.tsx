import { CodeViewer } from './CodeViewer'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import {
  extractToolResultText,
  formatToolErrorText,
  isHiddenToolErrorContent,
} from './toolResultDisplay'

type Props = {
  content: unknown
  isError: boolean
  toolName?: string
  standalone?: boolean
}

/**
 * Standalone tool result block — only shown when not already rendered
 * inline within ToolCallBlock (i.e., when the tool_use and tool_result
 * are NOT grouped together by MessageList).
 */
export function ToolResultBlock({ content, isError, toolName, standalone = true }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()

  // Don't render standalone if this result is already rendered inline
  if (!standalone) return null

  if (isError && isHiddenToolErrorContent(content)) return null

  const rawText = extractToolResultText(content)
  const displayText = isError ? formatToolErrorText(rawText) : rawText
  const detailsText = displayText
  const preview = displayText.slice(0, 200)
  const hasMore = detailsText.length > 200 || detailsText !== displayText

  return (
    <div className={`mb-2 overflow-hidden rounded-lg border ${
      isError
        ? 'border-[var(--color-error)]/25 bg-[var(--color-error-container)]/15'
        : 'border-[var(--color-outline-variant)]/20'
    }`}>
      {/* Status header */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold ${
        isError
          ? 'bg-[var(--color-error-container)]/55 text-[var(--color-error)]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-outline)]'
      }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">
            {isError ? 'error_outline' : 'check_circle'}
          </span>
          {isError
            ? t('tool.callFailed')
            : toolName
              ? t('tool.result', { toolName })
              : t('tool.resultGeneric')}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${
          isError
            ? 'bg-[var(--color-error)]/10'
            : 'bg-[var(--color-diff-added-bg)] text-[var(--color-diff-added-text)]'
        }`}>
          {isError ? t('tool.error') : t('tool.success')}
        </span>
      </button>

      {/* Inline image gallery from detected paths */}
      <InlineImageGallery text={displayText} />

      {/* Content */}
      {expanded ? (
        isError ? (
          <div className="px-3 py-2.5 text-[12px] leading-[1.55] whitespace-pre-wrap break-words text-[var(--color-error)]">
            {detailsText}
          </div>
        ) : (
          <CodeViewer
            code={detailsText}
            language="plaintext"
            maxLines={12}
          />
        )
      ) : (
        <div className={`px-3 py-2 text-[12px] leading-[1.45] ${
          isError
            ? 'text-[var(--color-text-secondary)]'
            : 'bg-[var(--color-surface-container-lowest)] font-[var(--font-mono)] text-[10px] text-[var(--color-text-tertiary)]'
        }`}>
          {preview}
          {hasMore ? '…' : ''}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="w-full py-1 text-[10px] font-medium text-[var(--color-text-accent)] hover:underline bg-[var(--color-surface-container-low)] border-t border-[var(--color-outline-variant)]/10"
        >
          {expanded ? t('tool.showLess') : t('tool.showMore', { count: Math.max(detailsText.length - 200, 0) })}
        </button>
      )}
    </div>
  )
}

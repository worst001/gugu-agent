import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'
import { useTranslation } from '../../i18n'

type Props = {
  content: string
  isStreaming?: boolean
  isStageResult?: boolean
  localPathBase?: string | null
  sessionId?: string
  onRewind?: () => void
  onFork?: () => void
  rewindLabel?: string
  forkLabel?: string
}

export function AssistantMessage({
  content,
  isStreaming,
  isStageResult = false,
  localPathBase,
  sessionId,
  onRewind,
  onFork,
  rewindLabel,
  forkLabel,
}: Props) {
  const t = useTranslation()
  const displayContent = collapseRunawayRepeatedProse(
    content,
    (count) => t('chat.repeatedOutputCollapsed', { count }),
  )
  const documentLayout = shouldUseDocumentLayout(displayContent)

  return (
    <div className="group mb-5 flex justify-start">
      <div
        data-message-shell="assistant"
        data-layout={documentLayout ? 'document' : 'bubble'}
        className={`flex min-w-0 flex-col items-start gap-2 ${
          documentLayout
            ? 'w-full max-w-full'
            : 'w-full max-w-[88%] sm:max-w-[80%] lg:max-w-[72%]'
        }`}
      >
        <div className={`rounded-[20px] rounded-tl-[8px] border border-[var(--color-border)]/60 bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-text-primary)] shadow-sm ${
          documentLayout ? 'w-full' : 'max-w-full'
        }`}>
          {isStageResult ? (
            <div className={'mb-1.5'} style={{ fontSize: 13, fontWeight: 600 }}>
              {t('chat.stageResult')}
            </div>
          ) : null}
          <MarkdownRenderer
            content={displayContent}
            variant={documentLayout ? 'document' : 'default'}
            className={isStageResult ? 'prose-p:text-[15px] prose-li:text-[15px]' : undefined}
            localPathBase={localPathBase}
            sessionId={sessionId}
          />
          {!isStreaming && <InlineImageGallery text={displayContent} />}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
          )}
        </div>

        <MessageActionBar
          copyText={isStreaming ? undefined : displayContent}
          copyLabel="Copy reply"
          onRewind={isStreaming ? undefined : onRewind}
          rewindLabel={rewindLabel}
          onFork={isStreaming ? undefined : onFork}
          forkLabel={forkLabel}
          align="start"
        />
      </div>
    </div>
  )
}

const RUNAWAY_REPEAT_PATTERN = /([^\r\n]{12,360}?[。！？.!?][ \t]*)(?:\1){2,}/gu
const FENCED_CODE_BLOCK_PATTERN = /(```[\s\S]*?(?:```|$))/g

export function collapseRunawayRepeatedProse(
  content: string,
  formatNotice: (count: number) => string,
): string {
  return content
    .split(FENCED_CODE_BLOCK_PATTERN)
    .map((part) => {
      if (part.startsWith('```')) return part
      return part.replace(RUNAWAY_REPEAT_PATTERN, (match, unit: string) => {
        const occurrences = Math.floor(match.length / unit.length)
        return `${unit.trimEnd()}\n\n_${formatNotice(occurrences - 1)}_`
      })
    })
    .join('')
}

function shouldUseDocumentLayout(content: string) {
  const normalized = content.trim()
  if (!normalized) return false

  if (/```/.test(normalized)) return true
  if (/^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.+\|)/m.test(normalized)) return true

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  return paragraphs.length >= 2 || normalized.split('\n').filter((line) => line.trim()).length >= 8
}

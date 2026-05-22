import { useTranslation } from '../../i18n'

export function ThinkingBlock({ content, isActive = false }: { content: string; isActive?: boolean }) {
  const t = useTranslation()
  const status = content.replace(/\s+/g, ' ').trim()

  return (
    <div className="mb-1">
      <style>{thinkingStyles}</style>
      <div
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12px] text-[var(--color-text-tertiary)]"
      >
        <span className="text-[10px] text-[var(--color-outline)]">•</span>
        <span className="shrink-0 font-medium italic">
          {t('thinking.label')}
          {isActive && <span className="thinking-dots" />}
        </span>
        {status && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-tertiary)]">
            {status}
            {isActive && <span className="thinking-inline-cursor" />}
          </span>
        )}
      </div>
    </div>
  )
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-inline-cursor {
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--color-text-tertiary);
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
`

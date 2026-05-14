import { useMemo } from 'react'
import { useTranslation } from '../../i18n'
import { CodeViewer } from '../chat/CodeViewer'
import { EmptyState } from './ToolActivityList'
import {
  extractTextContent,
  type FilePreview as FilePreviewItem,
  type ToolActivity,
} from './workbenchModel'

type Props = {
  preview: FilePreviewItem | null
  activity: ToolActivity | null
}

export function FilePreview({ preview, activity }: Props) {
  const t = useTranslation()

  const fallback = useMemo(() => {
    if (!activity) return null
    const resultText = activity.result ? extractTextContent(activity.result.content) : ''
    const inputText = JSON.stringify(activity.input, null, 2)
    return {
      title: activity.summary || activity.toolName,
      language: resultText ? 'plaintext' : 'json',
      content: resultText || inputText,
    }
  }, [activity])

  const item = preview ?? fallback
  if (!item || !item.content.trim()) {
    return <EmptyState icon="preview" title={t('workbench.preview.empty')} />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
          {item.title}
        </div>
      </div>
      <CodeViewer
        code={item.content}
        language={item.language}
        maxLines={80}
      />
    </div>
  )
}

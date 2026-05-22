import { useMemo } from 'react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { CodeViewer } from '../chat/CodeViewer'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import type { WorkbenchAttachmentPreview } from './workbenchModel'
import { EmptyState } from './ToolActivityList'

type Props = {
  attachment: WorkbenchAttachmentPreview | null
}

export function PreviewRenderer({ attachment }: Props) {
  const t = useTranslation()
  const decodedText = useMemo(
    () => attachment ? decodeDataText(attachment.data) : '',
    [attachment],
  )

  if (!attachment) {
    return <EmptyState icon="preview" title={t('workbench.preview.empty')} />
  }

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">
              {attachment.name}
            </div>
            <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">
              {attachment.mimeType || attachment.kind}
            </div>
          </div>
          <span className="material-symbols-outlined text-[16px] text-[var(--color-text-tertiary)]">
            {getKindIcon(attachment.kind)}
          </span>
        </div>
        {renderOriginalPreview(attachment, decodedText, t)}
      </section>

      {attachment.parsedMarkdown && (
        <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
          <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)]">
            {t('workbench.preview.parsedMarkdown')}
          </div>
          <div className="max-h-[520px] overflow-auto px-3 py-3 text-sm text-[var(--color-text-primary)]">
            <MarkdownRenderer content={attachment.parsedMarkdown} />
          </div>
        </section>
      )}

      {attachment.promptText && (
        <details className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
          <summary className="cursor-pointer border-b border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-primary)]">
            {t('workbench.preview.sentPrompt')}
          </summary>
          <CodeViewer code={attachment.promptText} language="markdown" maxLines={80} />
        </details>
      )}
    </div>
  )
}

function renderOriginalPreview(
  attachment: WorkbenchAttachmentPreview,
  decodedText: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const dataUrl = getDataUrl(attachment)

  if (attachment.kind === 'image' && dataUrl) {
    return (
      <div className="bg-black/20 p-2">
        <img
          src={dataUrl}
          alt={attachment.name}
          className="max-h-[420px] w-full rounded-md object-contain"
        />
      </div>
    )
  }

  if (attachment.kind === 'pdf' && dataUrl) {
    return (
      <iframe
        src={dataUrl}
        title={attachment.name}
        className="h-[420px] w-full bg-white"
      />
    )
  }

  if (attachment.kind === 'markdown' && decodedText.trim()) {
    return (
      <div className="max-h-[420px] overflow-auto px-3 py-3 text-sm text-[var(--color-text-primary)]">
        <MarkdownRenderer content={decodedText} />
      </div>
    )
  }

  if (attachment.kind === 'text' && decodedText.trim()) {
    return (
      <CodeViewer
        code={decodedText}
        language={inferLanguage(attachment.name, attachment.mimeType)}
        maxLines={80}
      />
    )
  }

  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-6 text-center">
      <span className="material-symbols-outlined mb-2 text-[26px] text-[var(--color-text-tertiary)]">
        {getKindIcon(attachment.kind)}
      </span>
      <div className="text-xs text-[var(--color-text-secondary)]">
        {t('workbench.preview.originalUnavailable')}
      </div>
    </div>
  )
}

function getDataUrl(attachment: WorkbenchAttachmentPreview): string {
  const data = attachment.data ?? ''
  if (!data) return ''
  if (data.startsWith('data:') || data.startsWith('blob:')) return data
  return `data:${attachment.mimeType || 'application/octet-stream'};base64,${data}`
}

function decodeDataText(data?: string): string {
  if (!data) return ''
  if (!data.startsWith('data:')) return data

  const commaIndex = data.indexOf(',')
  if (commaIndex < 0) return ''

  const meta = data.slice(0, commaIndex)
  const payload = data.slice(commaIndex + 1)

  try {
    if (meta.includes(';base64')) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return new TextDecoder('utf-8').decode(bytes)
    }
    return decodeURIComponent(payload)
  } catch {
    return ''
  }
}

function inferLanguage(name: string, mimeType?: string): string {
  const normalizedMime = mimeType?.toLowerCase() ?? ''
  if (normalizedMime.includes('json')) return 'json'
  if (normalizedMime.includes('markdown')) return 'markdown'
  if (normalizedMime.includes('html')) return 'markup'
  if (normalizedMime.includes('css')) return 'css'

  const ext = name.split('.').pop()?.toLowerCase()
  const languages: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'markup',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    ps1: 'powershell',
  }
  return languages[ext ?? ''] || 'plaintext'
}

function getKindIcon(kind: WorkbenchAttachmentPreview['kind']): string {
  switch (kind) {
    case 'image':
      return 'image'
    case 'markdown':
      return 'markdown'
    case 'pdf':
      return 'picture_as_pdf'
    case 'text':
      return 'article'
    case 'file':
    default:
      return 'attach_file'
  }
}

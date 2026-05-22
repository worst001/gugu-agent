import { useTranslation, type TranslationKey } from '../../i18n'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import type { WorkbenchAttachmentPreview } from './workbenchModel'

type Props = {
  sessionId: string
  attachments: WorkbenchAttachmentPreview[]
  selectedAttachmentId: string | null
}

export function AttachmentPreviewList({
  sessionId,
  attachments,
  selectedAttachmentId,
}: Props) {
  const t = useTranslation()
  const selectAttachment = useWorkbenchStore((state) => state.selectAttachment)

  if (attachments.length === 0) return null

  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-tertiary)]">
        {t('workbench.attachments.title')}
      </div>
      {attachments.map((attachment) => {
        const selected = selectedAttachmentId === attachment.id
        return (
          <button
            key={attachment.id}
            type="button"
            onClick={() => selectAttachment(sessionId, attachment.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              selected
                ? 'border-[var(--color-border-focus)] bg-[var(--color-surface-container-high)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                {getAttachmentIcon(attachment)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-text-primary)]">
                {attachment.name}
              </span>
              {attachment.parsedMarkdown && (
                <span className="rounded-full bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                  {t('workbench.attachments.parsed')}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--color-text-tertiary)]">
              <span>{t(`workbench.attachmentKind.${attachment.kind}` as TranslationKey)}</span>
              {attachment.parserMethod && (
                <>
                  <span>·</span>
                  <span>{t(`workbench.parserMethod.${attachment.parserMethod}` as TranslationKey)}</span>
                </>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function getAttachmentIcon(attachment: WorkbenchAttachmentPreview): string {
  switch (attachment.kind) {
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

import type { AttachmentParserPreview, UIAttachment } from '../../types/chat'
import { useTranslation } from '../../i18n'
import { AttachmentGallery } from './AttachmentGallery'
import { MessageActionBar } from './MessageActionBar'

type Props = {
  content: string
  attachments?: UIAttachment[]
  attachmentParser?: AttachmentParserPreview
  onRewind?: () => void
  onFork?: () => void
  onOpenAttachment?: (index: number) => void
  rewindLabel?: string
  forkLabel?: string
}

export function UserMessage({
  content,
  attachments,
  attachmentParser,
  onRewind,
  onFork,
  onOpenAttachment,
  rewindLabel,
  forkLabel,
}: Props) {
  const t = useTranslation()
  const hasText = content.trim().length > 0
  const hasActions = hasText || Boolean(onRewind) || Boolean(onFork)
  const attachmentCount = attachments?.length ?? 0
  const parsedCount = attachmentParser?.results.length ?? 0

  return (
    <div className="group mb-5 flex justify-end">
      <div
        data-message-shell="user"
        className="flex min-w-0 w-full max-w-[82%] flex-col items-end gap-2 sm:max-w-[78%] lg:max-w-[72%]"
      >
        {attachments && attachments.length > 0 && (
          <div className="flex max-w-full flex-col items-end gap-1.5">
            <AttachmentGallery
              attachments={attachments}
              variant="message"
              onOpenAttachment={onOpenAttachment}
            />
            <div className="flex flex-wrap items-center justify-end gap-1.5 text-[10px] leading-none text-[var(--color-text-tertiary)]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-2 py-1">
                <span className="material-symbols-outlined text-[12px]" aria-hidden="true">attach_file</span>
                {attachmentCount}
              </span>
              {parsedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-success)]/20 bg-[var(--color-success)]/10 px-2 py-1 font-semibold text-[var(--color-success)]">
                  <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check_circle</span>
                  {t('workbench.attachments.parsed')}
                </span>
              )}
            </div>
          </div>
        )}

        {hasText && (
          <div
            className="bg-[var(--color-surface-user-msg)] px-4 py-3 text-sm leading-relaxed text-[var(--color-text-primary)] whitespace-pre-wrap break-words"
            style={{ borderRadius: '18px 4px 18px 18px' }}
          >
            {content}
          </div>
        )}

        {hasActions && (
          <MessageActionBar
            copyText={hasText ? content : undefined}
            copyLabel="Copy prompt"
            onRewind={onRewind}
            rewindLabel={rewindLabel}
            onFork={onFork}
            forkLabel={forkLabel}
            align="end"
          />
        )}
      </div>
    </div>
  )
}

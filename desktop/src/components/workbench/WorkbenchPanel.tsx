import { useMemo } from 'react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useWorkbenchStore, type WorkbenchTab } from '../../stores/workbenchStore'
import type { UIMessage } from '../../types/chat'
import { AttachmentPreviewList } from './AttachmentPreviewList'
import { DiffPreview } from './DiffPreview'
import { FileChangeList } from './FileChangeList'
import { FilePreview } from './FilePreview'
import { PreviewRenderer } from './PreviewRenderer'
import { ToolActivityList } from './ToolActivityList'
import {
  buildWorkbenchModel,
  findSelectedActivity,
  findSelectedAttachmentPreview,
  findSelectedFileChange,
  findSelectedPreview,
} from './workbenchModel'

type Props = {
  sessionId: string
  messages: UIMessage[]
}

const TABS: Array<{ id: WorkbenchTab; icon: string; labelKey: TranslationKey }> = [
  { id: 'activity', icon: 'construction', labelKey: 'workbench.tab.activity' },
  { id: 'diff', icon: 'difference', labelKey: 'workbench.tab.diff' },
  { id: 'preview', icon: 'preview', labelKey: 'workbench.tab.preview' },
]

export function WorkbenchPanel({ sessionId, messages }: Props) {
  const t = useTranslation()
  const state = useWorkbenchStore((store) => store.getSessionState(sessionId))
  const openWorkbench = useWorkbenchStore((store) => store.openWorkbench)
  const closeWorkbench = useWorkbenchStore((store) => store.closeWorkbench)
  const setActiveTab = useWorkbenchStore((store) => store.setActiveTab)

  const model = useMemo(() => buildWorkbenchModel(messages), [messages])
  const selectedActivity = findSelectedActivity(model, state.selectedToolUseId)
  const selectedFileChange = findSelectedFileChange(
    model,
    state.selectedFilePath,
    state.selectedToolUseId,
  )
  const selectedPreview = findSelectedPreview(
    model,
    state.selectedToolUseId,
    state.selectedFilePath,
  )
  const selectedAttachment = state.selectedAttachmentId
    ? findSelectedAttachmentPreview(model, state.selectedAttachmentId)
    : state.activeTab === 'preview' && !state.selectedToolUseId && !state.selectedFilePath
      ? findSelectedAttachmentPreview(model, null)
      : null
  const activityCount = model.activities.length
  const fileCount = model.fileChanges.length
  const attachmentCount = model.attachmentPreviews.length

  if (!state.isOpen) {
    return (
      <aside className="hidden w-11 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface-container-low)] xl:flex xl:flex-col xl:items-center xl:pt-4">
        <button
          type="button"
          onClick={() => openWorkbench(sessionId)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          aria-label={t('workbench.open')}
          title={t('workbench.open')}
        >
          <span className="material-symbols-outlined text-[18px]">view_sidebar</span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="hidden w-[390px] max-w-[40vw] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:flex xl:min-w-[340px] xl:flex-col"
      aria-label={t('workbench.title')}
    >
      <div className="flex h-12 items-center justify-between border-b border-[var(--color-border)] px-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {t('workbench.title')}
          </div>
          <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">
            {t('workbench.subtitle', {
              activity: activityCount,
              files: fileCount,
              attachments: attachmentCount,
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => closeWorkbench(sessionId)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
          aria-label={t('workbench.close')}
          title={t('workbench.close')}
        >
          <span className="material-symbols-outlined text-[17px]">right_panel_close</span>
        </button>
      </div>

      <div
        role="tablist"
        aria-label={t('workbench.tabs')}
        className="grid grid-cols-3 gap-1 border-b border-[var(--color-border)] px-2 py-2"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={state.activeTab === tab.id}
            onClick={() => setActiveTab(sessionId, tab.id)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
              state.activeTab === tab.id
                ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="truncate">{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.activeTab === 'activity' && (
          <ToolActivityList
            sessionId={sessionId}
            activities={model.activities}
            fileChanges={model.fileChanges}
            selectedToolUseId={selectedActivity?.toolUseId ?? null}
          />
        )}

        {state.activeTab === 'diff' && (
          <div className="space-y-3">
            <FileChangeList
              sessionId={sessionId}
              fileChanges={model.fileChanges}
              selectedFilePath={selectedFileChange?.filePath ?? null}
            />
            <DiffPreview fileChange={selectedFileChange} />
          </div>
        )}

        {state.activeTab === 'preview' && (
          <div className="space-y-3">
            <AttachmentPreviewList
              sessionId={sessionId}
              attachments={model.attachmentPreviews}
              selectedAttachmentId={selectedAttachment?.id ?? null}
            />
            {selectedAttachment ? (
              <PreviewRenderer attachment={selectedAttachment} />
            ) : (
              <FilePreview
                preview={selectedPreview}
                activity={selectedActivity}
              />
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

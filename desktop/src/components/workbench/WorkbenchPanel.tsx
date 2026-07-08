import { useMemo, useState } from 'react'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useWorkbenchStore, type WorkbenchTab } from '../../stores/workbenchStore'
import type { UIMessage } from '../../types/chat'
import { AttachmentPreviewList } from './AttachmentPreviewList'
import { BrowserWorkbenchView } from './BrowserWorkbenchView'
import { DiffPreview } from './DiffPreview'
import { FileChangeList } from './FileChangeList'
import { FilePreview } from './FilePreview'
import { PreviewRenderer } from './PreviewRenderer'
import { ToolActivityList } from './ToolActivityList'
import { WorkspaceFileTree } from './WorkspaceFileTree'
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
  workDir?: string | null
}

const TABS: Array<{ id: WorkbenchTab; icon: string; labelKey: TranslationKey }> = [
  { id: 'diff', icon: 'difference', labelKey: 'workbench.tab.diff' },
  { id: 'browser', icon: 'public', labelKey: 'workbench.tab.browser' },
  { id: 'preview', icon: 'folder_open', labelKey: 'workbench.tab.preview' },
  { id: 'activity', icon: 'construction', labelKey: 'workbench.tab.activity' },
]

export function WorkbenchPanel({ sessionId, messages, workDir }: Props) {
  const t = useTranslation()
  const state = useWorkbenchStore((store) => store.getSessionState(sessionId))
  const openWorkbench = useWorkbenchStore((store) => store.openWorkbench)
  const closeWorkbench = useWorkbenchStore((store) => store.closeWorkbench)
  const setActiveTab = useWorkbenchStore((store) => store.setActiveTab)
  const panelWidth = useWorkbenchStore((store) => store.panelWidth)
  const setPanelWidth = useWorkbenchStore((store) => store.setPanelWidth)
  const resetPanelWidth = useWorkbenchStore((store) => store.resetPanelWidth)
  const terminalDrawerOpen = useUIStore((store) => store.terminalDrawerOpen)
  const setTerminalDrawerOpen = useUIStore((store) => store.setTerminalDrawerOpen)
  const [isResizing, setIsResizing] = useState(false)

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
  const panelStyle = {
    width: state.isOpen ? panelWidth : 0,
    minWidth: state.isOpen ? 240 : 0,
    maxWidth: state.isOpen ? 'max(240px, calc(100% - 480px))' : 0,
    transition: isResizing
      ? 'none'
      : 'width 220ms cubic-bezier(0.22, 1, 0.36, 1), min-width 220ms cubic-bezier(0.22, 1, 0.36, 1), max-width 220ms cubic-bezier(0.22, 1, 0.36, 1)',
  }

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = panelWidth
    setIsResizing(true)

    const handleMove = (moveEvent: MouseEvent) => {
      setPanelWidth(startWidth + startX - moveEvent.clientX)
    }
    const handleUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  return (
    <aside
      data-testid={state.isOpen ? 'workbench-panel' : 'workbench-collapsed'}
      data-resizing={isResizing ? 'true' : 'false'}
      data-open={state.isOpen ? 'true' : 'false'}
      className={`relative shrink-0 bg-[var(--color-surface)] ${
        state.isOpen
          ? 'overflow-hidden border-l border-[var(--color-border)]'
          : 'overflow-visible pointer-events-none'
      }`}
      style={panelStyle}
      aria-label={t('workbench.title')}
    >
      <button
        type="button"
        onClick={() => setTerminalDrawerOpen(!terminalDrawerOpen)}
        className={`pointer-events-auto absolute right-12 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-sm transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
          terminalDrawerOpen ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : ''
        }`}
        aria-pressed={terminalDrawerOpen}
        aria-label={terminalDrawerOpen ? t('tabs.close') : t('appMenu.view.terminal')}
        title={terminalDrawerOpen ? t('tabs.close') : t('appMenu.view.terminal')}
      >
        <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
          terminal
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (state.isOpen) closeWorkbench(sessionId)
          else openWorkbench(sessionId)
        }}
        className="pointer-events-auto absolute right-3 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] shadow-sm transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        aria-label={state.isOpen ? t('workbench.close') : t('workbench.open')}
        title={state.isOpen ? t('workbench.close') : t('workbench.open')}
      >
        <span className="material-symbols-outlined text-[17px]">
          {state.isOpen ? 'right_panel_close' : 'right_panel_open'}
        </span>
      </button>

      {state.isOpen && (
        <>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize workbench"
          title="Drag to resize. Double-click to reset."
          onMouseDown={startResize}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            resetPanelWidth()
          }}
          className="absolute bottom-0 left-0 top-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--color-border-focus)]/20"
        />
        <div className="flex h-full min-w-[240px] flex-col transition-opacity duration-150 ease-out">
          <div className="flex h-11 items-center justify-between border-b border-[var(--color-border)] px-3 pr-24">
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
          </div>

          <div
            role="tablist"
            aria-label={t('workbench.tabs')}
            className="mx-3 my-2 grid grid-cols-4 gap-1 rounded-xl bg-[var(--color-surface-container-low)] p-1"
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
                    ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
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
                selectedToolUseId={state.selectedToolUseId}
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

            {state.activeTab === 'browser' && (
              <BrowserWorkbenchView key={sessionId} sessionId={sessionId} />
            )}

            {state.activeTab === 'preview' && (
              <div className="space-y-3">
                <AttachmentPreviewList
                  sessionId={sessionId}
                  attachments={model.attachmentPreviews}
                  selectedAttachmentId={selectedAttachment?.id ?? null}
                />
                <WorkspaceFileTree
                  root={workDir}
                  fallback={selectedAttachment ? (
                    <PreviewRenderer attachment={selectedAttachment} />
                  ) : (
                    <FilePreview
                      preview={selectedPreview}
                      activity={selectedActivity}
                    />
                  )}
                />
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </aside>
  )
}

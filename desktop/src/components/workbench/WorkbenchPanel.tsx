import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sessionsApi, type GitReview } from '../../api/sessions'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useUIStore } from '../../stores/uiStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { flushDesktopProfileWrites } from '../../stores/desktopProfileStore'
import { useWorkbenchStore, type WorkbenchTab } from '../../stores/workbenchStore'
import type { UIMessage } from '../../types/chat'
import { AgentTaskEvidenceView } from './AgentTaskEvidenceView'
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
  type WorkbenchFileChange,
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

const EVIDENCE_TAB: {
  id: WorkbenchTab
  icon: string
  labelKey: TranslationKey
} = {
  id: 'evidence',
  icon: 'fact_check',
  labelKey: 'workbench.tab.evidence',
}

function mapGitReviewFiles(review: GitReview | null): WorkbenchFileChange[] {
  if (!review?.isGit) return []
  const timestamp = Date.now()
  return review.files.map((file) => ({
    id: `git:${file.path}`,
    filePath: file.path,
    toolUseId: `git:${file.path}`,
    toolName: 'Git',
    kind: file.kind,
    summary: file.oldPath ? `${file.oldPath} -> ${file.path}` : file.status.trim() || file.kind,
    ...(file.oldText !== undefined ? { oldText: file.oldText } : {}),
    ...(file.newText !== undefined ? { newText: file.newText } : {}),
    binary: file.binary,
    truncated: file.truncated,
    timestamp,
  }))
}

export function WorkbenchPanel({ sessionId, messages, workDir }: Props) {
  const t = useTranslation()
  const agentTaskDetail = useAgentTaskStore((store) =>
    store.detail?.task.sessionId === sessionId ? store.detail : null,
  )
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
  const [gitReview, setGitReview] = useState<GitReview | null>(null)
  const gitReviewRequestRef = useRef(0)

  const refreshGitReview = useCallback(async (selectedPath?: string | null) => {
    const requestId = ++gitReviewRequestRef.current
    try {
      const review = await sessionsApi.getGitReview(sessionId, selectedPath)
      if (requestId === gitReviewRequestRef.current) setGitReview(review)
    } catch {
      if (requestId === gitReviewRequestRef.current) setGitReview(null)
    }
  }, [sessionId])

  const model = useMemo(() => buildWorkbenchModel(messages), [messages])
  const gitFileChanges = useMemo(() => mapGitReviewFiles(gitReview), [gitReview])
  const visibleTabs = gitReview?.isGit
    ? TABS
    : TABS.filter((tab) => tab.id !== 'diff')
  const tabs = agentTaskDetail ? [...visibleTabs, EVIDENCE_TAB] : visibleTabs
  const activeTab =
    (!agentTaskDetail && state.activeTab === 'evidence') ||
    (!gitReview?.isGit && state.activeTab === 'diff')
      ? 'activity'
      : state.activeTab
  const selectedActivity = findSelectedActivity(model, state.selectedToolUseId)
  const reviewModel = useMemo(
    () => ({ ...model, fileChanges: gitFileChanges }),
    [gitFileChanges, model],
  )
  const selectedFileChange = findSelectedFileChange(
    reviewModel,
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
    : activeTab === 'preview' && !state.selectedToolUseId && !state.selectedFilePath
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
      void flushDesktopProfileWrites()
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  useEffect(() => {
    if (!state.isOpen) return
    const selectedPath = state.activeTab === 'diff' ? selectedFileChange?.filePath : null
    void refreshGitReview(selectedPath)
  }, [messages.length, refreshGitReview, selectedFileChange?.filePath, state.activeTab, state.isOpen])

  useEffect(() => {
    if (!state.isOpen) return
    const selectedPath = state.activeTab === 'diff' ? selectedFileChange?.filePath : null
    const refreshOnFocus = () => void refreshGitReview(selectedPath)
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
  }, [refreshGitReview, selectedFileChange?.filePath, state.activeTab, state.isOpen])

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
        className={`pointer-events-auto absolute right-11 top-2 z-40 flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
          terminalDrawerOpen ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : ''
        }`}
        aria-pressed={terminalDrawerOpen}
        aria-label={terminalDrawerOpen ? t('tabs.close') : t('appMenu.view.terminal')}
        title={terminalDrawerOpen ? t('tabs.close') : t('appMenu.view.terminal')}
      >
        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
          terminal
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (state.isOpen) closeWorkbench(sessionId)
          else openWorkbench(sessionId)
        }}
        className="pointer-events-auto absolute right-3 top-2 z-40 flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        aria-label={state.isOpen ? t('workbench.close') : t('workbench.open')}
        title={state.isOpen ? t('workbench.close') : t('workbench.open')}
      >
        <span className="material-symbols-outlined text-[16px]">
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
            className="mx-3 my-2 grid gap-1 rounded-xl bg-[var(--color-surface-container-low)] p-1"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(sessionId, tab.id)}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
                  activeTab === tab.id
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
            {activeTab === 'evidence' && (
              <AgentTaskEvidenceView detail={agentTaskDetail} />
            )}

            {activeTab === 'activity' && (
              <ToolActivityList
                sessionId={sessionId}
                activities={model.activities}
                fileChanges={model.fileChanges}
                selectedToolUseId={state.selectedToolUseId}
              />
            )}

            {activeTab === 'diff' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-[10px] text-[var(--color-text-tertiary)]">
                    {gitReview?.branch ?? gitReview?.repoName ?? ''}
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshGitReview(selectedFileChange?.filePath)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    aria-label={t('workbench.diff.refresh')}
                    title={t('workbench.diff.refresh')}
                  >
                    <span className="material-symbols-outlined text-[15px]">refresh</span>
                  </button>
                </div>
                <FileChangeList
                  sessionId={sessionId}
                  fileChanges={gitFileChanges}
                  selectedFilePath={selectedFileChange?.filePath ?? null}
                  totalFileCount={gitReview?.changedFiles ?? gitFileChanges.length}
                  filesTruncated={gitReview?.filesTruncated ?? false}
                />
                <DiffPreview fileChange={selectedFileChange} />
              </div>
            )}

            {activeTab === 'browser' && (
              <BrowserWorkbenchView key={sessionId} sessionId={sessionId} />
            )}

            {activeTab === 'preview' && (
              <div className="space-y-3">
                <AttachmentPreviewList
                  sessionId={sessionId}
                  attachments={model.attachmentPreviews}
                  selectedAttachmentId={selectedAttachment?.id ?? null}
                />
                <WorkspaceFileTree
                  root={workDir}
                  initialPath={state.selectedFilePath}
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

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ProjectFilter } from './ProjectFilter'
import { CapabilityBar } from './CapabilityBar'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { SessionListItem } from '../../types/session'
import { useTabStore, SETTINGS_TAB_ID, SCHEDULED_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { resolveNewSessionWorkDir } from '../../utils/newSessionWorkDir'
import { filesystemApi } from '../../api/filesystem'
import { expandProjectKeys, isProjectInSet } from '../../utils/projectKeys'
import { copyTextToClipboard } from '../chat/clipboard'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

type SessionProjectGroup = {
  id: string
  title: string
  pathLabel: string
  latestModifiedAt: string
  sessions: SessionListItem[]
  projectKeys: string[]
  missingCount: number
  ungrouped: boolean
  pinned?: boolean
  projectPinned?: boolean
}

type SidebarContextMenu =
  | { type: 'session'; id: string; path?: string; x: number; y: number }
  | { type: 'project'; title: string; path: string; projectKeys: string[]; projectPinned: boolean; x: number; y: number }

type PendingRemoveProject = {
  title: string
  projectKeys: string[]
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const removedProjects = useSessionStore((s) => s.removedProjects)
  const pinnedProjects = useSessionStore((s) => s.pinnedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const updateSessionMeta = useSessionStore((s) => s.updateSessionMeta)
  const removeProjects = useSessionStore((s) => s.removeProjects)
  const setProjectPinned = useSessionStore((s) => s.setProjectPinned)
  const setNewSessionWorkDir = useSessionStore((s) => s.setNewSessionWorkDir)
  const addToast = useUIStore((s) => s.addToast)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId)?.type)
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const chatSessions = useChatStore((s) => s.sessions)
  const t = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null)
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [pendingRemoveProject, setPendingRemoveProject] = useState<PendingRemoveProject | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (!contextMenu || sidebarOpen) return
    setContextMenu(null)
  }, [contextMenu, sidebarOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  const removedProjectSet = useMemo(() => new Set(removedProjects), [removedProjects])
  const pinnedProjectSet = useMemo(() => new Set(pinnedProjects), [pinnedProjects])

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (removedProjectSet.size > 0) {
      result = result.filter((session) => !isSessionInRemovedProject(session, removedProjectSet))
    }
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (showArchived) {
      result = result.filter((s) => s.archived)
    } else if (!searchQuery) {
      result = result.filter((s) => !s.archived)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => [
        s.title,
        s.projectPath,
        s.workDir ?? '',
      ].some((value) => value.toLowerCase().includes(q)))
    }
    return result
  }, [removedProjectSet, sessions, selectedProjects, searchQuery, showArchived])

  const pinnedSessions = useMemo(() => (
    searchQuery ? [] : filteredSessions.filter((session) => session.pinned).sort(compareSessionsForSidebar)
  ), [filteredSessions, searchQuery])

  const projectGroups = useMemo(() => {
    const sessionsForProjects = searchQuery
      ? filteredSessions
      : filteredSessions.filter((session) => !session.pinned)
    return groupByProject(sessionsForProjects)
      .map((group) => ({
        ...group,
        projectPinned: group.projectKeys.some((project) => isProjectInSet(pinnedProjectSet, project)),
      }))
      .sort(compareProjectGroups)
  }, [filteredSessions, pinnedProjectSet, searchQuery])

  const sidebarSections = useMemo(() => {
    const pinnedGroups = [
      ...(pinnedSessions.length > 0 ? [{
        id: '__pinned__',
        title: t('sidebar.pinnedConversations'),
        pathLabel: '',
        latestModifiedAt: pinnedSessions[0]?.modifiedAt ?? new Date().toISOString(),
        sessions: pinnedSessions,
        projectKeys: [],
        missingCount: pinnedSessions.filter((session) => !session.workDirExists).length,
        ungrouped: false,
        pinned: true,
      }] : []),
      ...projectGroups.filter((group) => group.projectPinned),
    ]
    const regularGroups = projectGroups.filter((group) => !group.projectPinned)
    return [
      ...(pinnedGroups.length > 0 ? [{ id: 'pinned', title: t('sidebar.pinned'), groups: pinnedGroups }] : []),
      ...(regularGroups.length > 0 ? [{ id: 'projects', title: t('sidebar.projects'), groups: regularGroups }] : []),
    ]
  }, [pinnedSessions, projectGroups, t])

  const handleSessionContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const session = sessions.find((item) => item.id === id)
    const path = session?.workDir || session?.projectPath || undefined
    setContextMenu({ type: 'session', id, path, x: e.clientX, y: e.clientY })
  }, [sessions])

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, group: SessionProjectGroup) => {
    if (group.pinned || group.ungrouped || group.projectKeys.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      type: 'project',
      title: group.title,
      path: group.pathLabel,
      projectKeys: group.projectKeys,
      projectPinned: Boolean(group.projectPinned),
      x: e.clientX,
      y: e.clientY,
    })
  }, [])

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setPendingDeleteSessionId(id)
  }, [])

  const handleRemoveProject = useCallback((title: string, projectKeys: string[]) => {
    setContextMenu(null)
    setPendingRemoveProject({ title, projectKeys })
  }, [])

  const confirmRemoveProject = useCallback(() => {
    if (!pendingRemoveProject) return
    const projectKeys = pendingRemoveProject.projectKeys
    removeProjects(projectKeys)
    setCollapsedProjects((current) => {
      const next = new Set(current)
      projectKeys.forEach((project) => next.delete(project))
      return next
    })
    setPendingRemoveProject(null)
    addToast({ type: 'info', message: t('sidebar.projectGroup.removed') })
  }, [addToast, pendingRemoveProject, removeProjects, t])

  const handleOpenProjectFolder = useCallback(async (path: string) => {
    setContextMenu(null)
    try {
      await filesystemApi.reveal(path)
    } catch {
      addToast({ type: 'error', message: t('sidebar.projectGroup.openFailed') })
    }
  }, [addToast, t])

  const handleCopySessionId = useCallback(async (sessionId: string) => {
    setContextMenu(null)
    const copied = await copyTextToClipboard(sessionId)
    addToast({
      type: copied ? 'success' : 'error',
      message: copied ? t('sidebar.session.copyIdSuccess') : t('sidebar.session.copyIdFailed'),
    })
  }, [addToast, t])

  const handleUpdateSessionMeta = useCallback(async (
    sessionId: string,
    patch: Parameters<typeof updateSessionMeta>[1],
  ) => {
    setContextMenu(null)
    try {
      await updateSessionMeta(sessionId, patch)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.session.updateFailed'),
      })
    }
  }, [addToast, t, updateSessionMeta])

  const handleUpdateProjectSessions = useCallback(async (
    projectKeys: string[],
    patch: Parameters<typeof updateSessionMeta>[1],
  ) => {
    setContextMenu(null)
    const projectSessions = getSessionsForProjectKeys(sessions, projectKeys)
    if (projectSessions.length === 0) return
    try {
      await Promise.all(projectSessions.map((session) => updateSessionMeta(session.id, patch)))
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.session.updateFailed'),
      })
    }
  }, [addToast, sessions, t, updateSessionMeta])

  const handleSetProjectPinned = useCallback((projectKeys: string[], pinned: boolean) => {
    setContextMenu(null)
    setProjectPinned(projectKeys, pinned)
  }, [setProjectPinned])

  const createSessionForWorkDir = useCallback(async (workDir?: string) => {
    try {
      const sessionId = await useSessionStore.getState().createSession(workDir)
      useTabStore.getState().openTab(sessionId, t('sidebar.newSession'))
      useChatStore.getState().connectToSession(sessionId)
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
      })
    }
  }, [addToast, t])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSessionId) return
    await deleteSession(pendingDeleteSessionId)
    disconnectSession(pendingDeleteSessionId)
    closeTab(pendingDeleteSessionId)
    setPendingDeleteSessionId(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSessionId])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] select-none"
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
    >
      <div className={`px-3 pb-2 ${isTauri && !isWindows ? 'pt-[44px]' : 'pt-3'}`}>
        <div className={`flex ${sidebarOpen ? 'items-center justify-between gap-3' : 'flex-col items-center gap-2'}`}>
          <div className={`flex min-w-0 items-center ${sidebarOpen ? 'gap-2.5' : 'justify-center'}`}>
            <img src="/app-icon.svg" alt="" className="h-8 w-8 flex-shrink-0" />
            <span
              className={`sidebar-copy ${sidebarOpen ? 'sidebar-copy--visible' : 'sidebar-copy--hidden'} text-[13px] font-semibold tracking-tight text-[var(--color-text-primary)]`}
              style={{ fontFamily: 'var(--font-headline)' }}
            >
              Gugu <span className="text-[var(--color-text-accent)]">Agent</span>
            </span>
          </div>
          <div className={`flex items-center ${sidebarOpen ? 'gap-1.5' : 'flex-col gap-2'}`}>
            <button
              type="button"
              onClick={toggleSidebar}
              data-testid={sidebarOpen ? 'sidebar-collapse-button' : 'sidebar-expand-button'}
              className={`sidebar-toggle-button ${sidebarOpen ? 'sidebar-toggle-button--open h-8 w-8' : 'sidebar-toggle-button--collapsed h-8 w-8'} flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-sidebar)]`}
              aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
              title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
            >
              <SidebarToggleIcon collapsed={!sidebarOpen} />
            </button>
          </div>
        </div>
      </div>

      <div className={`px-3 pb-3 flex flex-col ${sidebarOpen ? 'gap-0.5' : 'items-center gap-2'}`}>
        <NavItem
          active={false}
          collapsed={!sidebarOpen}
          label={t('sidebar.newSession')}
          onClick={() => {
            setShowArchived(false)
            void createSessionForWorkDir(resolveNewSessionWorkDir())
          }}
          icon={<PlusIcon />}
        >
          {t('sidebar.newSession')}
        </NavItem>
        <NavItem
          active={activeTabId === SCHEDULED_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.scheduled')}
          onClick={() => {
            setShowArchived(false)
            useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')
          }}
          icon={<ClockIcon />}
        >
          {t('sidebar.scheduled')}
        </NavItem>
        <NavItem
          active={activeTabType === 'terminal'}
          collapsed={!sidebarOpen}
          label={t('sidebar.terminal')}
          onClick={() => {
            setShowArchived(false)
            useTabStore.getState().openTerminalTab()
          }}
          icon={<span className="material-symbols-outlined text-[18px]">terminal</span>}
        >
          {t('sidebar.terminal')}
        </NavItem>
        <NavItem
          active={showArchived}
          collapsed={!sidebarOpen}
          label={t('sidebar.archivedSessions')}
          onClick={() => setShowArchived((value) => !value)}
          icon={<span className="material-symbols-outlined text-[18px]">archive</span>}
        >
          {t('sidebar.archivedSessions')}
        </NavItem>
      </div>

      {sidebarOpen ? (
        <>
          <div
            data-testid="sidebar-project-filter-section"
            className="sidebar-section sidebar-section--visible relative z-20 flex-none px-3 pb-2"
            style={{ overflow: 'visible' }}
          >
            <div className="flex h-9 items-center rounded-[14px] border border-[var(--color-sidebar-search-border)] bg-[var(--color-sidebar-search-bg)] pl-1.5 pr-3 transition-colors focus-within:border-[var(--color-border-focus)]">
              <ProjectFilter variant="embedded" />
              <span className="mx-2 h-4 w-px bg-[var(--color-border)]/80" aria-hidden="true" />
              <span className="pointer-events-none flex shrink-0 items-center text-[var(--color-text-tertiary)]">
                <SearchIcon />
              </span>
              <input
                id="sidebar-search"
                type="text"
                placeholder={t('sidebar.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent pl-2 pr-0 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none"
              />
            </div>
          </div>

          <div
            data-testid="sidebar-session-list-section"
            className="sidebar-section sidebar-section--visible flex flex-1 min-h-0 flex-col"
          >
            <div className="sidebar-scroll-area min-h-0 flex-1 overflow-y-auto px-3">
              {error && (
                <div className="mx-1 mt-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2">
                  <div className="text-xs font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-secondary)] break-words">{error}</div>
                  <button
                    onClick={() => fetchSessions()}
                    className="mt-2 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {filteredSessions.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {showArchived && !searchQuery ? t('sidebar.noArchivedSessions') : searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {sidebarSections.map((section) => (
                <div key={section.id} className="mb-2">
                  <div className="px-2 pb-0.5 pt-2 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
                    {section.title}
                  </div>
                  {section.groups.map((group) => {
                    const collapsed = !searchQuery && collapsedProjects.has(group.id)
                return (
                  <div key={group.id} className="mb-1.5">
                    <div
                      className="group flex min-w-0 items-center gap-1 rounded-[10px] pr-1 hover:text-[var(--color-text-secondary)]"
                      onContextMenu={(e) => handleProjectContextMenu(e, group)}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setNewSessionWorkDir(group.ungrouped ? null : group.pathLabel)
                          setCollapsedProjects((current) => {
                            const next = new Set(current)
                            if (next.has(group.id)) next.delete(group.id)
                            else next.add(group.id)
                            return next
                          })
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 pb-1 pt-3 text-left text-[11px] font-semibold text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                        aria-expanded={!collapsed}
                      >
                        <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                          {collapsed ? 'chevron_right' : 'expand_more'}
                        </span>
                        <span className="material-symbols-outlined text-[15px]">
                          {group.pinned ? 'push_pin' : group.ungrouped ? 'inventory_2' : 'folder'}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {group.ungrouped ? t('sidebar.projectGroup.ungrouped') : group.title}
                        </span>
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] tabular-nums">
                          {group.sessions.length}
                        </span>
                      </button>
                    </div>
                    {!collapsed && group.pathLabel && (
                      <div className="mb-1 truncate px-8 text-[10px] text-[var(--color-text-tertiary)]" title={group.pathLabel}>
                        {group.pathLabel}
                      </div>
                    )}
                    {!collapsed && group.sessions.map((session) => {
                      const runtime = chatSessions[session.id]
                      const isRunning = runtime && runtime.chatState !== 'idle'
                      const sessionMeta = isRunning
                        ? formatRuntimeMeta(runtime.chatState, runtime.elapsedSeconds, t)
                        : formatSessionMeta(session, t)
                      return (
                      <div key={session.id} className="relative">
                        {renamingId === session.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={handleFinishRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishRename()
                              if (e.key === 'Escape') {
                                setRenamingId(null)
                                setRenameValue('')
                              }
                            }}
                            className="ml-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border-focus)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => {
                              setNewSessionWorkDir(session.workDir || session.projectPath || null)
                              useTabStore.getState().openTab(session.id, session.title)
                              useChatStore.getState().connectToSession(session.id)
                            }}
                            onContextMenu={(e) => handleSessionContextMenu(e, session.id)}
                            className={`
                              group w-full rounded-[12px] px-3 py-2 text-left text-sm transition-colors duration-200
                              ${session.id === activeTabId
                                ? 'bg-[var(--color-sidebar-item-active)] text-[var(--color-text-primary)]'
                                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)]'
                              }
                            `}
                          >
                            <span className="flex items-center gap-2.5">
                              <span
                                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                                style={{
                                  backgroundColor: session.id === activeTabId || session.unread ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                                  opacity: session.id === activeTabId || session.unread ? 1 : 0.5,
                                }}
                              />
                              {session.pinned && (
                                <span
                                  className="material-symbols-outlined flex-shrink-0 text-[13px] text-[var(--color-brand)]"
                                  title={t('sidebar.session.pinned')}
                                  aria-hidden="true"
                                >
                                  push_pin
                                </span>
                              )}
                              <span className={`flex-1 truncate tracking-[-0.01em] ${session.unread ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium'}`}>
                                {session.title || 'Untitled'}
                              </span>
                              {!session.workDirExists && (
                                <span
                                  className="flex-shrink-0 text-[10px] text-[var(--color-warning)]"
                                  title={session.workDir ?? ''}
                                >
                                  {t('sidebar.missingDir')}
                                </span>
                              )}
                              <span className={`flex-shrink-0 text-[10px] tabular-nums ${isRunning ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-tertiary)]'}`}>
                                {sessionMeta}
                              </span>
                            </span>
                          </button>
                        )}
                      </div>
                      )
                    })}
                  </div>
                )
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" aria-hidden="true" />
      )}

      <CapabilityBar />

      <div className={`border-t border-[var(--color-border)] p-3 ${sidebarOpen ? '' : 'flex justify-center'}`}>
        <NavItem
          active={activeTabId === SETTINGS_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.settings')}
          onClick={() => {
            setShowArchived(false)
            useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')
          }}
          icon={<span className="material-symbols-outlined text-[18px]">settings</span>}
        >
          {t('sidebar.settings')}
        </NavItem>
      </div>

      {contextMenu && sidebarOpen && (
        <div
          className="fixed z-50 w-max min-w-[132px] max-w-[260px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          {contextMenu.type === 'session' ? (
            <SessionContextMenuItems
              contextMenu={contextMenu}
              session={sessions.find((s) => s.id === contextMenu.id)}
              onOpenProjectFolder={handleOpenProjectFolder}
              onStartRename={handleStartRename}
              onCopySessionId={handleCopySessionId}
              onUpdateSessionMeta={handleUpdateSessionMeta}
              onDelete={handleDelete}
              t={t}
            />
          ) : (
            <ProjectContextMenuItems
              contextMenu={contextMenu}
              onOpenProjectFolder={handleOpenProjectFolder}
              onSetProjectPinned={handleSetProjectPinned}
              onUpdateProjectSessions={handleUpdateProjectSessions}
              onRemoveProject={handleRemoveProject}
              t={t}
            />
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        onClose={() => setPendingDeleteSessionId(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSessionId ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
      <ConfirmDialog
        open={pendingRemoveProject !== null}
        onClose={() => setPendingRemoveProject(null)}
        onConfirm={confirmRemoveProject}
        title={t('sidebar.projectGroup.confirmRemoveTitle', { name: pendingRemoveProject?.title ?? '' })}
        body={t('sidebar.projectGroup.confirmRemoveBody')}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </aside>
  )
}

function SessionContextMenuItems({
  contextMenu,
  session,
  onOpenProjectFolder,
  onStartRename,
  onCopySessionId,
  onUpdateSessionMeta,
  onDelete,
  t,
}: {
  contextMenu: Extract<SidebarContextMenu, { type: 'session' }>
  session?: SessionListItem
  onOpenProjectFolder: (path: string) => Promise<void>
  onStartRename: (id: string, currentTitle: string) => void
  onCopySessionId: (id: string) => Promise<void>
  onUpdateSessionMeta: (id: string, patch: { pinned?: boolean; archived?: boolean; unread?: boolean }) => Promise<void>
  onDelete: (id: string) => void
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <>
      {contextMenu.path && (
        <MenuButton icon="folder_open" onClick={() => void onOpenProjectFolder(contextMenu.path!)} title={contextMenu.path}>
          {t('sidebar.projectGroup.openInFolder')}
        </MenuButton>
      )}
      <MenuButton icon="push_pin" onClick={() => void onUpdateSessionMeta(contextMenu.id, { pinned: !session?.pinned })}>
        {session?.pinned ? t('sidebar.session.unpin') : t('sidebar.session.pin')}
      </MenuButton>
      <MenuButton icon="archive" onClick={() => void onUpdateSessionMeta(contextMenu.id, { archived: !session?.archived })}>
        {session?.archived ? t('sidebar.session.unarchive') : t('sidebar.session.archive')}
      </MenuButton>
      <MenuButton icon={session?.unread ? 'drafts' : 'mark_email_unread'} onClick={() => void onUpdateSessionMeta(contextMenu.id, { unread: !session?.unread })}>
        {session?.unread ? t('sidebar.session.markRead') : t('sidebar.session.markUnread')}
      </MenuButton>
      <MenuButton icon="edit" onClick={() => onStartRename(contextMenu.id, session?.title || '')}>
        {t('common.rename')}
      </MenuButton>
      <MenuButton icon="content_copy" onClick={() => void onCopySessionId(contextMenu.id)}>
        {t('sidebar.session.copyId')}
      </MenuButton>
      <MenuButton danger icon="delete" onClick={() => onDelete(contextMenu.id)}>
        {t('common.delete')}
      </MenuButton>
    </>
  )
}

function ProjectContextMenuItems({
  contextMenu,
  onOpenProjectFolder,
  onSetProjectPinned,
  onUpdateProjectSessions,
  onRemoveProject,
  t,
}: {
  contextMenu: Extract<SidebarContextMenu, { type: 'project' }>
  onOpenProjectFolder: (path: string) => Promise<void>
  onSetProjectPinned: (projectKeys: string[], pinned: boolean) => void
  onUpdateProjectSessions: (projectKeys: string[], patch: { pinned?: boolean; archived?: boolean; unread?: boolean }) => Promise<void>
  onRemoveProject: (title: string, projectKeys: string[]) => void
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <>
      <MenuButton icon="folder_open" onClick={() => void onOpenProjectFolder(contextMenu.path)} title={contextMenu.path}>
        {t('sidebar.projectGroup.openInFolder')}
      </MenuButton>
      <MenuButton icon="push_pin" onClick={() => onSetProjectPinned(contextMenu.projectKeys, !contextMenu.projectPinned)}>
        {contextMenu.projectPinned ? t('sidebar.projectGroup.unpin') : t('sidebar.projectGroup.pin')}
      </MenuButton>
      <MenuButton icon="archive" onClick={() => void onUpdateProjectSessions(contextMenu.projectKeys, { archived: true })}>
        {t('sidebar.projectGroup.archiveSessions')}
      </MenuButton>
      <MenuButton icon="close" onClick={() => onRemoveProject(contextMenu.title, contextMenu.projectKeys)} title={contextMenu.title}>
        {t('common.remove')}
      </MenuButton>
    </>
  )
}

function MenuButton({
  children,
  danger = false,
  icon,
  onClick,
  title,
}: {
  children: React.ReactNode
  danger?: boolean
  icon: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-hover)] ${
        danger ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'
      }`}
    >
      <span className="material-symbols-outlined text-[15px] opacity-75" aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function groupByProject(sessions: SessionListItem[]): SessionProjectGroup[] {
  const groups = new Map<string, SessionProjectGroup>()
  for (const session of sessions) {
    const rawPath = session.workDir || session.projectPath || ''
    const key = rawPath || '__ungrouped__'
    const projectKeys = getSessionProjectKeys(session)
    const current = groups.get(key)
    const latestModifiedAt = current && new Date(current.latestModifiedAt).getTime() > new Date(session.modifiedAt).getTime()
      ? current.latestModifiedAt
      : session.modifiedAt

    if (current) {
      current.sessions.push(session)
      current.projectKeys = [...new Set([...current.projectKeys, ...projectKeys])]
      current.latestModifiedAt = latestModifiedAt
      current.missingCount += session.workDirExists ? 0 : 1
      continue
    }

    groups.set(key, {
      id: key,
      title: rawPath ? basename(rawPath) : '',
      pathLabel: rawPath,
      latestModifiedAt,
      sessions: [session],
      projectKeys,
      missingCount: session.workDirExists ? 0 : 1,
      ungrouped: !rawPath,
    })
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort(compareSessionsForSidebar),
    }))
    .sort((a, b) => {
      return new Date(b.latestModifiedAt).getTime() - new Date(a.latestModifiedAt).getTime()
    })
}

function compareProjectGroups(a: SessionProjectGroup, b: SessionProjectGroup): number {
  if (Boolean(a.projectPinned) !== Boolean(b.projectPinned)) return a.projectPinned ? -1 : 1
  return new Date(b.latestModifiedAt).getTime() - new Date(a.latestModifiedAt).getTime()
}

function compareSessionsForSidebar(a: SessionListItem, b: SessionListItem): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
  return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
}

function getSessionProjectKeys(session: SessionListItem): string[] {
  return expandProjectKeys([
    session.workDir || session.projectPath || '',
    session.projectPath || '',
  ])
}

function isSessionInRemovedProject(session: SessionListItem, removedProjectSet: Set<string>): boolean {
  return getSessionProjectKeys(session).some((project) => isProjectInSet(removedProjectSet, project))
}

function getSessionsForProjectKeys(sessions: SessionListItem[], projectKeys: string[]): SessionListItem[] {
  const projectSet = new Set(projectKeys)
  return sessions.filter((session) =>
    getSessionProjectKeys(session).some((project) => isProjectInSet(projectSet, project)),
  )
}

function NavItem({
  active,
  collapsed,
  label,
  onClick,
  icon,
  children,
}: {
  active: boolean
  collapsed: boolean
  label: string
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`
        flex items-center transition-colors duration-200
        ${collapsed ? 'h-10 w-10 justify-center rounded-[var(--radius-md)] px-0 py-0' : 'w-full gap-2.5 rounded-[12px] px-3 py-2.5 text-sm'}
        ${active
          ? 'bg-[var(--color-sidebar-item-active)] font-medium text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className={`sidebar-copy ${collapsed ? 'sidebar-copy--hidden' : 'sidebar-copy--visible'}`}>
        {children}
      </span>
    </button>
  )
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  return `${Math.floor(day / 30)}mo`
}

function formatSessionMeta(session: SessionListItem, t: ReturnType<typeof useTranslation>): string {
  const messageCount = session.messageCount
  const messageLabel = messageCount === 1
    ? t('sidebar.sessionMeta.oneMessage')
    : t('sidebar.sessionMeta.messages', { count: messageCount })
  return `${formatRelativeTime(session.modifiedAt)} · ${messageLabel}`
}

function formatRuntimeMeta(chatState: string, elapsedSeconds: number, t: ReturnType<typeof useTranslation>): string {
  const elapsed = formatElapsed(elapsedSeconds)
  if (chatState === 'permission_pending') return t('sidebar.sessionMeta.waitingPermission')
  return t('sidebar.sessionMeta.running', { elapsed })
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const min = Math.floor(seconds / 60)
  const sec = seconds % 60
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const restMin = min % 60
  return restMin ? `${hr}h ${restMin}m` : `${hr}h`
}

function basename(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || input || ''
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width={collapsed ? 16 : 14}
      height={collapsed ? 16 : 14}
      viewBox="0 0 14 14"
      fill="none"
      className={`sidebar-toggle-icon ${collapsed ? 'sidebar-toggle-icon--collapsed' : 'sidebar-toggle-icon--open'}`}
      aria-hidden="true"
    >
      <path
        d={collapsed ? 'M5 3 9 7l-4 4' : 'M9 3 5 7l4 4'}
        className="sidebar-toggle-chevron"
      />
    </svg>
  )
}

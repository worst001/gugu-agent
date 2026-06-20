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
}

type SidebarContextMenu =
  | { type: 'session'; id: string; x: number; y: number }
  | { type: 'project'; title: string; projectKeys: string[]; x: number; y: number }

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const removedProjects = useSessionStore((s) => s.removedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const removeProjects = useSessionStore((s) => s.removeProjects)
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())

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

  const filteredSessions = useMemo(() => {
    let result = sessions
    if (removedProjectSet.size > 0) {
      result = result.filter((session) => !isSessionInRemovedProject(session, removedProjectSet))
    }
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
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
  }, [removedProjectSet, sessions, selectedProjects, searchQuery])

  const projectGroups = useMemo(() => groupByProject(filteredSessions), [filteredSessions])

  const handleSessionContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ type: 'session', id, x: e.clientX, y: e.clientY })
  }, [])

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, group: SessionProjectGroup) => {
    if (group.ungrouped || group.projectKeys.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      type: 'project',
      title: group.title,
      projectKeys: group.projectKeys,
      x: e.clientX,
      y: e.clientY,
    })
  }, [])

  const handleDelete = useCallback((id: string) => {
    setContextMenu(null)
    setPendingDeleteSessionId(id)
  }, [])

  const handleRemoveProject = useCallback((projectKeys: string[]) => {
    setContextMenu(null)
    removeProjects(projectKeys)
    setCollapsedProjects((current) => {
      const next = new Set(current)
      projectKeys.forEach((project) => next.delete(project))
      return next
    })
    addToast({ type: 'info', message: t('sidebar.projectGroup.removed') })
  }, [addToast, removeProjects, t])

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
              Gugu <span className="text-[var(--color-primary-container)]">Agent</span>
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
          onClick={async () => {
            try {
              const workDir = resolveNewSessionWorkDir()
              const sessionId = await useSessionStore.getState().createSession(workDir)
              useTabStore.getState().openTab(sessionId, t('sidebar.newSession'))
              useChatStore.getState().connectToSession(sessionId)
            } catch (error) {
              addToast({
                type: 'error',
                message: error instanceof Error ? error.message : t('sidebar.sessionListFailed'),
              })
            }
          }}
          icon={<PlusIcon />}
        >
          {t('sidebar.newSession')}
        </NavItem>
        <NavItem
          active={activeTabId === SCHEDULED_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.scheduled')}
          onClick={() => useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')}
          icon={<ClockIcon />}
        >
          {t('sidebar.scheduled')}
        </NavItem>
        <NavItem
          active={activeTabType === 'terminal'}
          collapsed={!sidebarOpen}
          label={t('sidebar.terminal')}
          onClick={() => useTabStore.getState().openTerminalTab()}
          icon={<span className="material-symbols-outlined text-[18px]">terminal</span>}
        >
          {t('sidebar.terminal')}
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
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {projectGroups.map((group) => {
                const collapsed = !searchQuery && collapsedProjects.has(group.id)
                return (
                  <div key={group.id} className="mb-1.5">
                    <button
                      type="button"
                      onContextMenu={(e) => handleProjectContextMenu(e, group)}
                      onClick={() => {
                        setNewSessionWorkDir(group.ungrouped ? null : group.pathLabel)
                        setCollapsedProjects((current) => {
                          const next = new Set(current)
                          if (next.has(group.id)) next.delete(group.id)
                          else next.add(group.id)
                          return next
                        })
                      }}
                      className="group flex w-full min-w-0 items-center gap-2 rounded-[10px] px-2 pb-1 pt-3 text-left text-[11px] font-semibold text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                      aria-expanded={!collapsed}
                    >
                      <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                        {collapsed ? 'chevron_right' : 'expand_more'}
                      </span>
                      <span className="material-symbols-outlined text-[15px]">
                        {group.ungrouped ? 'inventory_2' : 'folder'}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {group.ungrouped ? t('sidebar.projectGroup.ungrouped') : group.title}
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-container-high)] px-1.5 py-0.5 text-[10px] tabular-nums">
                        {group.sessions.length}
                      </span>
                    </button>
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
                                  backgroundColor: session.id === activeTabId ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                                  opacity: session.id === activeTabId ? 1 : 0.5,
                                }}
                              />
                              <span className="flex-1 truncate font-medium tracking-[-0.01em]">{session.title || 'Untitled'}</span>
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
          onClick={() => useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')}
          icon={<span className="material-symbols-outlined text-[18px]">settings</span>}
        >
          {t('sidebar.settings')}
        </NavItem>
      </div>

      {contextMenu && sidebarOpen && (
        <div
          className="fixed z-50 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          {contextMenu.type === 'session' ? (
            <>
              <button
                onClick={() => {
                  const session = sessions.find((s) => s.id === contextMenu.id)
                  handleStartRename(contextMenu.id, session?.title || '')
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {t('common.rename')}
              </button>
              <button
                onClick={() => handleDelete(contextMenu.id)}
                className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                {t('common.delete')}
              </button>
            </>
          ) : (
            <button
              onClick={() => handleRemoveProject(contextMenu.projectKeys)}
              title={contextMenu.title}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              {t('common.remove')}
            </button>
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
    </aside>
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
      sessions: group.sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()),
    }))
    .sort((a, b) => new Date(b.latestModifiedAt).getTime() - new Date(a.latestModifiedAt).getTime())
}

function getSessionProjectKeys(session: SessionListItem): string[] {
  return [...new Set([
    session.workDir || session.projectPath || '',
    session.projectPath || '',
  ].filter(Boolean))]
}

function isSessionInRemovedProject(session: SessionListItem, removedProjectSet: Set<string>): boolean {
  return getSessionProjectKeys(session).some((project) => removedProjectSet.has(project))
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

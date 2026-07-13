import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { AppMenu } from './AppMenu'
import { StartupErrorView } from './StartupErrorView'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useBillingStore } from '../../stores/billingStore'
import { useTranslation } from '../../i18n'
import { TerminalDrawer } from './TerminalDrawer'
import { flushDesktopProfileWrites } from '../../stores/desktopProfileStore'
import {
  flushDesktopStateWrites,
  initializeDesktopProfilePersistence,
} from '../../stores/desktopProfilePersistence'

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const resetSidebarWidth = useUIStore((s) => s.resetSidebarWidth)
  const terminalDrawerOpen = useUIStore((s) => s.terminalDrawerOpen)
  const tabCount = useTabStore((s) => s.tabs.length)
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [renderSidebar, setRenderSidebar] = useState(sidebarOpen)
  const [sidebarExpanded, setSidebarExpanded] = useState(sidebarOpen)
  const [renderTerminalDrawer, setRenderTerminalDrawer] = useState(terminalDrawerOpen)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const didMountSidebarAnimation = useRef(false)
  const t = useTranslation()

  useEffect(() => {
    if (!didMountSidebarAnimation.current) {
      didMountSidebarAnimation.current = true
      setRenderSidebar(sidebarOpen)
      setSidebarExpanded(sidebarOpen)
      return
    }
    let timeout: number | undefined
    let frame: number | undefined
    let nextFrame: number | undefined
    if (sidebarOpen) {
      setSidebarExpanded(false)
      setRenderSidebar(true)
      frame = window.requestAnimationFrame(() => {
        nextFrame = window.requestAnimationFrame(() => setSidebarExpanded(true))
      })
    } else {
      setSidebarExpanded(false)
      timeout = window.setTimeout(() => setRenderSidebar(false), 240)
    }
    return () => {
      if (timeout) window.clearTimeout(timeout)
      if (frame) window.cancelAnimationFrame(frame)
      if (nextFrame) window.cancelAnimationFrame(nextFrame)
    }
  }, [sidebarOpen])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
        await initializeDesktopProfilePersistence()
        await fetchSettings()
        void useBillingStore.getState().fetchBilling()

        // The profile bootstrap mirrors authoritative tab state before validation.
        await useTabStore.getState().restoreTabs()
        const { activeTabId: activeId, tabs } = useTabStore.getState()
        const activeTab = tabs.find((tab) => tab.sessionId === activeId)
        if (activeId && activeTab?.type === 'session') {
          useChatStore.getState().connectToSession(activeId)
        }
        if (!cancelled) {
          setReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [fetchSettings])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let closing = false

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow()
        return appWindow.onCloseRequested(async (event) => {
          event.preventDefault()
          if (closing) return
          closing = true
          try {
            await flushDesktopStateWrites()
            await appWindow.destroy()
          } finally {
            closing = false
          }
        })
      })
      .then((fn) => { unlisten = fn })
      .catch(() => {})

    return () => { unlisten?.() }
  }, [])

  // Listen for macOS native menu navigation events (About / Settings)
  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          if (target === 'about') {
            useUIStore.getState().setPendingSettingsTab('about')
          }
          useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()

  useEffect(() => {
    if (ready && tabCount === 0) {
      useTabStore.getState().openDraftTab(t('sidebar.newSession'))
    }
  }, [ready, tabCount, t])

  useEffect(() => {
    if (terminalDrawerOpen) setRenderTerminalDrawer(true)
  }, [terminalDrawerOpen])

  const startSidebarResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarOpen) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = sidebarWidth
    setIsSidebarResizing(true)

    const handleMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(startWidth + moveEvent.clientX - startX)
    }
    const handleUp = () => {
      setIsSidebarResizing(false)
      void flushDesktopProfileWrites()
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        {t('app.launching')}
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--color-surface)]">
      <AppMenu />
      <div className="min-h-0 flex flex-1 overflow-hidden">
        {renderSidebar && (
          <div
            data-testid="sidebar-shell"
            data-state={sidebarExpanded ? 'open' : 'closed'}
            data-resizing={isSidebarResizing ? 'true' : 'false'}
            className="sidebar-shell relative"
            style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
          >
            <Sidebar />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              title="Drag to resize. Double-click to reset."
              onMouseDown={startSidebarResize}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                resetSidebarWidth()
              }}
              className="absolute bottom-0 right-0 top-0 z-40 w-2 translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--color-border-focus)]/20"
            />
          </div>
        )}
        <main
          id="content-area"
          data-sidebar-state={sidebarOpen ? 'open' : 'closed'}
          className="relative min-w-0 flex-1 flex flex-col overflow-hidden"
        >
          <TabBar />
          <ContentRouter />
          {renderTerminalDrawer && <TerminalDrawer open={terminalDrawerOpen} />}
        </main>
      </div>
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}

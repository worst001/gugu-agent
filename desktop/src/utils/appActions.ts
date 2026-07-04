import { SETTINGS_TAB_ID, useTabStore } from '../stores/tabStore'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUIStore, type SettingsTab } from '../stores/uiStore'
import { resolveNewSessionWorkDir } from './newSessionWorkDir'

export async function createSessionFromAppAction() {
  try {
    const sessionId = await useSessionStore.getState().createSession(resolveNewSessionWorkDir())
    useTabStore.getState().openTab(sessionId, 'New Session')
    useChatStore.getState().connectToSession(sessionId)
  } catch (error) {
    useUIStore.getState().addToast({
      type: 'error',
      message: error instanceof Error ? error.message : 'Failed to create session',
    })
  }
}

export function closeCurrentTabFromAppAction() {
  const { activeTabId, tabs, closeTab } = useTabStore.getState()
  if (!activeTabId) return

  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  if (!activeTab) return

  const sessionState = useChatStore.getState().sessions[activeTabId]
  const isRunningSession = activeTab.type === 'session' && sessionState && sessionState.chatState !== 'idle'
  if (activeTab.type === 'session' && !isRunningSession) {
    useChatStore.getState().disconnectSession(activeTabId)
  }
  closeTab(activeTabId)
}

export function stopCurrentSessionFromAppAction() {
  const activeTabId = useTabStore.getState().activeTabId
  if (!activeTabId) return
  const sessionState = useChatStore.getState().sessions[activeTabId]
  if (!sessionState || sessionState.chatState === 'idle' || sessionState.chatState === 'stopping') return
  useChatStore.getState().stopGeneration(activeTabId)
}

export function openSettingsFromAppAction(tab?: SettingsTab) {
  if (tab) useUIStore.getState().setPendingSettingsTab(tab)
  useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
}

export function focusSidebarSearchFromAppAction() {
  useUIStore.getState().setSidebarOpen(true)
  requestAnimationFrame(() => {
    const searchInput = document.querySelector('#sidebar-search') as HTMLInputElement | null
    searchInput?.focus()
    searchInput?.select()
  })
}

export function openTerminalFromAppAction() {
  useTabStore.getState().openTerminalTab()
}

export function switchActiveTabFromAppAction(direction: -1 | 1) {
  const { tabs, activeTabId, setActiveTab } = useTabStore.getState()
  if (tabs.length <= 1) return
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.sessionId === activeTabId))
  const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length]
  if (!nextTab) return

  setActiveTab(nextTab.sessionId)
  if (nextTab.type === 'session') {
    useChatStore.getState().connectToSession(nextTab.sessionId)
  }
}

export async function toggleFullscreenFromAppAction() {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.setFullscreen(!(await win.isFullscreen()))
    return
  } catch { /* fallback below */ }

  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await document.documentElement.requestFullscreen()
  }
}

export async function openExternalFromAppAction(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank')
  }
}

export async function quitAppFromAppAction() {
  try {
    const { exit } = await import('@tauri-apps/plugin-process')
    await exit(0)
  } catch {
    window.close()
  }
}

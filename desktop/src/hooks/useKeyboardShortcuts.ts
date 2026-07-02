import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { resolveNewSessionWorkDir } from '../utils/newSessionWorkDir'

export function useKeyboardShortcuts() {
  const setActiveView = useUIStore((s) => s.setActiveView)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const closeModal = useUIStore((s) => s.closeModal)
  const activeModal = useUIStore((s) => s.activeModal)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const chatState = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.chatState ?? 'idle' : 'idle')

  const activeModalRef = useRef(activeModal)
  activeModalRef.current = activeModal
  const chatStateRef = useRef(chatState)
  chatStateRef.current = chatState
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const editableTarget = isEditableTarget(event.target)

      if (event.key === 'Escape' && activeModalRef.current) {
        closeModal()
        return
      }

      if (!meta) return

      if (
        event.key === '.' &&
        chatStateRef.current !== 'idle' &&
        chatStateRef.current !== 'stopping' &&
        activeTabIdRef.current
      ) {
        event.preventDefault()
        stopGeneration(activeTabIdRef.current)
        return
      }

      if (editableTarget || activeModalRef.current) return

      if (key === 'n') {
        event.preventDefault()
        setActiveView('code')
        void createSessionFromShortcut()
        return
      }

      if (key === 'w') {
        event.preventDefault()
        closeCurrentSessionFromShortcut()
        return
      }

      if (key === 'k') {
        event.preventDefault()
        setSidebarOpen(true)
        requestAnimationFrame(() => {
          const searchInput = document.querySelector('#sidebar-search') as HTMLInputElement | null
          searchInput?.focus()
          searchInput?.select()
        })
        return
      }

      if (key === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        event.preventDefault()
        switchActiveTab(event.code === 'BracketLeft' ? -1 : 1)
        return
      }

      if (event.key === 'Enter') {
        const submitButton = document.querySelector<HTMLButtonElement>('[data-chat-submit-button="true"]:not(:disabled)')
        if (submitButton) {
          event.preventDefault()
          submitButton.click()
        }
        return
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeModal, setActiveView, setSidebarOpen, stopGeneration, toggleSidebar])
}

async function createSessionFromShortcut() {
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

function closeCurrentSessionFromShortcut() {
  const { activeTabId, tabs, closeTab } = useTabStore.getState()
  if (!activeTabId) return

  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  if (!activeTab || activeTab.type !== 'session') return

  const sessionState = useChatStore.getState().sessions[activeTabId]
  const isRunning = sessionState && sessionState.chatState !== 'idle'
  if (!isRunning) {
    useChatStore.getState().disconnectSession(activeTabId)
  }
  closeTab(activeTabId)
}

function switchActiveTab(direction: -1 | 1) {
  const { tabs, activeTabId, setActiveTab } = useTabStore.getState()
  if (tabs.length <= 1) return
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.sessionId === activeTabId))
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length
  const nextTab = tabs[nextIndex]
  if (!nextTab) return

  setActiveTab(nextTab.sessionId)
  if (nextTab.type === 'session') {
    useChatStore.getState().connectToSession(nextTab.sessionId)
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
}

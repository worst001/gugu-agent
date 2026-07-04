import { useEffect, useRef } from 'react'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import {
  closeCurrentTabFromAppAction,
  createSessionFromAppAction,
  focusSidebarSearchFromAppAction,
  openSettingsFromAppAction,
  quitAppFromAppAction,
  stopCurrentSessionFromAppAction,
  switchActiveTabFromAppAction,
  toggleFullscreenFromAppAction,
} from '../utils/appActions'

export function useKeyboardShortcuts() {
  const setActiveView = useUIStore((s) => s.setActiveView)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const closeModal = useUIStore((s) => s.closeModal)
  const activeModal = useUIStore((s) => s.activeModal)
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

      if (event.key === 'F11') {
        event.preventDefault()
        void toggleFullscreenFromAppAction()
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
        stopCurrentSessionFromAppAction()
        return
      }

      if (editableTarget || activeModalRef.current) return

      if (key === ',') {
        event.preventDefault()
        openSettingsFromAppAction('general')
        return
      }

      if (key === 'q') {
        event.preventDefault()
        void quitAppFromAppAction()
        return
      }

      if (key === 'n') {
        event.preventDefault()
        setActiveView('code')
        void createSessionFromAppAction()
        return
      }

      if (key === 'w') {
        event.preventDefault()
        closeCurrentTabFromAppAction()
        return
      }

      if (key === 'k') {
        event.preventDefault()
        focusSidebarSearchFromAppAction()
        return
      }

      if (key === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (event.shiftKey && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
        event.preventDefault()
        switchActiveTabFromAppAction(event.code === 'BracketLeft' ? -1 : 1)
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
  }, [closeModal, setActiveView, toggleSidebar])
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
}

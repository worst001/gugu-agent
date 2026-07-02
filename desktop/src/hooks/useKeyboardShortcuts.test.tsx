import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'

function ShortcutHost({ onSubmit }: { onSubmit?: () => void }) {
  useKeyboardShortcuts()
  return (
    <>
      <input id="sidebar-search" aria-label="Search sessions" />
      <textarea aria-label="Composer" />
      <button data-chat-submit-button="true" onClick={onSubmit}>
        Run
      </button>
    </>
  )
}

describe('useKeyboardShortcuts', () => {
  const createSession = vi.fn()
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const stopGeneration = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    createSession.mockReset()
    connectToSession.mockReset()
    disconnectSession.mockReset()
    stopGeneration.mockReset()
    addToast.mockReset()

    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      selectedProjects: [],
      availableProjects: [],
      newSessionWorkDir: null,
      createSession,
    } as Partial<ReturnType<typeof useSessionStore.getState>>)
    useChatStore.setState({
      sessions: {},
      connectToSession,
      disconnectSession,
      stopGeneration,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({
      sidebarOpen: true,
      activeModal: null,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  it('creates and opens a new session with Cmd/Ctrl+N', async () => {
    createSession.mockResolvedValue('session-new')
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'n', ctrlKey: true })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
      expect(connectToSession).toHaveBeenCalledWith('session-new')
    })
    expect(useTabStore.getState().activeTabId).toBe('session-new')
  })

  it('creates a new session in the sidebar-selected work directory with Cmd/Ctrl+N', async () => {
    createSession.mockResolvedValue('session-new')
    useSessionStore.setState({ newSessionWorkDir: '/workspace/selected-project' })
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'n', ctrlKey: true })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/selected-project')
      expect(connectToSession).toHaveBeenCalledWith('session-new')
    })
    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/selected-project')
  })

  it('closes the active idle session with Cmd/Ctrl+W', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-a', title: 'A', type: 'session', status: 'idle' },
        { sessionId: 'session-b', title: 'B', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-a',
    })
    useChatStore.setState({
      sessions: {
        'session-a': { chatState: 'idle' },
      },
    } as unknown as Partial<ReturnType<typeof useChatStore.getState>>)
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true })

    expect(disconnectSession).toHaveBeenCalledWith('session-a')
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['session-b'])
    expect(useTabStore.getState().activeTabId).toBe('session-b')
  })

  it('keeps a running session connected when Cmd/Ctrl+W closes its tab', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-a', title: 'A', type: 'session', status: 'running' },
        { sessionId: 'session-b', title: 'B', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-a',
    })
    useChatStore.setState({
      sessions: {
        'session-a': { chatState: 'thinking' },
      },
    } as unknown as Partial<ReturnType<typeof useChatStore.getState>>)
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true })

    expect(disconnectSession).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs.map((tab) => tab.sessionId)).toEqual(['session-b'])
    expect(useTabStore.getState().activeTabId).toBe('session-b')
  })

  it('toggles the sidebar with Cmd/Ctrl+B', () => {
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'b', ctrlKey: true })

    expect(useUIStore.getState().sidebarOpen).toBe(false)
  })

  it('opens the sidebar and focuses search with Cmd/Ctrl+K', async () => {
    useUIStore.setState({ sidebarOpen: false })
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(useUIStore.getState().sidebarOpen).toBe(true)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Search sessions'))
    })
  })

  it('stops only the active running session with Cmd/Ctrl+.', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-a', title: 'A', type: 'session', status: 'running' },
        { sessionId: 'session-b', title: 'B', type: 'session', status: 'running' },
      ],
      activeTabId: 'session-a',
    })
    useChatStore.setState({
      sessions: {
        'session-a': { chatState: 'thinking' },
        'session-b': { chatState: 'thinking' },
      },
    } as unknown as Partial<ReturnType<typeof useChatStore.getState>>)
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: '.', ctrlKey: true })

    expect(stopGeneration).toHaveBeenCalledWith('session-a')
    expect(stopGeneration).not.toHaveBeenCalledWith('session-b')
  })

  it('switches tabs with Cmd/Ctrl+Shift+brackets', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-a', title: 'A', type: 'session', status: 'idle' },
        { sessionId: 'session-b', title: 'B', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-a',
    })
    render(<ShortcutHost />)

    fireEvent.keyDown(document, { key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true })

    expect(useTabStore.getState().activeTabId).toBe('session-b')
    expect(connectToSession).toHaveBeenCalledWith('session-b')
  })

  it('runs the visible submit button with Cmd/Ctrl+Enter when focus is outside the composer', () => {
    const onSubmit = vi.fn()
    render(<ShortcutHost onSubmit={onSubmit} />)

    fireEvent.keyDown(document, { key: 'Enter', ctrlKey: true })

    expect(onSubmit).toHaveBeenCalled()
  })

  it('does not steal focus from editable fields with global navigation shortcuts', () => {
    render(<ShortcutHost />)
    const composer = screen.getByLabelText('Composer')
    composer.focus()

    fireEvent.keyDown(composer, { key: 'n', ctrlKey: true })
    fireEvent.keyDown(composer, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(composer, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(composer, { key: 'w', ctrlKey: true })

    expect(createSession).not.toHaveBeenCalled()
    expect(disconnectSession).not.toHaveBeenCalled()
    expect(useUIStore.getState().sidebarOpen).toBe(true)
    expect(document.activeElement).toBe(composer)
  })
})

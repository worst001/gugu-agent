import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AppMenu } from './AppMenu'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

vi.mock('./WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}))

describe('AppMenu', () => {
  const createSession = vi.fn()
  const connectToSession = vi.fn()

  beforeEach(() => {
    createSession.mockReset()
    connectToSession.mockReset()
    useSettingsStore.setState({ locale: 'en' })
    useSessionStore.setState({ createSession, newSessionWorkDir: null } as Partial<ReturnType<typeof useSessionStore.getState>>)
    useChatStore.setState({ sessions: {}, connectToSession } as Partial<ReturnType<typeof useChatStore.getState>>)
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ sidebarOpen: true, activeView: 'code', pendingSettingsTab: null, terminalDrawerOpen: false })
  })

  it('creates a session from the File menu', async () => {
    createSession.mockResolvedValue('session-new')
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /New Session/ }))

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
      expect(connectToSession).toHaveBeenCalledWith('session-new')
    })
    expect(useTabStore.getState().activeTabId).toBe('session-new')
  })

  it('renders window controls in the top menu bar', () => {
    render(<AppMenu />)

    expect(screen.getByTestId('app-menu')).toContainElement(screen.getByTestId('window-controls'))
  })

  it('toggles the sidebar from the top menu', () => {
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('expands the sidebar from the top menu when the sidebar is hidden', () => {
    useUIStore.setState({ sidebarOpen: false })
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

    expect(useUIStore.getState().sidebarOpen).toBe(true)
  })

  it('opens settings shortcuts from the Help menu', () => {
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard Shortcuts/ }))

    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('general')
  })

  it('opens the terminal drawer from the View menu', () => {
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Open Terminal/ }))

    expect(useUIStore.getState().terminalDrawerOpen).toBe(true)
    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(0)
  })
})

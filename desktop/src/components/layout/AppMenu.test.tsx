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
    useUIStore.setState({ sidebarOpen: true, activeView: 'code', pendingSettingsTab: null })
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

  it('opens settings shortcuts from the Help menu', () => {
    render(<AppMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard Shortcuts/ }))

    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('general')
  })
})

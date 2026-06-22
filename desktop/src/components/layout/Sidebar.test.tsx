import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('./ProjectFilter', () => ({
  ProjectFilter: () => <div data-testid="project-filter" />,
}))

vi.mock('./CapabilityBar', () => ({
  CapabilityBar: () => <div data-testid="capability-bar" />,
}))

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    reveal: vi.fn(),
  },
}))

vi.mock('../../i18n', () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.terminal': 'Terminal',
      'sidebar.settings': 'Settings',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noMatching': 'No matching sessions',
      'sidebar.sessionListFailed': 'Session list failed',
      'common.retry': 'Retry',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.rename': 'Rename',
      'common.remove': 'Remove',
      'sidebar.timeGroup.today': 'Today',
      'sidebar.timeGroup.yesterday': 'Yesterday',
      'sidebar.timeGroup.last7days': 'Last 7 Days',
      'sidebar.timeGroup.last30days': 'Last 30 Days',
      'sidebar.timeGroup.older': 'Older',
      'sidebar.missingDir': 'Missing',
      'sidebar.confirmDelete': 'Delete this session? This cannot be undone.',
      'sidebar.collapse': 'Collapse sidebar',
      'sidebar.expand': 'Expand sidebar',
      'sidebar.projectGroup.ungrouped': 'Uncategorized sessions',
      'sidebar.projectGroup.openInFolder': 'Open in folder',
      'sidebar.projectGroup.openFailed': 'Could not open this project folder.',
      'sidebar.projectGroup.removed': 'Project removed from the sidebar. Session history was not deleted.',
      'sidebar.sessionMeta.oneMessage': '1 msg',
      'sidebar.sessionMeta.messages': '2 msgs',
      'sidebar.sessionMeta.running': 'running 1m 15s',
      'sidebar.sessionMeta.waitingPermission': 'waiting',
    }

    return translations[key] ?? key
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { filesystemApi } from '../../api/filesystem'

function getProjectGroupButton(name: RegExp): HTMLElement {
  const button = screen.getAllByRole('button', { name })
    .find((element) => element.hasAttribute('aria-expanded'))
  expect(button).toBeTruthy()
  return button as HTMLElement
}

function queryProjectGroupButton(name: RegExp): HTMLElement | null {
  return screen.queryAllByRole('button', { name })
    .find((element) => element.hasAttribute('aria-expanded')) ?? null
}

describe('Sidebar', () => {
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const addToast = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    addToast.mockReset()
    vi.mocked(filesystemApi.reveal).mockReset()
    vi.mocked(filesystemApi.reveal).mockResolvedValue({
      ok: true,
      path: '/workspace/project-a',
      isDirectory: true,
    })

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      removedProjects: [],
      newSessionWorkDir: null,
      fetchSessions,
      createSession,
      deleteSession,
    })
    useChatStore.setState({
      connectToSession,
      disconnectSession,
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useUIStore.setState({
      sidebarOpen: true,
      addToast,
    } as Partial<ReturnType<typeof useUIStore.getState>>)
  })

  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('opens a new tab when creating a session from the sidebar', async () => {
    createSession.mockResolvedValue('session-new-1')

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalled()
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })

    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: 'session-new-1', title: 'New Session', type: 'session', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe('session-new-1')
    expect(screen.getByRole('complementary')).not.toHaveAttribute('data-tauri-drag-region')
  })

  it('creates a new session in the last selected project group directory', async () => {
    createSession.mockResolvedValue('session-new-1')
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/project-a',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.click(getProjectGroupButton(/project-a/))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/project-a')
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })
  })

  it('updates the new session directory when selecting another project group', async () => {
    createSession.mockResolvedValue('session-new-1')
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/project-a',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project-b',
          workDir: '/workspace/project-b',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.click(getProjectGroupButton(/project-b/))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/project-b')
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })
  })

  it('creates a new session in the last selected session directory', async () => {
    createSession.mockResolvedValue('session-new-1')
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/project-a',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project-b',
          workDir: '/workspace/project-b',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: /Investigate bug/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith('/workspace/project-b')
      expect(connectToSession).toHaveBeenCalledWith('session-new-1')
    })
  })

  it('opens each terminal click as a first-class app tab', () => {
    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    const terminalTabs = useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal')
    expect(terminalTabs).toHaveLength(2)
    expect(terminalTabs.map((tab) => tab.title)).toEqual(['Terminal 1', 'Terminal 2'])
    expect(useTabStore.getState().activeTabId).toBe(terminalTabs[1]!.sessionId)

    useTabStore.getState().closeTab(terminalTabs[0]!.sessionId)
    useTabStore.getState().openTerminalTab()

    expect(useTabStore.getState().tabs.filter((tab) => tab.type === 'terminal').map((tab) => tab.title)).toEqual([
      'Terminal 2',
      'Terminal 3',
    ])
  })

  it('does not render an external repository shortcut in the navigation header', () => {
    const { container } = render(<Sidebar />)

    expect(container.querySelector('a[href*="github.com"]')).not.toBeInTheDocument()
    expect(screen.queryByTitle('GitHub')).not.toBeInTheDocument()
  })

  it('groups sessions by project directory and collapses each project', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/project-a',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project-b',
          workDir: '/workspace/project-b',
          workDirExists: true,
        },
        {
          id: 'session-c',
          title: 'Loose note',
          createdAt: '2026-06-19T06:00:00.000Z',
          modifiedAt: '2026-06-19T08:00:00.000Z',
          messageCount: 0,
          projectPath: '',
          workDir: null,
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    expect(getProjectGroupButton(/project-a/)).toBeInTheDocument()
    expect(getProjectGroupButton(/project-b/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Uncategorized sessions/ })).toBeInTheDocument()
    expect(screen.getByText('/workspace/project-a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Build feature/ })).toHaveTextContent('2 msgs')

    fireEvent.click(getProjectGroupButton(/project-a/))

    expect(screen.queryByRole('button', { name: /Build feature/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Investigate bug/ })).toBeInTheDocument()
  })

  it('auto-expands collapsed project groups while searching', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/project-a',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.click(getProjectGroupButton(/project-a/))
    expect(screen.queryByRole('button', { name: /Build feature/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), { target: { value: 'build' } })

    expect(screen.getByRole('button', { name: /Build feature/ })).toBeInTheDocument()
  })

  it('removes a project group from the sidebar without deleting its sessions', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: 'project-b-key',
          workDir: '/workspace/project-b',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(getProjectGroupButton(/project-a/))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(queryProjectGroupButton(/project-a/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Build feature/ })).not.toBeInTheDocument()
    expect(getProjectGroupButton(/project-b/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Investigate bug/ })).toBeInTheDocument()
    expect(deleteSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessions.map((session) => session.id)).toEqual(['session-a', 'session-b'])
    expect(useSessionStore.getState().removedProjects).toEqual(['/workspace/project-a', 'project-a-key'])
    expect(addToast).toHaveBeenCalledWith({
      type: 'info',
      message: 'Project removed from the sidebar. Session history was not deleted.',
    })
  })

  it('opens a project group directory from the context menu', async () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(getProjectGroupButton(/project-a/))
    expect(screen.getByRole('button', { name: 'Open in folder' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in folder' }))
    })

    expect(filesystemApi.reveal).toHaveBeenCalledWith('/workspace/project-a')
    expect(screen.queryByRole('button', { name: 'Open in folder' })).not.toBeInTheDocument()
  })

  it('opens a session directory from the session context menu', async () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Build feature/ }))
    expect(screen.getByRole('button', { name: 'Open in folder' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in folder' }))
    })

    expect(filesystemApi.reveal).toHaveBeenCalledWith('/workspace/project-a')
  })

  it('shows a toast when opening a project group directory fails', async () => {
    vi.mocked(filesystemApi.reveal).mockRejectedValueOnce(new Error('missing'))
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.contextMenu(getProjectGroupButton(/project-a/))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open in folder' }))
    })

    expect(addToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'Could not open this project folder.',
    })
  })

  it('finds sessions by project directory while searching', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: '/workspace/client-dashboard',
          workDir: '/workspace/client-dashboard',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/api-service',
          workDir: '/workspace/api-service',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
      target: { value: 'client-dashboard' },
    })

    expect(screen.getByRole('button', { name: /Build feature/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Investigate bug/ })).not.toBeInTheDocument()
  })

  it('shows a toast when session creation fails', async () => {
    createSession.mockRejectedValue(new Error('boom'))

    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith({
        type: 'error',
        message: 'boom',
      })
    })

    expect(useTabStore.getState().tabs).toEqual([])
  })

  it('requires confirmation before deleting a session from the sidebar', async () => {
    deleteSession.mockResolvedValue(undefined)
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-1',
          title: 'Open Session',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-1', title: 'Open Session', type: 'session', status: 'idle' }],
      activeTabId: 'session-1',
    })

    render(<Sidebar />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /Open Session/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteSession).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Delete this session? This cannot be undone.')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    })

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith('session-1')
      expect(disconnectSession).toHaveBeenCalledWith('session-1')
    })

    expect(useTabStore.getState().tabs).toEqual([])
    expect(useTabStore.getState().activeTabId).toBeNull()
  })

  it('collapses into an icon rail and expands back', async () => {
    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    })

    expect(useUIStore.getState().sidebarOpen).toBe(false)
    expect(screen.queryByPlaceholderText('Search sessions')).not.toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'closed')
    expect(screen.getByTestId('sidebar-expand-button')).toHaveClass('sidebar-toggle-button--collapsed')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    })

    expect(useUIStore.getState().sidebarOpen).toBe(true)
    expect(screen.getByPlaceholderText('Search sessions')).toBeInTheDocument()
    expect(screen.getByRole('complementary')).toHaveAttribute('data-state', 'open')
  })

  it('keeps the project filter section overflow visible for dropdown menus', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-project-filter-section')).toHaveStyle({ overflow: 'visible' })
    expect(screen.getByTestId('sidebar-project-filter-section')).toHaveClass('relative', 'z-20')
  })

  it('keeps the session list section in a constrained flex column for scrolling', () => {
    render(<Sidebar />)

    expect(screen.getByTestId('sidebar-session-list-section')).toHaveClass('flex', 'flex-1', 'min-h-0', 'flex-col')
  })
})

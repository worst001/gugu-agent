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
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      'sidebar.newSession': 'New Session',
      'sidebar.workType.label': 'Choose new-session work type',
      'sidebar.workType.newSessionDefault': 'Default for new sessions',
      'sidebar.workType.smart': 'Smart recommendation',
      'sidebar.workType.smartDescription': 'Choose a professional team from your request.',
      'sidebar.workType.chat': 'General chat',
      'sidebar.workType.chatDescription': 'Talk freely without creating a professional task.',
      'sidebar.workType.software': 'Software delivery',
      'sidebar.workType.softwareDescription': 'Fix, build, test, and review software.',
      'sidebar.workType.knowledge': 'Knowledge delivery',
      'sidebar.workType.knowledgeDescription': 'Research, organize, analyze, and deliver verified work.',
      'sidebar.workType.shortVideo': 'Short-video production',
      'sidebar.workType.shortVideoDescription': 'Topics, scripts, storyboards, and platform adaptation.',
      'sidebar.scheduled': 'Scheduled',
      'sidebar.terminal': 'Terminal',
      'sidebar.archivedSessions': 'Archived conversations',
      'sidebar.settings': 'Settings',
      'sidebar.aiTeam': 'AI Team',
      'sidebar.searchPlaceholder': 'Search sessions',
      'sidebar.noSessions': 'No sessions',
      'sidebar.noArchivedSessions': 'No archived conversations',
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
      'sidebar.pinned': 'Pinned',
      'sidebar.pinnedConversations': 'Pinned conversations',
      'sidebar.projects': 'Projects',
      'sidebar.projectKnowledge': 'View project knowledge',
      'projectKnowledge.title': 'Project Knowledge',
      'sidebar.projectGroup.ungrouped': 'Uncategorized sessions',
      'sidebar.projectGroup.openInFolder': 'Open in folder',
      'sidebar.projectGroup.openFailed': 'Could not open this project folder.',
      'sidebar.projectGroup.confirmRemoveTitle': 'Remove {name}?',
      'sidebar.projectGroup.confirmRemoveBody': 'This removes the project from the Gugu sidebar. Files on disk will not be deleted.',
      'sidebar.projectGroup.removed': 'Project removed from the sidebar. Session history was not deleted.',
      'sidebar.projectGroup.pin': 'Pin project',
      'sidebar.projectGroup.unpin': 'Unpin project',
      'sidebar.projectGroup.archiveSessions': 'Archive project sessions',
      'sidebar.session.pin': 'Pin conversation',
      'sidebar.session.unpin': 'Unpin conversation',
      'sidebar.session.pinned': 'Pinned',
      'sidebar.session.archive': 'Archive conversation',
      'sidebar.session.unarchive': 'Unarchive conversation',
      'sidebar.session.markUnread': 'Mark unread',
      'sidebar.session.markRead': 'Mark read',
      'sidebar.session.updateFailed': 'Could not update the session state.',
      'sidebar.session.copyId': 'Copy session ID',
      'sidebar.session.copyIdSuccess': 'Session ID copied.',
      'sidebar.session.copyIdFailed': 'Could not copy session ID.',
      'sidebar.sessionMeta.oneMessage': '1 msg',
      'sidebar.sessionMeta.messages': '2 msgs',
      'sidebar.sessionMeta.running': 'running 1m 15s',
      'sidebar.sessionMeta.waitingPermission': 'waiting',
    }

    return (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
  },
}))

import { Sidebar } from './Sidebar'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { DRAFT_TAB_ID, useTabStore } from '../../stores/tabStore'
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

function getProjectGroupTitles(): string[] {
  return screen.getAllByRole('button')
    .filter((element) => (
      element.hasAttribute('aria-expanded') &&
      !element.hasAttribute('aria-haspopup')
    ))
    .map((element) => element.textContent ?? '')
}

describe('Sidebar', () => {
  const connectToSession = vi.fn()
  const disconnectSession = vi.fn()
  const fetchSessions = vi.fn()
  const createSession = vi.fn()
  const deleteSession = vi.fn()
  const updateSessionMeta = vi.fn()
  const addToast = vi.fn()
  const writeClipboard = vi.fn()

  beforeEach(() => {
    connectToSession.mockReset()
    disconnectSession.mockReset()
    fetchSessions.mockReset()
    createSession.mockReset()
    deleteSession.mockReset()
    updateSessionMeta.mockReset()
    updateSessionMeta.mockResolvedValue(undefined)
    addToast.mockReset()
    writeClipboard.mockReset()
    writeClipboard.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeClipboard },
      configurable: true,
    })
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
      pinnedProjects: [],
      newSessionWorkDir: null,
      newSessionWorkType: 'smart',
      fetchSessions,
      createSession,
      deleteSession,
      updateSessionMeta,
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

  it('opens a local draft from the sidebar without creating a session', async () => {
    render(<Sidebar />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New Session' }))
    })

    expect(createSession).not.toHaveBeenCalled()
    expect(connectToSession).not.toHaveBeenCalled()
    expect(useTabStore.getState().tabs).toEqual([
      { sessionId: DRAFT_TAB_ID, title: 'New Session', type: 'draft', status: 'idle' },
    ])
    expect(useTabStore.getState().activeTabId).toBe(DRAFT_TAB_ID)
    expect(screen.getByRole('complementary')).not.toHaveAttribute('data-tauri-drag-region')
  })

  it('changes only the new-session default and opens a draft from an active session', () => {
    useTabStore.setState({
      tabs: [{
        sessionId: 'session-existing',
        title: 'Existing task',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'session-existing',
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose new-session work type' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Knowledge delivery/ }))

    expect(useSessionStore.getState().newSessionWorkType).toBe('knowledge_delivery')
    expect(useTabStore.getState().activeTabId).toBe(DRAFT_TAB_ID)
    expect(useTabStore.getState().tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: 'session-existing', type: 'session' }),
      expect.objectContaining({ sessionId: DRAFT_TAB_ID, type: 'draft' }),
    ]))
    expect(createSession).not.toHaveBeenCalled()
    expect(connectToSession).not.toHaveBeenCalled()
  })

  it('opens a draft in the last selected project group directory', async () => {
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

    expect(createSession).not.toHaveBeenCalled()
    expect(connectToSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/project-a')
  })

  it('opens project knowledge from the project group header', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'View project knowledge' }))

    const activeTab = useTabStore.getState().tabs[0]
    expect(activeTab).toMatchObject({
      title: 'project-a · Project Knowledge',
      type: 'knowledge',
    })
    expect(decodeURIComponent(activeTab!.sessionId)).toContain('/workspace/project-a')
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

    expect(createSession).not.toHaveBeenCalled()
    expect(connectToSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/project-b')
  })

  it('opens a draft in the last selected session directory', async () => {
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

    expect(createSession).not.toHaveBeenCalled()
    expect(connectToSession).toHaveBeenCalledWith('session-b')
    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/project-b')
  })

  it('does not render terminal in the sidebar navigation header', () => {
    render(<Sidebar />)

    expect(screen.queryByRole('button', { name: 'Terminal' })).not.toBeInTheDocument()
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

    const dialog = screen.getByRole('dialog', { name: 'Remove project-a?' })
    expect(within(dialog).getByText('This removes the project from the Gugu sidebar. Files on disk will not be deleted.')).toBeInTheDocument()
    expect(getProjectGroupButton(/project-a/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Build feature/ })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

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

  it('keeps a removed project hidden when the session path format changes', () => {
    useSessionStore.setState({
      removedProjects: ['d:/workspace/project-a'],
      sessions: [
        {
          id: 'session-a',
          title: 'Build feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: 'D:\\Workspace\\Project-A',
          workDirExists: true,
        },
        {
          id: 'session-b',
          title: 'Investigate bug',
          createdAt: '2026-06-19T07:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 1,
          projectPath: 'project-b-key',
          workDir: 'D:\\Workspace\\Project-B',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    expect(queryProjectGroupButton(/Project-A/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Build feature/ })).not.toBeInTheDocument()
    expect(getProjectGroupButton(/Project-B/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Investigate bug/ })).toBeInTheDocument()
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

  it('copies a session id from the session context menu', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy session ID' }))
    })

    expect(writeClipboard).toHaveBeenCalledWith('session-a')
    expect(addToast).toHaveBeenCalledWith({
      type: 'success',
      message: 'Session ID copied.',
    })
  })

  it('updates session sidebar metadata from the session context menu', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pin conversation' }))
    })

    expect(updateSessionMeta).toHaveBeenCalledWith('session-a', { pinned: true })

    fireEvent.contextMenu(screen.getByRole('button', { name: /Build feature/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Archive conversation' }))
    })

    expect(updateSessionMeta).toHaveBeenCalledWith('session-a', { archived: true })

    fireEvent.contextMenu(screen.getByRole('button', { name: /Build feature/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }))
    })

    expect(updateSessionMeta).toHaveBeenCalledWith('session-a', { unread: true })
  })

  it('hides archived sessions by default but includes them while searching', () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Archived feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
          archived: true,
        },
        {
          id: 'session-b',
          title: 'Visible feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    expect(screen.queryByRole('button', { name: /Archived feature/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Visible feature/ })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search sessions'), {
      target: { value: 'archived' },
    })

    expect(screen.getByRole('button', { name: /Archived feature/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Visible feature/ })).not.toBeInTheDocument()
  })

  it('shows archived sessions from the archived conversations entry', async () => {
    useSessionStore.setState({
      sessions: [
        {
          id: 'session-a',
          title: 'Archived feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
          archived: true,
        },
        {
          id: 'session-b',
          title: 'Visible feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
          messageCount: 2,
          projectPath: 'project-a-key',
          workDir: '/workspace/project-a',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Archived conversations' }))

    expect(screen.getByRole('button', { name: /Archived feature/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Visible feature/ })).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: /Archived feature/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unarchive conversation' }))
    })

    expect(updateSessionMeta).toHaveBeenCalledWith('session-a', { archived: false })
  })

  it('pins a project group without pinning every session in that project', async () => {
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
          title: 'Investigate feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T10:00:00.000Z',
          messageCount: 2,
          projectPath: 'project-b-key',
          workDir: '/workspace/project-b',
          workDirExists: true,
        },
      ],
    })

    render(<Sidebar />)

    expect(screen.queryByText('Pinned')).not.toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(getProjectGroupTitles()[0]).toContain('project-b')

    fireEvent.contextMenu(getProjectGroupButton(/project-a/))
    fireEvent.click(screen.getByRole('button', { name: 'Pin project' }))

    expect(useSessionStore.getState().pinnedProjects).toEqual(['/workspace/project-a', 'project-a-key'])
    expect(updateSessionMeta).not.toHaveBeenCalledWith('session-a', { pinned: true })
    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(getProjectGroupTitles()[0]).toContain('project-a')

    fireEvent.contextMenu(getProjectGroupButton(/project-a/))
    fireEvent.click(screen.getByRole('button', { name: 'Unpin project' }))

    expect(useSessionStore.getState().pinnedProjects).toEqual([])
  })

  it('archives all sessions in a project from the project context menu', async () => {
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
          title: 'Investigate feature',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T08:30:00.000Z',
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
      fireEvent.click(screen.getByRole('button', { name: 'Archive project sessions' }))
    })

    expect(updateSessionMeta).toHaveBeenCalledWith('session-a', { archived: true })
    expect(updateSessionMeta).toHaveBeenCalledWith('session-b', { archived: true })
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

  it('reuses the existing draft instead of opening duplicates', () => {
    useSessionStore.setState({ newSessionWorkDir: '/workspace/draft-project' })
    useTabStore.setState({
      tabs: [{ sessionId: DRAFT_TAB_ID, title: 'New Session', type: 'draft', status: 'idle' }],
      activeTabId: DRAFT_TAB_ID,
    })

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'New Session' }))

    expect(useTabStore.getState().tabs).toHaveLength(1)
    expect(useTabStore.getState().activeTabId).toBe(DRAFT_TAB_ID)
    expect(createSession).not.toHaveBeenCalled()
    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/draft-project')
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

  it('leaves sidebar toggling to the top app menu', () => {
    render(<Sidebar />)

    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument()
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

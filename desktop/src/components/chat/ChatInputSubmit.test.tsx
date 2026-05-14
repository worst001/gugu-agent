import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    create: vi.fn(async () => ({ sessionId: 'created-image-session' })),
    list: vi.fn(async () => ({ sessions: [] })),
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
    getGitInfo: vi.fn(async () => ({
      branch: 'main',
      repoName: 'project',
      workDir: '/workspace/project',
      changedFiles: 0,
    })),
  },
}))

vi.mock('../../api/settings', () => ({
  settingsApi: {
    getUser: vi.fn(async () => ({ defaultSessionWorkDir: '/workspace/project' })),
    updateUser: vi.fn(async () => ({})),
  },
}))

vi.mock('../../api/skills', () => ({
  skillsApi: {
    list: vi.fn(async () => ({ skills: [] })),
  },
}))

vi.mock('../layout/CapabilityBar', () => ({
  CapabilityBar: () => null,
}))

import { ContentRouter } from '../layout/ContentRouter'
import { ActiveSession } from '../../pages/ActiveSession'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

function seedEmptySession(sessionId: string) {
  useSettingsStore.setState({ locale: 'en' })
  useTabStore.setState({
    tabs: [{ sessionId, title: 'New Session', type: 'session', status: 'idle' }],
    activeTabId: sessionId,
  })
  useSessionStore.setState({
    sessions: [{
      id: sessionId,
      title: 'New Session',
      createdAt: '2026-05-15T00:00:00.000Z',
      modifiedAt: '2026-05-15T00:00:00.000Z',
      messageCount: 0,
      projectPath: '/workspace/project',
      workDir: '/workspace/project',
      workDirExists: true,
    }],
    activeSessionId: sessionId,
    isLoading: false,
    error: null,
  })
  useChatStore.setState({ sessions: {} })
}

describe('ChatInput submit', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('optimistically shows image and text messages from an empty session', async () => {
    seedEmptySession('empty-image-session')
    const { container } = render(<ActiveSession />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image-bytes'], 'whale.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('img', { name: 'whale.png' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'what is this', selectionStart: 12 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('what is this')).toBeInTheDocument()
    })
    expect(screen.getByRole('img', { name: 'whale.png' })).toBeInTheDocument()
    expect(screen.queryByText('Start a fresh coding session. Claude is ready to help you build, debug, and architect your project.')).not.toBeInTheDocument()
  })

  it('creates a session from the empty composer and preserves the submitted image and text', async () => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({ sessions: {} })

    const { container } = render(<ContentRouter />)
    expect(screen.getByRole('heading', { name: 'New session' })).toBeInTheDocument()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image-bytes'], 'whale.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByRole('img', { name: 'whale.png' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'what is this', selectionStart: 12 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(useTabStore.getState().activeTabId).toBe('created-image-session')
      expect(screen.getByText('what is this')).toBeInTheDocument()
    })
    expect(screen.getByRole('img', { name: 'whale.png' })).toBeInTheDocument()
    expect(screen.queryByText('Start a fresh coding session. Claude is ready to help you build, debug, and architect your project.')).not.toBeInTheDocument()
  })
})

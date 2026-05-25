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
import { sessionsApi } from '../../api/sessions'
import { wsManager } from '../../api/websocket'
import { ActiveSession } from '../../pages/ActiveSession'
import { DRAFT_AGENT_RUN_MODE_KEY, useAgentRunModeStore } from '../../stores/agentRunModeStore'
import { useChatStore } from '../../stores/chatStore'
import { useCeWorkflowRoleStore } from '../../stores/ceWorkflowRoleStore'
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
    useAgentRunModeStore.setState({ selections: {} })
    useCeWorkflowRoleStore.setState({ selections: {} })
  })

  function getLastUserMessagePayload() {
    const userMessageCalls = vi.mocked(wsManager.send).mock.calls.filter(([, payload]) => {
      return typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'user_message'
    })
    return userMessageCalls[userMessageCalls.length - 1]?.[1] as
      | { type: 'user_message'; content: string; ceModelPreference?: string }
      | undefined
  }

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
    expect(screen.queryByText('Start a fresh coding session. Gugu is ready to help you build, debug, and architect your project.')).not.toBeInTheDocument()

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toBe('what is this')
    expect(payload?.content).not.toContain('CE automation')
    expect(payload?.ceModelPreference).toBeUndefined()
  })

  it('wraps messages with plan mode scaffolding when the plan toggle is selected', async () => {
    seedEmptySession('plan-mode-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'plan the composer modes', selectionStart: 23 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('plan the composer modes')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Agent mode: plan]')
    expect(payload?.content).toContain('/ce-plan')
    expect(payload?.content).toContain('User message:\nplan the composer modes')
    expect(payload?.ceModelPreference).toBe('strong')
    expect(useAgentRunModeStore.getState().selections['plan-mode-session']).toBe('normal')
  })

  it('uses a matching CE pre-route in default mode when a relevant skill is available', async () => {
    vi.mocked(sessionsApi.getSlashCommands).mockResolvedValueOnce({
      commands: [{
        name: 'compound-engineering:ce-frontend-design',
        description: 'Build web interfaces with genuine design quality.',
      }],
    })
    seedEmptySession('default-ce-router-session')
    render(<ActiveSession />)

    await waitFor(() => {
      expect(useChatStore.getState().sessions['default-ce-router-session']?.slashCommands).toEqual([
        expect.objectContaining({ name: 'compound-engineering:ce-frontend-design' }),
      ])
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'UI feels ugly, help me improve the toggle', selectionStart: 43 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('UI feels ugly, help me improve the toggle')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Agent mode: default + CE pre-route]')
    expect(payload?.content).toContain('compound-engineering:ce-frontend-design')
    expect(payload?.content).toContain('Use at most this one CE Skill')
    expect(payload?.ceModelPreference).toBe('strong')
  })

  it('enables CE workflow mode with the light iteration preset by default', async () => {
    seedEmptySession('ce-mode-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    fireEvent.click(screen.getByRole('button', { name: 'CE' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'fix the failing test', selectionStart: 20 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('fix the failing test')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Workflow: quick iteration]')
    expect(payload?.content).toContain('CE automation (binding)')
    expect(payload?.content).not.toContain('/ce-plan')
    expect(payload?.ceModelPreference).toBe('strong')
  })

  it('switches from plan to CE mode and uses the selected CE workflow', async () => {
    seedEmptySession('ce-workflow-selection-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'CE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Light iteration' }))
    fireEvent.click(screen.getByRole('button', { name: /Standard delivery/ }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'build a normal feature', selectionStart: 22 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('build a normal feature')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Workflow: standard delivery]')
    expect(payload?.content).toContain('/ce-plan')
    expect(payload?.ceModelPreference).toBe('strong')
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
    expect(screen.queryByText('Start a fresh coding session. Gugu is ready to help you build, debug, and architect your project.')).not.toBeInTheDocument()
  })

  it('resets draft plan mode after creating a new session from the empty composer', async () => {
    useSettingsStore.setState({ locale: 'en' })
    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({ sessions: {} })
    useAgentRunModeStore.getState().setMode(DRAFT_AGENT_RUN_MODE_KEY, 'plan')

    render(<ContentRouter />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'plan a landing page', selectionStart: 19 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('plan a landing page')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Agent mode: plan]')
    expect(useAgentRunModeStore.getState().selections['created-image-session']).toBe('normal')
    expect(useAgentRunModeStore.getState().selections[DRAFT_AGENT_RUN_MODE_KEY]).toBe('normal')
  })
})

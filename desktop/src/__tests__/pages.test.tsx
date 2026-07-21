import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

import { skillsApi } from '../api/skills'
import { mcpApi } from '../api/mcp'
import { promptOptimizeApi } from '../api/promptOptimize'
import { audioTranscriptionApi } from '../api/audioTranscription'
import { agentTasksApi } from '../api/agentTasks'
import { useUIStore } from '../stores/uiStore'

vi.mock('../api/skills', () => ({
  skillsApi: {
    list: vi.fn(async () => ({ skills: [] })),
  },
}))

vi.mock('../api/mcp', () => ({
  mcpApi: {
    list: vi.fn(async () => ({ servers: [] })),
    status: vi.fn(async (name: string) => ({
      server: {
        name,
        scope: 'user',
        transport: 'http',
        enabled: true,
        status: 'connected',
        statusLabel: 'Connected',
        configLocation: 'User',
        summary: 'https://mcp.example.com/mcp',
        canEdit: true,
        canRemove: true,
        canReconnect: true,
        canToggle: true,
        config: { type: 'http', url: 'https://mcp.example.com/mcp', headers: {} },
      },
    })),
  },
}))

vi.mock('../api/promptOptimize', () => ({
  promptOptimizeApi: {
    optimize: vi.fn(),
  },
}))

vi.mock('../api/audioTranscription', () => ({
  audioTranscriptionApi: {
    status: vi.fn(),
    transcribe: vi.fn(),
  },
}))

vi.mock('../components/layout/CapabilityBar', () => ({
  CapabilityBar: () => <div data-testid="capability-bar" />,
}))

// Import all pages
import { EmptySession } from '../pages/EmptySession'
import { ActiveSession } from '../pages/ActiveSession'
import { AgentTeams } from '../pages/AgentTeams'
import { ScheduledTasks } from '../pages/ScheduledTasks'
import { ToolInspection } from '../pages/ToolInspection'

// Layout components (chrome is now here, not in pages)
import { Sidebar } from '../components/layout/Sidebar'
import { UserMessage } from '../components/chat/UserMessage'
import { COMPOSER_DRAFTS_STORAGE_KEY } from '../components/chat/composerDrafts'
import { useChatStore } from '../stores/chatStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAgentTaskStore } from '../stores/agentTaskStore'
import { useDesktopProfileStore } from '../stores/desktopProfileStore'
import type { AgentTask } from '../types/agentTask'
import type { DesktopProfileBundle } from '../types/desktopProfile'

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  useAgentTaskStore.setState({
    capabilityLoaded: true,
    enabled: false,
    roles: [],
    rolePacks: [],
    teams: [],
  })
  useDesktopProfileStore.setState({ bundle: null, lastError: null })
  useSessionStore.setState({ newSessionWorkType: 'smart' })
  localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined })
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
  Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
})

/**
 * Core rendering tests: content-only pages must render without crashing
 * and contain key structural elements from the prototype.
 */
describe('Content-only pages render without errors', () => {
  it('EmptySession slash picker includes dynamic skills before the first session starts', async () => {
    vi.mocked(skillsApi.list).mockResolvedValueOnce({
      skills: [
        {
          name: 'lark-mail',
          description: 'Draft, send, and search emails',
          source: 'user',
          userInvocable: true,
          contentLength: 120,
          hasDirectory: true,
        },
        {
          name: 'internal-only',
          description: 'Should stay hidden',
          source: 'user',
          userInvocable: false,
          contentLength: 60,
          hasDirectory: true,
        },
      ],
    })

    render(<EmptySession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '/', selectionStart: 1 },
    })

    expect(await screen.findByText('/lark-mail')).toBeInTheDocument()
    expect(screen.getByText('/mcp')).toBeInTheDocument()
    expect(screen.getByText('/skills')).toBeInTheDocument()
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/plugin')).toBeInTheDocument()
    expect(screen.getByText('/context')).toBeInTheDocument()
    expect(screen.queryByText('/plugins')).not.toBeInTheDocument()
    expect(screen.queryByText('/internal-only')).not.toBeInTheDocument()
  })

  it('EmptySession renders mascot and composer', () => {
    const { container } = render(<EmptySession />)
    expect(container.querySelector('textarea')).toBeInTheDocument()
    expect(container.querySelector('[data-chat-submit-button="true"]')).toBeInTheDocument()
    expect(container.innerHTML).toContain('New session')
    expect(container.innerHTML).toContain('Ask anything')
  })

  it('EmptySession exposes the office toolbox in the default composer', () => {
    render(<EmptySession />)

    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    expect(screen.getByRole('button', { name: 'Analyze spreadsheet' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze spreadsheet' }))
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Say what data or metrics should be analyzed...',
    )
    expect(screen.getByRole('button', { name: 'Clear quick action' })).toBeInTheDocument()
  })

  it('uses a quick action to recommend a task without overriding a manual choice', () => {
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      roles: ['knowledge_worker', 'short_video_operator'],
      teams: [
        {
          id: 'knowledge_delivery',
          version: '1.0.0',
          displayName: 'Knowledge delivery team',
          mission: '',
          primaryRole: 'knowledge_worker',
          taskTemplates: [{
            id: 'analysis_report',
            version: '1.0.0',
            displayName: 'Analysis report',
            description: '',
            kind: 'delivery',
            primaryRole: 'knowledge_worker',
          }],
        },
        {
          id: 'short_video_production',
          version: '1.0.0',
          displayName: 'Short-video production team',
          mission: '',
          primaryRole: 'short_video_operator',
          taskTemplates: [{
            id: 'script_storyboard',
            version: '1.0.0',
            displayName: 'Script and storyboard',
            description: '',
            kind: 'delivery',
            primaryRole: 'short_video_operator',
          }],
        },
      ],
    })

    render(<EmptySession />)

    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze spreadsheet' }))

    expect(screen.getByText(
      /Will run as Knowledge delivery team \/ Analysis report/,
    )).toBeInTheDocument()
    expect(screen.queryByRole('combobox', {
      name: 'Professional team and quick task',
    })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const selection = screen.getByRole('combobox', {
      name: 'Professional team and quick task',
    })
    expect(selection).toHaveValue('auto')
    expect(screen.getByRole('option', {
      name: 'Automatic: Knowledge delivery team / Analysis report',
    })).toBeInTheDocument()

    fireEvent.change(selection, {
      target: { value: 'short_video_production:script_storyboard' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create presentation' }))

    expect(selection).toHaveValue(
      'short_video_production:script_storyboard',
    )

  })

  it('EmptySession starter tasks fill the composer without auto-running', () => {
    render(<EmptySession />)

    expect(screen.getByText('Organize docs')).toBeInTheDocument()
    expect(screen.getByText('Analyze sheet')).toBeInTheDocument()
    expect(screen.getByText('Write email')).toBeInTheDocument()
    expect(screen.getByText('Fix code')).toBeInTheDocument()
    expect(screen.getByText('Read folder')).toBeInTheDocument()
    expect(screen.getByText('Use computer')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Analyze sheet'))

    expect(screen.getByRole('textbox')).toHaveValue(
      'Help me analyze this spreadsheet. First inspect fields, missing values, duplicates, and outliers, then give conclusions.',
    )
    expect(screen.queryByText('Analyze sheet')).not.toBeInTheDocument()
  })

  it('uses one combined task selector and never exposes legacy assistants', () => {
    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      roles: ['software_engineer', 'short_video_operator'],
      teams: [
        {
          id: 'software_delivery',
          version: '1.0.0',
          displayName: 'Software delivery team',
          mission: 'Deliver software.',
          primaryRole: 'software_engineer',
          taskTemplates: [{
            id: 'feature_delivery',
            version: '1.0.0',
            displayName: 'Build a feature',
            description: '',
            kind: 'delivery',
            primaryRole: 'software_engineer',
          }],
        },
        {
          id: 'short_video_production',
          version: '1.0.0',
          displayName: 'Short-video production team',
          mission: 'Deliver short videos.',
          primaryRole: 'short_video_operator',
          taskTemplates: [{
            id: 'script_storyboard',
            version: '1.0.0',
            displayName: 'Script and storyboard',
            description: '',
            kind: 'delivery',
            primaryRole: 'short_video_operator',
          }],
        },
      ],
    })
    useDesktopProfileStore.setState({
      bundle: {
        workspaceState: {
          assistants: {
            custom: [{
              id: 'custom-launch',
              name: 'Launch operator',
              description: '',
              baseRole: 'short_video_operator',
              instructions: 'Check hooks and pacing.',
              createdAt: '2026-07-13T00:00:00.000Z',
              updatedAt: '2026-07-13T00:00:00.000Z',
            }],
          },
        },
      } as DesktopProfileBundle,
    })

    render(<EmptySession />)

    const request = 'Create three Douyin short-video scripts and storyboards'
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: request, selectionStart: request.length },
    })

    expect(screen.getByText(
      /Will run as Short-video production team \/ Script and storyboard/,
    )).toBeInTheDocument()
    expect(screen.queryByRole('combobox', {
      name: 'Professional team and quick task',
    })).not.toBeInTheDocument()
    expect(screen.getByText(/Owned by Short Video Operator/)).toBeInTheDocument()
    expect(screen.getByText(
      'Share the product, audience, and platform; the team will create topics, scripts, and storyboards.',
    )).toBeInTheDocument()
    expect(screen.queryByText('Launch operator')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    const selection = screen.getByRole('combobox', {
      name: 'Professional team and quick task',
    })
    expect(selection).toHaveValue('auto')

    fireEvent.change(selection, {
      target: { value: 'software_delivery:feature_delivery' },
    })
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: 'Create another short-video script',
        selectionStart: 33,
      },
    })

    expect(selection).toHaveValue('software_delivery:feature_delivery')
    expect(screen.getByText(/Owned by Software Engineer/)).toBeInTheDocument()

    fireEvent.change(selection, { target: { value: 'auto' } })
    expect(screen.getByText(/Owned by Short Video Operator/)).toBeInTheDocument()

  })

  it('creates the durable task before activation and restores the draft when creation fails', async () => {
    const originalCreateSession = useSessionStore.getState().createSession
    const originalConnectToSession = useChatStore.getState().connectToSession
    const originalSendMessage = useChatStore.getState().sendMessage
    const originalDeleteSession = useSessionStore.getState().deleteSession
    const createSession = vi.fn(async () => 'smart-session')
    const connectToSession = vi.fn()
    const sendMessage = vi.fn()
    const now = '2026-07-19T00:00:00.000Z'
    const task = {
      schemaVersion: 1,
      id: 'task-created-before-send',
      runId: 'run-created-before-send',
      attempt: 1,
      sessionId: 'smart-session',
      role: 'knowledge_worker',
      roleVersion: '1.0.0',
      title: 'Prepare a verified report',
      goal: 'Prepare a verified report',
      constraints: [],
      workspacePath: 'D:/workspace',
      status: 'intake',
      requiredChecks: [],
      warnings: [],
      recoverable: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    } as AgentTask
    const createTask = vi.spyOn(agentTasksApi, 'create')
      .mockResolvedValueOnce({ task })

    useAgentTaskStore.setState({
      capabilityLoaded: true,
      enabled: true,
      roles: ['software_engineer', 'knowledge_worker'],
      teams: [{
        id: 'knowledge_delivery',
        version: '1.0.0',
        displayName: 'Knowledge delivery team',
        mission: 'Deliver source-backed work.',
        primaryRole: 'knowledge_worker',
        taskTemplates: [{
          id: 'analysis_report',
          version: '1.0.0',
          displayName: 'Analysis report',
          description: 'Prepare a verified report.',
          kind: 'delivery',
          primaryRole: 'knowledge_worker',
        }],
      }],
    })
    useSessionStore.setState({
      sessions: [{
        id: 'smart-session',
        title: 'New Session',
        createdAt: now,
        modifiedAt: now,
        messageCount: 0,
        projectPath: 'D:/workspace',
        workDir: 'D:/workspace',
        workDirExists: true,
      }],
      activeSessionId: null,
      createSession,
    })
    useChatStore.setState({ connectToSession, sendMessage })
    useTabStore.setState({ tabs: [], activeTabId: null })

    const { container } = render(<EmptySession />)
    useSessionStore.getState().setNewSessionWorkType('knowledge_delivery')
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: 'Prepare a verified report',
        selectionStart: 25,
      },
    })

    fireEvent.click(
      container.querySelector('[data-chat-submit-button="true"]') as HTMLButtonElement,
    )

    expect(createSession).toHaveBeenCalled()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(createTask).toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalled()
    expect(createTask).toHaveBeenCalledWith({
      title: 'Prepare a verified report',
      goal: 'Prepare a verified report',
      sessionId: 'smart-session',
      workspacePath: 'D:/workspace',
      teamId: 'knowledge_delivery',
      taskTemplateId: 'analysis_report',
      role: 'knowledge_worker',
    })
    expect(createTask.mock.invocationCallOrder[0])
      .toBeLessThan(sendMessage.mock.invocationCallOrder[0]!)
    expect(sendMessage.mock.calls[0]?.[1]).toContain('task-created-before-send')
    expect(sendMessage.mock.calls[0]?.[1]).toContain('Do not create another task')
    const failedCreateSession = vi.fn(async () => {
      useSessionStore.setState((state) => ({
        sessions: [
          {
            id: 'failed-session',
            title: 'New Session',
            createdAt: now,
            modifiedAt: now,
            messageCount: 0,
            projectPath: 'D:/workspace',
            workDir: 'D:/workspace',
            workDirExists: true,
          },
          ...state.sessions,
        ],
        activeSessionId: 'failed-session',
      }))
      return 'failed-session'
    })
    const deleteSession = vi.fn(async (sessionId: string) => {
      useSessionStore.setState((state) => ({
        sessions: state.sessions.filter((session) => session.id !== sessionId),
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
      }))
    })
    useSessionStore.setState({
      activeSessionId: 'smart-session',
      createSession: failedCreateSession,
      deleteSession,
    })
    createTask.mockRejectedValueOnce(new Error('task creation failed'))
    const retryPrompt = 'Prepare another verified report'
    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: retryPrompt,
        selectionStart: retryPrompt.length,
      },
    })
    const submitButton = container.querySelector('[data-chat-submit-button="true"]') as HTMLButtonElement
    await waitFor(() => expect(submitButton).not.toBeDisabled())
    fireEvent.click(submitButton)
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('failed-session'))
    expect(useSessionStore.getState().activeSessionId).toBe('smart-session')
    expect(screen.getByRole('textbox')).toHaveValue(retryPrompt)
    expect(connectToSession).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledTimes(1)

    createTask.mockRestore()
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      createSession: originalCreateSession,
      deleteSession: originalDeleteSession,
    })
    useChatStore.setState({
      sessions: {},
      connectToSession: originalConnectToSession,
      sendMessage: originalSendMessage,
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('EmptySession plus menu exposes uploads and slash commands before chat starts', () => {
    render(<EmptySession />)
    fireEvent.click(screen.getByRole('button', { name: 'Open composer tools' }))
    expect(screen.getByText('Add files or photos')).toBeInTheDocument()
    expect(screen.getByText('Slash commands')).toBeInTheDocument()
  })

  it('EmptySession accepts compressed uploads as attachments', async () => {
    useUIStore.setState({ toasts: [] })
    const { container } = render(<EmptySession />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(input).not.toBeNull()

    fireEvent.change(input!, {
      target: {
        files: [new File(['zip'], 'project.zip', { type: 'application/zip' })],
      },
    })

    expect(useUIStore.getState().toasts.some((toast) =>
      toast.message.includes('Compressed archives'),
    )).toBe(false)
    await waitFor(() => {
      expect(container.innerHTML).toContain('project.zip')
    })
  })

  it('ActiveSession renders with chat components', () => {
    const SESSION_ID = 'test-active-session'
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'New Session',
        createdAt: '2026-06-20T00:00:00.000Z',
        modifiedAt: '2026-06-20T00:00:00.000Z',
        messageCount: 0,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    const { container } = render(<ActiveSession />)
    // With empty messages, the hero is shown
    expect(container.innerHTML).toContain('New session')
    // ChatInput has a textarea
    const textarea = container.querySelector('textarea')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveAttribute('placeholder', 'Ask anything...')
    expect(textarea).toHaveAttribute('rows', '2')
    expect(container.innerHTML).not.toContain('Preview')
    // Cleanup
    useTabStore.setState({ tabs: [], activeTabId: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession keeps the compact composer once messages exist', () => {
    const SESSION_ID = 'test-active-session-with-messages'
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [{
            id: 'msg-1',
            type: 'user_text',
            content: 'hello',
            timestamp: Date.now(),
          }],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'Test',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 1,
        projectPath: '',
        workDir: null,
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })

    render(<ActiveSession />)

    const textarea = screen.getByPlaceholderText('Ask Gugu to edit, debug or explain...')
    expect(textarea).toHaveAttribute('rows', '1')

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession shows a single primary action button while a turn is active', () => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })
    render(<ActiveSession />)

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument()
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession opens a local /mcp panel and clicking an item routes to settings', async () => {
    const SESSION_ID = 'mcp-panel-session'
    const sendMessage = vi.fn()
    vi.mocked(mcpApi.list).mockResolvedValueOnce({
      servers: [
        {
          name: 'deepwiki',
          scope: 'user',
          transport: 'http',
          enabled: true,
          status: 'connected',
          statusLabel: 'Connected',
          configLocation: '/tmp/config',
          summary: 'https://mcp.deepwiki.com/mcp',
          canEdit: true,
          canRemove: true,
          canReconnect: true,
          canToggle: true,
          config: { type: 'http', url: 'https://mcp.deepwiki.com/mcp', headers: {} },
        },
      ],
    })
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'Test',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
      sendMessage,
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/mcp', selectionStart: 4 } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(await screen.findByText('Available MCP tools')).toBeInTheDocument()
    fireEvent.click(screen.getByText('deepwiki'))
    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('mcp')

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession opens a local /skills panel from the fallback slash commands', async () => {
    const SESSION_ID = 'skills-panel-session'
    const sendMessage = vi.fn()
    vi.mocked(skillsApi.list).mockResolvedValueOnce({
      skills: [
        {
          name: 'lark-mail',
          description: 'Draft, send, and search emails',
          source: 'user',
          userInvocable: true,
          contentLength: 120,
          hasDirectory: true,
        },
      ],
    })
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'Test',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
      sendMessage,
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/skills', selectionStart: 7 } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(await screen.findByText('Available skills')).toBeInTheDocument()
    expect(screen.getByText('/lark-mail')).toBeInTheDocument()

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession routes /plugin to Settings > Plugins instead of sending a chat message', () => {
    const SESSION_ID = 'plugin-panel-session'
    const sendMessage = vi.fn()
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'Test',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
      sendMessage,
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/plugin', selectionStart: 7 } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(useTabStore.getState().activeTabId).toBe('__settings__')
    expect(useUIStore.getState().pendingSettingsTab).toBe('plugins')

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useChatStore.setState({ sessions: {} })
  })

  it('ActiveSession routes /help to the local command panel', () => {
    const SESSION_ID = 'help-panel-session'
    const sendMessage = vi.fn()
    useTabStore.setState({ tabs: [{ sessionId: SESSION_ID, title: 'Test', type: 'session' as const, status: 'idle' }], activeTabId: SESSION_ID })
    useSessionStore.setState({
      sessions: [{
        id: SESSION_ID,
        title: 'Test',
        createdAt: '2026-04-10T00:00:00.000Z',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        messageCount: 0,
        projectPath: '/workspace/project',
        workDir: '/workspace/project',
        workDirExists: true,
      }],
      activeSessionId: SESSION_ID,
      isLoading: false,
      error: null,
    })
    useChatStore.setState({
      sessions: {
        [SESSION_ID]: {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [
            { name: 'cost', description: 'Show token usage and costs' },
            ...Array.from({ length: 14 }, (_, index) => ({
              name: `extra-${index + 1}`,
              description: `Extra command ${index + 1}`,
            })),
          ],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
      sendMessage,
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '/help', selectionStart: 5 } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    expect(sendMessage).not.toHaveBeenCalled()
    expect(screen.getByText('Slash commands')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
    expect(screen.getByText('/cost')).toBeInTheDocument()
    expect(screen.getByText('13 more commands available. Type / to search the full command list.')).toBeInTheDocument()

    useTabStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
    useChatStore.setState({ sessions: {} })
  })

  it('AgentTeams renders real system Role Packs', () => {
    useAgentTaskStore.setState({
      roles: ['software_engineer', 'knowledge_worker'],
      rolePacks: [
        {
          id: 'software_engineer',
          version: '1.0.0',
          displayName: 'Software Engineer',
          mission: 'Deliver verified software changes.',
          responsibilities: ['Inspect', 'Implement', 'Verify'],
        },
        {
          id: 'knowledge_worker',
          version: '1.0.0',
          displayName: 'Knowledge Worker',
          mission: 'Deliver source-backed documents.',
          responsibilities: ['Research', 'Draft', 'Verify'],
        },
      ],
    })

    render(<AgentTeams />)

    expect(screen.getByText('Professional standards')).toBeInTheDocument()
    expect(screen.getByText('Software Engineer')).toBeInTheDocument()
    expect(screen.getByText('Knowledge work: collect sources, create artifacts, and validate')).toBeInTheDocument()
    expect(screen.queryByText('session-dev')).not.toBeInTheDocument()
  })

  it('ScheduledTasks renders (store-connected)', async () => {
    const { container } = render(<ScheduledTasks />)
    await screen.findByText('Scheduled tasks')
    expect(container.innerHTML).toContain('Scheduled tasks')
  })

  it('ToolInspection renders diff viewer', () => {
    const { container } = render(<ToolInspection />)
    expect(container.innerHTML).toContain('edit_file')
    expect(container.innerHTML).toContain('Split')
    expect(container.innerHTML).toContain('Unified')
  })
})

function seedPromptOptimizeSession(sessionId: string, sendMessage = vi.fn()) {
  useTabStore.setState({
    tabs: [{ sessionId, title: 'Prompt optimize', type: 'session' as const, status: 'idle' }],
    activeTabId: sessionId,
  })
  useSessionStore.setState({
    sessions: [{
      id: sessionId,
      title: 'Prompt optimize',
      createdAt: '2026-04-10T00:00:00.000Z',
      modifiedAt: '2026-04-10T00:00:00.000Z',
      messageCount: 1,
      projectPath: '/workspace/project',
      workDir: '/workspace/project',
      workDirExists: true,
    }],
    activeSessionId: sessionId,
    isLoading: false,
    error: null,
  })
  useChatStore.setState({
    sessions: {
      [sessionId]: {
        messages: [{
          id: 'msg-1',
          type: 'user_text',
          content: 'hello',
          timestamp: Date.now(),
        }],
        chatState: 'idle',
        connectionState: 'connected',
        streamingText: '',
        streamingToolInput: '',
        activeToolUseId: null,
        activeToolName: null,
        activeThinkingId: null,
        pendingPermission: null,
        pendingComputerUsePermission: null,
        tokenUsage: { input_tokens: 0, output_tokens: 0 },
        elapsedSeconds: 0,
        statusVerb: '',
        slashCommands: [],
        agentTaskNotifications: {},
        elapsedTimer: null,
      },
    },
    sendMessage,
  })
  return sendMessage
}

function resetPromptOptimizeSession() {
  useTabStore.setState({ tabs: [], activeTabId: null })
  useSessionStore.setState({ sessions: [], activeSessionId: null, isLoading: false, error: null })
  useChatStore.setState({ sessions: {} })
  vi.mocked(promptOptimizeApi.optimize).mockReset()
  vi.mocked(audioTranscriptionApi.status).mockReset()
  vi.mocked(audioTranscriptionApi.transcribe).mockReset()
}

describe('Prompt optimization composer action', () => {
  it('keeps the magic wand disabled while the input is empty', () => {
    seedPromptOptimizeSession('prompt-optimize-empty')

    render(<ActiveSession />)

    expect(screen.getByRole('button', { name: 'Optimize prompt' })).toBeDisabled()

    resetPromptOptimizeSession()
  })

  it('shows a preview and can replace the composer without sending', async () => {
    const sendMessage = seedPromptOptimizeSession('prompt-optimize-replace')
    vi.mocked(promptOptimizeApi.optimize).mockResolvedValueOnce({
      optimizedText: 'Create a simple website that lists Street Fighter characters.',
      summary: 'Clarified the target output.',
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'make website', selectionStart: 12 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    expect(await screen.findByText('Create a simple website that lists Street Fighter characters.')).toBeInTheDocument()
    expect(promptOptimizeApi.optimize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'make website',
        sessionId: 'prompt-optimize-replace',
      }),
      expect.objectContaining({ signal: expect.any(Object) }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Replace input' }))

    expect(textarea).toHaveValue('Create a simple website that lists Street Fighter characters.')
    expect(sendMessage).not.toHaveBeenCalled()

    resetPromptOptimizeSession()
  })

  it('shows progress while prompt optimization is waiting', async () => {
    seedPromptOptimizeSession('prompt-optimize-progress')
    let resolveOptimize!: (value: { optimizedText: string; summary: string }) => void
    vi.mocked(promptOptimizeApi.optimize).mockReturnValueOnce(new Promise((resolve) => {
      resolveOptimize = resolve
    }))

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'make dashboard', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    const progressbar = await screen.findByRole('progressbar', { name: 'Optimizing prompt...' })
    const progress = Number(progressbar.getAttribute('aria-valuenow'))
    expect(progress).toBeGreaterThanOrEqual(6)
    expect(progress).toBeLessThanOrEqual(95)
    expect(screen.getByText(/Est\. \d+%/)).toBeInTheDocument()

    await act(async () => {
      resolveOptimize({
        optimizedText: 'Create a dashboard with clear navigation and reporting.',
        summary: 'Clarified the output.',
      })
      await Promise.resolve()
    })

    expect(await screen.findByText('Create a dashboard with clear navigation and reporting.')).toBeInTheDocument()

    resetPromptOptimizeSession()
  })

  it('does not show JSON-like optimized text in the preview', async () => {
    seedPromptOptimizeSession('prompt-optimize-json-guard')
    vi.mocked(promptOptimizeApi.optimize).mockResolvedValueOnce({
      optimizedText: '{"optimizedText":"构建一个简单网站，用于列出去年的热门动漫。","summary":"',
      summary: 'Optimized prompt generated.',
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: '做个动漫网站', selectionStart: 6 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    expect(await screen.findByText('Could not optimize the prompt.')).toBeInTheDocument()
    expect(screen.queryByText(/"optimizedText"/)).not.toBeInTheDocument()
    expect(textarea).toHaveValue('做个动漫网站')

    resetPromptOptimizeSession()
  })

  it('asks whether to keep waiting when prompt optimization is slow', async () => {
    vi.useFakeTimers()
    seedPromptOptimizeSession('prompt-optimize-slow')
    let resolveOptimize!: (value: { optimizedText: string; summary: string }) => void
    vi.mocked(promptOptimizeApi.optimize).mockReturnValueOnce(new Promise((resolve) => {
      resolveOptimize = resolve
    }))

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'make dashboard', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('The model is responding slowly. Keep waiting for the optimized prompt?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }))
    expect(screen.getByText('Still waiting for the model to return the optimized prompt...')).toBeInTheDocument()

    await act(async () => {
      resolveOptimize({
        optimizedText: 'Create a dashboard with clear navigation and reporting.',
        summary: 'Clarified the output.',
      })
      await Promise.resolve()
    })

    expect(screen.getByText('Create a dashboard with clear navigation and reporting.')).toBeInTheDocument()

    resetPromptOptimizeSession()
  })

  it('can cancel slow prompt optimization without changing the input', async () => {
    vi.useFakeTimers()
    seedPromptOptimizeSession('prompt-optimize-cancel')
    vi.mocked(promptOptimizeApi.optimize).mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('Request cancelled')), { once: true })
    }))

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'make dashboard', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(textarea).toHaveValue('make dashboard')
    expect(screen.queryByRole('progressbar', { name: 'Optimizing prompt...' })).not.toBeInTheDocument()

    resetPromptOptimizeSession()
  })

  it('sends the optimized text through the existing send path', async () => {
    const sendMessage = seedPromptOptimizeSession('prompt-optimize-send')
    vi.mocked(promptOptimizeApi.optimize).mockResolvedValueOnce({
      optimizedText: 'Implement the feature and add focused regression tests.',
      summary: 'Made the request actionable.',
    })

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'do feature', selectionStart: 10 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send optimized' }))

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        'prompt-optimize-send',
        expect.any(String),
        [],
        expect.objectContaining({
          displayContent: 'Implement the feature and add focused regression tests.',
        }),
      )
    })

    resetPromptOptimizeSession()
  })

  it('keeps the input intact when optimization fails', async () => {
    seedPromptOptimizeSession('prompt-optimize-fail')
    vi.mocked(promptOptimizeApi.optimize).mockRejectedValueOnce(new Error('No active provider configured'))

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'keep my prompt', selectionStart: 14 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Optimize prompt' }))

    expect(await screen.findByText('No active provider configured')).toBeInTheDocument()
    expect(textarea).toHaveValue('keep my prompt')

    resetPromptOptimizeSession()
  })
})

describe('Voice input composer action', () => {
  it('keeps voice input disabled when speech recognition is unavailable', () => {
    seedPromptOptimizeSession('voice-unavailable')

    render(<ActiveSession />)

    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeDisabled()

    resetPromptOptimizeSession()
  })

  it('records audio and writes Bailian transcription into the composer', async () => {
    const trackStop = vi.fn()
    const source = { connect: vi.fn(), disconnect: vi.fn() }
    const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as null | ((event: any) => void) }

    class FakeAudioContext {
      static current: FakeAudioContext | null = null
      sampleRate = 16000
      state = 'running'
      destination = {}
      createMediaStreamSource = vi.fn(() => source)
      createScriptProcessor = vi.fn(() => processor)
      close = vi.fn(async () => {
        this.state = 'closed'
      })

      constructor() {
        FakeAudioContext.current = this
      }
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: trackStop }],
        })),
      },
    })
    vi.mocked(audioTranscriptionApi.status).mockResolvedValueOnce({
      available: true,
      model: 'qwen3-asr-flash',
      provider: 'dashscope',
    })
    vi.mocked(audioTranscriptionApi.transcribe).mockResolvedValueOnce({
      text: '语音转文字结果',
      model: 'qwen3-asr-flash',
    })
    seedPromptOptimizeSession('voice-bailian')

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'existing prompt', selectionStart: 15 },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start voice input' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))

    await waitFor(() => {
      expect(processor.onaudioprocess).toBeTypeOf('function')
    })
    act(() => {
      processor.onaudioprocess?.({
        inputBuffer: {
          getChannelData: () => Float32Array.from([0, 0.25, -0.25]),
        },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' }))

    await waitFor(() => {
      expect(textarea).toHaveValue('existing prompt\n语音转文字结果')
    })
    expect(audioTranscriptionApi.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.stringMatching(/^data:audio\/wav;base64,/),
      enableItn: true,
    }))
    expect(trackStop).toHaveBeenCalled()
    expect(FakeAudioContext.current?.close).toHaveBeenCalled()

    resetPromptOptimizeSession()
  })

  it('does not start recording when cloud transcription is unavailable', async () => {
    const getUserMedia = vi.fn(async () => ({
      getTracks: () => [],
    }))

    class FakeAudioContext {
      state = 'running'
      destination = {}
      createMediaStreamSource = vi.fn()
      createScriptProcessor = vi.fn()
      close = vi.fn()
    }

    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    vi.mocked(audioTranscriptionApi.status).mockResolvedValueOnce({
      available: false,
      model: 'qwen3-asr-flash',
      provider: 'dashscope',
      reason: 'missing_api_key',
    })
    useUIStore.setState({ toasts: [] })
    seedPromptOptimizeSession('voice-cloud-unavailable')

    render(<ActiveSession />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start voice input' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))

    await waitFor(() => {
      expect(audioTranscriptionApi.status).toHaveBeenCalled()
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(audioTranscriptionApi.transcribe).not.toHaveBeenCalled()
    expect(useUIStore.getState().toasts.some((toast) =>
      toast.message === 'Voice transcription is temporarily unavailable. Please try again later.',
    )).toBe(true)

    resetPromptOptimizeSession()
  })

  it('writes speech recognition results into the composer without sending', async () => {
    class FakeSpeechRecognition extends EventTarget {
      static current: FakeSpeechRecognition | null = null
      lang = ''
      continuous = false
      interimResults = false
      onresult: ((event: any) => void) | null = null
      onerror: ((event: any) => void) | null = null
      onend: (() => void) | null = null
      start = vi.fn()
      stop = vi.fn(() => this.onend?.())
      abort = vi.fn(() => this.onend?.())

      constructor() {
        super()
        FakeSpeechRecognition.current = this
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    })
    const sendMessage = seedPromptOptimizeSession('voice-transcript')

    render(<ActiveSession />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: 'existing prompt', selectionStart: 15 },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Start voice input' })).not.toBeDisabled()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start voice input' }))

    expect(FakeSpeechRecognition.current?.start).toHaveBeenCalled()

    act(() => {
      FakeSpeechRecognition.current?.onresult?.({
        results: {
          length: 1,
          0: {
            0: { transcript: 'voice note' },
            isFinal: true,
          },
        },
      })
    })

    expect(textarea).toHaveValue('existing prompt\nvoice note')
    expect(sendMessage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Stop voice input' }))
    expect(FakeSpeechRecognition.current?.stop).toHaveBeenCalled()

    resetPromptOptimizeSession()
  })
})

describe('Chat attachments', () => {
  it('restores composer drafts per session tab', async () => {
    const firstSession = 'draft-session-1'
    const secondSession = 'draft-session-2'
    seedPromptOptimizeSession(firstSession)
    useTabStore.setState({
      tabs: [
        { sessionId: firstSession, title: 'First', type: 'session' as const, status: 'idle' },
        { sessionId: secondSession, title: 'Second', type: 'session' as const, status: 'idle' },
      ],
      activeTabId: firstSession,
    })
    useSessionStore.setState({
      sessions: [
        {
          id: firstSession,
          title: 'First',
          createdAt: '2026-04-10T00:00:00.000Z',
          modifiedAt: '2026-04-10T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
        {
          id: secondSession,
          title: 'Second',
          createdAt: '2026-04-10T00:00:00.000Z',
          modifiedAt: '2026-04-10T00:00:00.000Z',
          messageCount: 1,
          projectPath: '/workspace/project',
          workDir: '/workspace/project',
          workDirExists: true,
        },
      ],
    })
    useChatStore.setState((state) => ({
      sessions: {
        ...state.sessions,
        [secondSession]: {
          ...state.sessions[firstSession]!,
          messages: [{
            id: 'msg-2',
            type: 'user_text' as const,
            content: 'second',
            timestamp: Date.now(),
          }],
        },
      },
    }))

    render(<ActiveSession />)

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft for first session', selectionStart: 23 },
    })
    await waitFor(() => {
      const drafts = JSON.parse(localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? '{}')
      expect(drafts[firstSession]?.text).toBe('draft for first session')
    })

    act(() => {
      useTabStore.setState({ activeTabId: secondSession })
    })
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'draft for second session', selectionStart: 24 },
    })
    await waitFor(() => {
      const drafts = JSON.parse(localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) ?? '{}')
      expect(drafts[secondSession]?.text).toBe('draft for second session')
    })

    act(() => {
      useTabStore.setState({ activeTabId: firstSession })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('draft for first session')
    })

    resetPromptOptimizeSession()
  })

  it('converts very long pasted text into a text attachment', async () => {
    seedPromptOptimizeSession('long-paste-session')

    render(<ActiveSession />)

    const longText = 'a'.repeat(12_050)
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        items: [],
        getData: (type: string) => type === 'text/plain' ? longText : '',
      },
    })

    expect(await screen.findByText(/pasted-text-.*\.txt/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('')

    resetPromptOptimizeSession()
  })

  it('UserMessage opens image gallery when an attachment is clicked', () => {
    render(
      <UserMessage
        content=""
        attachments={[
          {
            type: 'image',
            name: 'diagram.png',
            data: 'data:image/png;base64,abc123',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('diagram.png')).toBeInTheDocument()
  })

  it('UserMessage renders raw base64 image attachments with a data URL', () => {
    render(
      <UserMessage
        content=""
        attachments={[
          {
            type: 'image',
            name: 'remote.jpg',
            data: 'abc123',
            mimeType: 'image/jpeg',
          },
        ]}
      />,
    )

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,abc123',
    )
  })
})

describe('AppShell layout renders chrome', () => {
  it('AppShell renders sidebar and session shell', () => {
    const { container } = render(<Sidebar />)
    expect(container.querySelector('aside')).toBeInTheDocument()
    expect(container.innerHTML).toContain('New session')
    expect(container.innerHTML).toContain('Scheduled')
    expect(container.innerHTML).toContain('All projects')
  })
})

describe('Design system compliance', () => {
  it('Pages use Material Symbols Outlined icons', () => {
    const pages = [EmptySession, AgentTeams, ToolInspection]
    for (const Page of pages) {
      const { container, unmount } = render(<Page />)
      const icons = container.querySelectorAll('.material-symbols-outlined')
      expect(icons.length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('Current brand color is used in content pages', () => {
    const pages = [EmptySession]
    for (const Page of pages) {
      const { container, unmount } = render(<Page />)
      const html = container.innerHTML
      expect(
        html.includes('C47A5A') ||
        html.includes('8F482F') ||
        html.includes('var(--color-brand)') ||
        html.includes('var(--gradient-btn-primary)') ||
        html.includes('bg-[var(--color-brand)]'),
      ).toBe(true)
      unmount()
    }
  })
})

describe('Legacy assistant compatibility', () => {
  it('keeps legacy profile data without exposing assistant creation or selection', () => {
    useAgentTaskStore.setState({
      roles: ['short_video_operator'],
      rolePacks: [{
        id: 'short_video_operator',
        version: '1.0.0',
        displayName: 'Short Video Operator',
        mission: 'Deliver source-backed short-video packages.',
        responsibilities: ['Research', 'Script', 'Review'],
      }],
    })
    useDesktopProfileStore.setState({
      bundle: {
        workspaceState: {
          assistants: {
            custom: [{
              id: 'custom-launch',
              name: 'Launch operator',
              description: 'Checks hooks and pacing.',
              baseRole: 'short_video_operator',
              instructions: 'Check the first three seconds.',
              createdAt: '2026-07-13T00:00:00.000Z',
              updatedAt: '2026-07-13T00:00:00.000Z',
            }],
          },
        },
      } as DesktopProfileBundle,
    })

    render(<AgentTeams />)

    expect(screen.queryByText('Launch operator')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create assistant' }))
      .not.toBeInTheDocument()
    expect(
      useDesktopProfileStore.getState()
        .bundle?.workspaceState.assistants.custom[0]?.name,
    ).toBe('Launch operator')
  })
})

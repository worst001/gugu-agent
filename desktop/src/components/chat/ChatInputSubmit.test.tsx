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
    getRecentProjects: vi.fn(async () => ({ projects: [] })),
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
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useCeWorkflowRoleStore } from '../../stores/ceWorkflowRoleStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

function seedEmptySession(
  sessionId: string,
  overrides: Partial<{
    projectPath: string
    workDir: string | null
    workDirExists: boolean
  }> = {},
) {
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
      ...overrides,
    }],
    activeSessionId: sessionId,
    isLoading: false,
    error: null,
  })
  useChatStore.setState({ sessions: {} })
}

function makeChatSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    chatState: 'idle',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    currentTurnOrigin: null,
    pendingPermission: null,
    pendingPermissionQueue: [],
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    statusElapsedSeconds: 0,
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    composerPrefill: null,
    ...overrides,
  }
}

describe('ChatInput submit', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useAgentRunModeStore.setState({ selections: {} })
    useCeWorkflowRoleStore.setState({ selections: {} })
    useUIStore.setState({ toasts: [] })
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

  it('keeps the default composer toolbar opaque and long input constrained', () => {
    seedEmptySession('default-composer-session')
    useChatStore.setState({
      sessions: {
        'default-composer-session': makeChatSession({
          messages: [{
            id: 'assistant-1',
            type: 'assistant_text',
            content: 'ready',
            timestamp: 1,
          }],
        }),
      },
    })

    const { container } = render(<ActiveSession />)
    const textbox = screen.getByRole('textbox')
    const toolbar = container.querySelector('.absolute.bottom-0')

    expect(textbox.className).toContain('overflow-x-hidden')
    expect(textbox.className).toContain('break-all')
    expect(toolbar?.className).toContain('bg-[var(--color-surface-container-lowest)]')
    expect(toolbar?.className).toContain('rounded-b-xl')
  })

  it('keeps a selected project visible while replacing a brand-new empty session', async () => {
    vi.mocked(sessionsApi.create).mockResolvedValueOnce({ sessionId: 'created-project-session' })
    vi.mocked(sessionsApi.list).mockResolvedValueOnce({ sessions: [], total: 0 })
    vi.mocked(sessionsApi.getRecentProjects).mockResolvedValueOnce({
      projects: [{
        projectPath: 'Users-hanwenhao-Downloads-HTML',
        realPath: '/Users/hanwenhao/Downloads/HTML',
        projectName: 'HTML',
        repoName: null,
        branch: null,
        isGit: false,
        modifiedAt: '2026-05-30T00:00:00.000Z',
        sessionCount: 1,
      }],
    })
    seedEmptySession('empty-project-session', {
      projectPath: '',
      workDir: null,
      workDirExists: true,
    })

    render(<ActiveSession />)

    fireEvent.click(screen.getByText('Select a project...'))
    fireEvent.click(await screen.findByText('HTML'))

    await waitFor(() => {
      expect(sessionsApi.create).toHaveBeenCalledWith('/Users/hanwenhao/Downloads/HTML')
      expect(screen.queryByText('Select a project...')).not.toBeInTheDocument()
    })
    expect(useSessionStore.getState().activeSessionId).toBe('created-project-session')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'created-project-session',
      workDir: '/Users/hanwenhao/Downloads/HTML',
    })
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

  it('shows the office toolbox, changes placeholders, and keeps the selection local to the composer', async () => {
    seedEmptySession('office-toolbox-placeholder-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))

    expect(screen.getByRole('button', { name: 'Normal chat' })).toBeInTheDocument()
    expect(screen.getByText('Everyday questions, coding, and explanations.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Coding' })).toBeInTheDocument()
    expect(screen.getByText(/Code, logs, errors, project folders/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Summarize document' })).toBeInTheDocument()
    expect(screen.getByText('Turn chats, notes, or material into a summary document; suitable for PDF, Word, Markdown, TXT.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Analyze spreadsheet' })).toBeInTheDocument()
    expect(screen.getByText('Turn data, metrics, or table content into spreadsheet-style analysis; suitable for Excel, CSV.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft PPT' })).toBeInTheDocument()
    expect(screen.getByText('Turn a topic, notes, or chat content into a PPT outline and speaker notes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write email' })).toBeInTheDocument()
    expect(screen.getByText('Turn background, goal, and tone into an email draft. No auto-send.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Handle file' })).toBeInTheDocument()
    expect(screen.getByText('Upload PDF, Word, Excel, PPT, CSV, TXT, images; identify type and next step.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze spreadsheet' }))

    expect(screen.getByRole('button', { name: 'Clear office tool' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'placeholder',
      'Say what data or metrics should be analyzed...',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear office tool' }))

    expect(screen.queryByRole('button', { name: 'Clear office tool' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Ask anything...')
    expect(screen.getByRole('button', { name: 'Office toolbox' })).toBeInTheDocument()
  })

  it('routes a selected office tool through the wire prompt while keeping the user echo clean', async () => {
    seedEmptySession('office-toolbox-ppt-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Draft PPT' }))
    expect(screen.getByRole('button', { name: 'Clear office tool' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'make a launch deck', selectionStart: 18 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('make a launch deck')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Office toolbox: ppt-draft]')
    expect(payload?.content).toContain('Create a presentation outline first')
    expect(payload?.content).toContain('$ppt-master')
    expect(payload?.content).toContain('Never ship rough slide mockups')
    expect(payload?.content).toContain('User request:\nmake a launch deck')
    expect(screen.queryByText(/\[Office toolbox: ppt-draft\]/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear office tool' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Office toolbox' })).toBeInTheDocument()
  })

  it('includes office routing precedence so explicit output type wins over source format', async () => {
    seedEmptySession('office-toolbox-routing-precedence-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Summarize document' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'turn this PDF into a PPT deck', selectionStart: 29 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('turn this PDF into a PPT deck')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('Routing precedence:')
    expect(payload?.content).toContain('The final output type explicitly requested by the user has highest priority')
    expect(payload?.content).toContain('use PDF-related skills only to read the source and use the PPT workflow for the final artifact')
    expect(payload?.content).toContain('Format-specific skills are source/input helpers')
    expect(payload?.content).toContain('User request:\nturn this PDF into a PPT deck')
  })

  it('routes coding through the office toolbox without requiring CodeGraph', async () => {
    seedEmptySession('office-toolbox-coding-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'fix this TypeScript error', selectionStart: 25 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('fix this TypeScript error')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Office toolbox: coding-assistant]')
    expect(payload?.content).toContain('CodeGraph')
    expect(payload?.content).toContain('Do not assume CodeGraph is installed or connected')
    expect(payload?.content).toContain('User request:\nfix this TypeScript error')
    expect(screen.queryByText(/\[Office toolbox: coding-assistant\]/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Office toolbox' })).toBeInTheDocument()
  })

  it('keeps office tools and plan mode orthogonal for a single run', async () => {
    seedEmptySession('office-toolbox-plan-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Draft PPT' }))
    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    fireEvent.click(screen.getByRole('button', { name: /Plan/ }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'make a launch deck', selectionStart: 18 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('make a launch deck')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Agent mode: plan]')
    expect(payload?.content).toContain('[Office toolbox: ppt-draft]')
    expect(payload?.content).toContain('Create a presentation outline first')
    expect(payload?.content).toContain('$ppt-master')
    expect(useAgentRunModeStore.getState().selections['office-toolbox-plan-session']).toBe('normal')
    expect(screen.getByRole('button', { name: 'Office toolbox' })).toBeInTheDocument()
  })

  it('runs document summary as an output task without requiring attachments', async () => {
    seedEmptySession('office-toolbox-document-summary-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Summarize document' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'summarize this chat into a doc', selectionStart: 30 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('summarize this chat into a doc')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Office toolbox: document-summary]')
    expect(payload?.content).toContain('$document-master')
    expect(payload?.content).toContain('$local-office-files')
    expect(payload?.content).toContain('$pdf-master')
    expect(payload?.content).toContain('$word-master')
    expect(payload?.content).toContain('summary document')
    expect(payload?.content).toContain('known facts from assumptions')
    expect(payload?.content).toContain('User request:\nsummarize this chat into a doc')
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('routes spreadsheet analysis through the spreadsheet quality skill', async () => {
    seedEmptySession('office-toolbox-spreadsheet-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Analyze spreadsheet' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'analyze monthly revenue by region', selectionStart: 33 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('analyze monthly revenue by region')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Office toolbox: spreadsheet-analysis]')
    expect(payload?.content).toContain('$spreadsheet-master')
    expect(payload?.content).toContain('$excel-master')
    expect(payload?.content).toContain('$local-office-files')
    expect(payload?.content).toContain('missing values, duplicates, outliers')
    expect(payload?.content).toContain('User request:\nanalyze monthly revenue by region')
    expect(screen.queryByText(/\[Office toolbox: spreadsheet-analysis\]/)).not.toBeInTheDocument()
  })

  it('routes email drafting through the mail quality skill without external side effects', async () => {
    seedEmptySession('office-toolbox-mail-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Write email' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'write a polite renewal reminder', selectionStart: 31 },
    })
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(screen.getByText('write a polite renewal reminder')).toBeInTheDocument()
    })

    const payload = getLastUserMessagePayload()
    expect(payload?.content).toContain('[Office toolbox: mail-draft]')
    expect(payload?.content).toContain('$mail-master')
    expect(payload?.content).toContain('$local-office-files')
    expect(payload?.content).toContain('$pdf-master')
    expect(payload?.content).toContain('$excel-master')
    expect(payload?.content).toContain('$word-master')
    expect(payload?.content).toContain('Do not send email')
    expect(payload?.content).toContain('User request:\nwrite a polite renewal reminder')
    expect(screen.queryByText(/\[Office toolbox: mail-draft\]/)).not.toBeInTheDocument()
  })

  it('shows a friendly warning instead of running file handling without attachments', async () => {
    seedEmptySession('office-toolbox-missing-attachment-session')
    render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Handle file' }))
    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    expect(getLastUserMessagePayload()).toBeUndefined()
    const toasts = useUIStore.getState().toasts
    expect(toasts[toasts.length - 1]).toMatchObject({
      type: 'warning',
      message: 'Add a file or choose a local file before using “Handle file”.',
    })
  })

  it('keeps attachment-only office tool messages user-facing', async () => {
    seedEmptySession('office-toolbox-attachment-only-session')
    const { container } = render(<ActiveSession />)

    fireEvent.click(screen.getByRole('button', { name: 'Office toolbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'Handle file' }))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['report'], 'report.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(await screen.findByText('report.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    await waitFor(() => {
      expect(getLastUserMessagePayload()?.content).toContain('[Office toolbox: file-assistant]')
    })
    expect(getLastUserMessagePayload()?.content).toContain('$file-master')
    expect(getLastUserMessagePayload()?.content).toContain('$local-office-files')
    expect(getLastUserMessagePayload()?.content).toContain('$pdf-master')
    expect(getLastUserMessagePayload()?.content).toContain('$excel-master')
    expect(getLastUserMessagePayload()?.content).toContain('$word-master')
    expect(getLastUserMessagePayload()?.content).toContain('$ppt-master')
    expect(getLastUserMessagePayload()?.content).toContain('safer next step')
    expect(screen.getByText('File')).toBeInTheDocument()
    expect(screen.queryByText(/The user sent attachments only/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear office tool' })).not.toBeInTheDocument()
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

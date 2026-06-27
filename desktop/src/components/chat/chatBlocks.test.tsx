import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { StreamingIndicator } from './StreamingIndicator'
import { AgentActivityPanel } from './AgentActivityPanel'
import { UserMessage } from './UserMessage'
import { useChatStore } from '../../stores/chatStore'
import type { PerSessionState } from '../../stores/chatStore'
import type { UIMessage } from '../../types/chat'
import { useTabStore } from '../../stores/tabStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useCLITaskStore } from '../../stores/cliTaskStore'

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    chatState: 'idle',
    connectionState: 'connected',
    streamingText: '',
    streamingToolInput: '',
    activeToolUseId: null,
    activeToolName: null,
    activeThinkingId: null,
    pendingPermission: null,
    pendingPermissionQueue: [],
    pendingComputerUsePermission: null,
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    elapsedSeconds: 0,
    statusVerb: '',
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    historyLoading: false,
    historyLoadError: null,
    composerPrefill: null,
    ...overrides,
  }
}

describe('chat blocks', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
    useWorkbenchStore.setState({ sessions: {} })
    useCLITaskStore.getState().clearTasks()
  })

  it('shows active thinking as a compact one-line status', () => {
    const { container } = render(<ThinkingBlock content="正在分析上下文" isActive />)

    expect(screen.getByText(/thinking|思考/i)).toBeTruthy()
    expect(container.textContent).toContain('正在分析上下文')
    expect(container.querySelector('.thinking-inline-cursor')).toBeTruthy()
    expect(container.querySelector('.thinking-cursor')).toBeNull()
  })

  it('keeps long user URLs inside the message bubble', () => {
    const longUrl = `https://s.taobao.com/search?q=${'verylongsegment'.repeat(20)}`

    render(<UserMessage content={longUrl} />)

    const bubble = screen.getByText(longUrl)
    expect(bubble).toHaveClass('max-w-full')
    expect(bubble).toHaveClass('overflow-hidden')
    expect(bubble).toHaveClass('break-all')
  })

  it('keeps long permission primary details constrained', () => {
    const longUrl = `https://s.taobao.com/search?q=${'verylongsegment'.repeat(20)}`

    render(
      <PermissionDialog
        requestId="permission-url"
        toolName="WebFetch"
        input={{ url: longUrl }}
      />,
    )

    const primary = screen.getByText(longUrl)
    expect(primary).toHaveClass('min-w-0')
    expect(primary).toHaveClass('flex-1')
    expect(primary).toHaveClass('truncate')
  })

  it('names the active tool and shows a long-running hint', () => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({
      sessions: {
        'active-tab': makeSessionState({
          chatState: 'tool_executing',
          activeToolName: 'Bash',
          elapsedSeconds: 45,
        }),
      },
    })

    render(<StreamingIndicator sessionId="active-tab" />)

    expect(screen.getByText('Running Bash...')).toBeTruthy()
    expect(screen.getByText('45s')).toBeTruthy()
    expect(screen.getByText(/taking longer than usual/i)).toBeTruthy()
  })

  it('does not animate inactive historical thinking blocks', () => {
    const { container } = render(<ThinkingBlock content="old reasoning" isActive={false} />)

    expect(container.querySelector('.thinking-inline-cursor')).toBeNull()
  })

  it('shows collapsible live activity for the running turn', () => {
    useSettingsStore.setState({ locale: 'en' })
    const messages: UIMessage[] = [
      {
        id: 'thinking-1',
        type: 'thinking',
        content: 'Looking at the failing test',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        type: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'bash-1',
        input: { command: 'bun test src/example.test.ts' },
        timestamp: 2,
      },
    ]

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={78}
        activeToolName="Bash"
        activeToolUseId="bash-1"
        activeThinkingId="thinking-1"
        messages={messages}
        resultMap={new Map()}
      />,
    )

    expect(screen.getByText('Current activity')).toBeTruthy()
    expect(screen.getByText('1m 18s')).toBeTruthy()
    expect(screen.getAllByText('Running Bash').length).toBeGreaterThan(0)
    expect(screen.getByText('bun test src/example.test.ts')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Current activity/i }))

    expect(screen.queryByText('bun test src/example.test.ts')).toBeNull()
  })

  it('explains long thinking before any tool starts', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={95}
        activeThinkingId="thinking-1"
        messages={[
          {
            id: 'thinking-1',
            type: 'thinking',
            content: 'Analyzing context',
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Thinking through the next step').length).toBeGreaterThan(0)
    expect(screen.getByText('No model output yet after 1m 35s')).toBeTruthy()
    expect(screen.getByText(/has not received text, a tool call, or a permission request/i)).toBeTruthy()
  })

  it('labels the pre-first-token gap as waiting for the model, not reasoning', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={25}
        messages={[]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Waiting for the model response').length).toBeGreaterThan(0)
    expect(screen.queryByText('Thinking through the next step')).toBeNull()
    expect(screen.getByText('No model output yet after 25s')).toBeTruthy()
  })

  it('surfaces task context routing in the live activity panel before tools start', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={8}
        statusVerb="Understanding request"
        messages={[
          {
            id: 'task-context-1',
            type: 'system',
            variant: 'task_context',
            content: 'Detected: PPT production. Will prepare the slide structure first.',
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Detected: PPT production. Will prepare the slide structure first.').length).toBeGreaterThan(0)
    expect(screen.queryByText('Understanding request')).toBeNull()
  })

  it('does not reuse a previous task context notice for a new ordinary turn', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={8}
        statusVerb="Understanding request"
        messages={[
          {
            id: 'user-1',
            type: 'user_text',
            content: 'Build a launch deck',
            timestamp: 1,
          },
          {
            id: 'task-context-1',
            type: 'system',
            variant: 'task_context',
            content: 'Detected: PPT production. Will prepare the slide structure first.',
            timestamp: 2,
          },
          {
            id: 'assistant-1',
            type: 'assistant_text',
            content: 'Here is a draft outline.',
            timestamp: 3,
          },
          {
            id: 'user-2',
            type: 'user_text',
            content: 'Thanks',
            timestamp: 4,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.queryByText('Detected: PPT production. Will prepare the slide structure first.')).toBeNull()
    expect(screen.getAllByText('Understanding request').length).toBeGreaterThan(0)
  })

  it('collapses recovered tool failures in the live activity panel', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="idle"
        elapsedSeconds={12}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'Bash',
            toolUseId: 'bash-1',
            input: { command: 'grep Modify demo.pptx' },
            timestamp: 1,
          },
          {
            id: 'result-1',
            type: 'tool_result',
            toolUseId: 'bash-1',
            content: 'grep not found',
            isError: true,
            timestamp: 2,
          },
          {
            id: 'assistant-1',
            type: 'assistant_text',
            content: 'Generated the updated PPT.',
            timestamp: 3,
          },
        ]}
        resultMap={new Map([
          ['bash-1', {
            id: 'result-1',
            type: 'tool_result',
            toolUseId: 'bash-1',
            content: 'grep not found',
            isError: true,
            timestamp: 2,
          }],
        ])}
      />,
    )

    expect(screen.getByText('Tried 1 fallback step(s)')).toBeTruthy()
    expect(screen.getByText('Bash did not work; continued.')).toBeTruthy()
    expect(screen.queryByText('Bash failed')).toBeNull()
  })

  it('shows current task progress in the live activity panel', () => {
    useSettingsStore.setState({ locale: 'en' })
    useCLITaskStore.setState({
      sessionId: 'active-tab',
      tasks: [
        { id: '1', subject: 'Read the file', description: '', status: 'completed', blocks: [], blockedBy: [], taskListId: 'active-tab' },
        { id: '2', subject: 'Update the deck', activeForm: 'Replacing year text', description: '', status: 'in_progress', blocks: [], blockedBy: [], taskListId: 'active-tab' },
        { id: '3', subject: 'Verify output', description: '', status: 'pending', blocks: [], blockedBy: [], taskListId: 'active-tab' },
      ],
    })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={30}
        messages={[]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Task progress 1/3').length).toBeGreaterThan(0)
    expect(screen.getByText('Current: Replacing year text')).toBeTruthy()
  })

  it('does not show task progress from another session', () => {
    useSettingsStore.setState({ locale: 'en' })
    useCLITaskStore.setState({
      sessionId: 'other-session',
      tasks: [
        { id: '1', subject: 'Wrong session task', description: '', status: 'in_progress', blocks: [], blockedBy: [], taskListId: 'other-session' },
      ],
    })

    render(
      <AgentActivityPanel
        sessionId="active-tab"
        chatState="tool_executing"
        elapsedSeconds={30}
        messages={[]}
        resultMap={new Map()}
      />,
    )

    expect(screen.queryByText(/Task progress/)).toBeNull()
    expect(screen.queryByText(/Wrong session task/)).toBeNull()
  })

  it('explains when a result returned before the task list was fully closed', () => {
    useSettingsStore.setState({ locale: 'en' })
    useCLITaskStore.setState({
      sessionId: 'active-tab',
      tasks: [
        { id: '1', subject: 'Read the file', description: '', status: 'completed', blocks: [], blockedBy: [], taskListId: 'active-tab' },
        { id: '2', subject: 'Update the deck', description: '', status: 'pending', blocks: [], blockedBy: [], taskListId: 'active-tab' },
      ],
    })

    render(
      <AgentActivityPanel
        chatState="idle"
        elapsedSeconds={12}
        messages={[{
          id: 'assistant-1',
          type: 'assistant_text',
          content: 'Generated the updated file.',
          timestamp: 1,
        }]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Main result returned; 1 item(s) left open').length).toBeGreaterThan(0)
    expect(screen.getByText('You can continue the remaining steps without repeating completed work.')).toBeTruthy()
  })

  it('communicates when Bash runs for a very long time', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={610}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'Bash',
            toolUseId: 'bash-1',
            input: { command: 'npm run build' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Running Bash').length).toBeGreaterThan(0)
    expect(screen.getByText('Bash has been running for 10m 10s')).toBeTruthy()
    expect(screen.getByText(/unusually long/i)).toBeTruthy()
    expect(screen.getByText('npm run build')).toBeTruthy()
  })

  it('treats permission waits as user confirmation instead of long-running tools', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="permission_pending"
        elapsedSeconds={190}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'ExitPlanMode',
            toolUseId: 'plan-1',
            input: { plan: 'Implement the plan' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
        pendingPermission={{
          toolName: 'ExitPlanMode',
          toolUseId: 'plan-1',
          input: { plan: 'Implement the plan' },
        }}
      />,
    )

    expect(screen.getAllByText('Waiting for your confirmation: ExitPlanMode').length).toBeGreaterThan(0)
    expect(screen.getByText(/Allow continues the tool/i)).toBeTruthy()
    expect(screen.queryByText(/ExitPlanMode is taking a while/i)).toBeNull()
    expect(screen.queryByText(/ExitPlanMode has been running/i)).toBeNull()
  })

  it('warns when Write is unusually slow', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={75}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'Write',
            toolUseId: 'write-1',
            input: { file_path: '/tmp/large-output.md' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getByText('Write is unusually slow (1m 15s)')).toBeTruthy()
    expect(screen.getByText(/Local file writes usually finish quickly/i)).toBeTruthy()
    expect(screen.getByText('/tmp/large-output.md')).toBeTruthy()
  })

  it('explains slow repository scans', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={185}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'Grep',
            toolUseId: 'grep-1',
            input: { pattern: 'ContextUsageIndicator', path: 'desktop/src' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getByText('Grep is scanning for 3m 5s')).toBeTruthy()
    expect(screen.getByText(/Large repositories, broad patterns, or huge logs/i)).toBeTruthy()
    expect(screen.getByText('ContextUsageIndicator - desktop/src')).toBeTruthy()
  })

  it('explains long child agent runs', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={245}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'Agent',
            toolUseId: 'agent-1',
            input: { description: 'Review the release workflow' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getByText('Agent has been running for 4m 5s')).toBeTruthy()
    expect(screen.getByText(/child agent may be doing several steps/i)).toBeTruthy()
  })

  it('explains slow Codegraph MCP calls', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="tool_executing"
        elapsedSeconds={75}
        messages={[
          {
            id: 'tool-1',
            type: 'tool_use',
            toolName: 'mcp__codegraph__codegraph_context',
            toolUseId: 'mcp-1',
            input: { task: 'Trace the context usage flow' },
            timestamp: 1,
          },
        ]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getByText('Codegraph is taking time (1m 15s)')).toBeTruthy()
    expect(screen.getByText(/indexing, or traversing a large project graph/i)).toBeTruthy()
  })

  it('explains long attachment parsing before tools start', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={55}
        statusVerb="Parsing attachments"
        messages={[]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Parsing attachments for 55s').length).toBeGreaterThan(0)
    expect(screen.getByText(/OCR, vision, audio, PDF, and Office files/i)).toBeTruthy()
  })

  it('uses live status elapsed time instead of stale attachment parsing text', () => {
    useSettingsStore.setState({ locale: 'en' })

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={300}
        statusElapsedSeconds={320}
        statusVerb="Parsing attachments, waited 15s"
        messages={[]}
        resultMap={new Map()}
      />,
    )

    expect(screen.getAllByText('Parsing attachments for 5m 20s').length).toBeGreaterThan(0)
    expect(screen.queryByText(/15s/)).toBeNull()
  })

  it('explains temporary model recovery states before tools start', () => {
    useSettingsStore.setState({ locale: 'en' })
    const onStopTurn = vi.fn()
    const onContinueFromHere = vi.fn()

    render(
      <AgentActivityPanel
        chatState="thinking"
        elapsedSeconds={65}
        statusVerb="Model response interrupted, waiting for recovery"
        messages={[]}
        resultMap={new Map()}
        onStopTurn={onStopTurn}
        onContinueFromHere={onContinueFromHere}
      />,
    )

    expect(screen.getAllByText('Model response interrupted, waiting for recovery').length).toBeGreaterThan(0)
    expect(screen.getByText(/stop this turn and retry/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /stop turn/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue from here/i }))
    expect(onStopTurn).toHaveBeenCalledTimes(1)
    expect(onContinueFromHere).toHaveBeenCalledTimes(1)
  })

  it('shows tool previews only after expanding the tool block', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts', limit: 20 }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).not.toContain('const answer = 42')

    fireEvent.click(screen.getByRole('button', { name: /Read/i }))

    expect(container.textContent).toMatch(/Tool Input|工具输入/)
    expect(container.textContent).not.toContain('const answer = 42')
  })

  it('does not surface bash stdout in the transcript preview', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a\nfile-b\nfile-c', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).not.toContain('file-a')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('ls -la')
    expect(container.textContent).not.toContain('file-a')
  })

  it('shows a collapsed error summary for failed bash commands', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'git show 5016bc0 --no-stat', description: 'Show full diff of latest commit' }}
        result={{ content: 'fatal: unrecognized argument: --no-stat\nExit code 128', isError: true }}
      />,
    )

    expect(container.textContent).toContain('Bash')
    expect(container.textContent).toContain('fatal: unrecognized argument: --no-stat')
    expect(container.textContent).toContain('warning_amber')
    expect(container.textContent).not.toContain('error_outline')
  })

  it('renders OfficeFile results as generated-file feedback', () => {
    useSettingsStore.setState({ locale: 'en' })
    const { container } = render(
      <ToolCallBlock
        toolUseId="office-1"
        toolName="OfficeFile"
        input={{
          operation: 'calculate_column',
          file_path: 'C:\\Users\\test\\orders.xlsx',
          target_column: 'amount',
          left_column: 'price',
          right_column: 'quantity',
        }}
        result={{
          content: [
            'Generated new XLSX file and filled 3 rows.',
            'Output path: C:\\Users\\test\\orders.gugu.xlsx',
            'Source path: C:\\Users\\test\\orders.xlsx',
            'Original modified: no',
          ].join('\n'),
          isError: false,
        }}
      />,
    )

    expect(container.textContent).toContain('Office')
    expect(container.textContent).toContain('orders.gugu.xlsx')
    expect(container.textContent).not.toContain('orders.xlsxorders.gugu.xlsx')

    fireEvent.click(screen.getByRole('button', { name: /Office/i }))

    expect(container.textContent).toContain('Generated new XLSX file')
    expect(container.textContent).toContain('C:\\Users\\test\\orders.gugu.xlsx')
    expect(screen.getByRole('button', { name: 'Open file' })).toBeTruthy()
    expect(screen.getAllByTitle(/orders\.gugu\.xlsx/).length).toBeGreaterThan(0)
  })

  it('hides standalone unavailable WebSearch tool errors', () => {
    const { container } = render(
      <ToolResultBlock
        content="<tool_use_error>Error: No such tool available: WebSearch</tool_use_error>"
        isError
      />,
    )

    expect(container.textContent).toBe('')
  })

  it('renders active WebSearch as a localized web-search status', () => {
    useSettingsStore.setState({ locale: 'zh' })

    const { container } = render(
      <ToolCallGroup
        toolCalls={[{
          id: 'tool-search',
          type: 'tool_use',
          toolName: 'WebSearch',
          toolUseId: 'search-1',
          input: { query: '美国总统是谁' },
          timestamp: 1,
        }]}
        resultMap={new Map()}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
        isStreaming
      />,
    )

    expect(container.textContent).toContain('网页搜索中')
    expect(container.textContent).not.toContain('WebSearch')
  })

  it('summarizes completed WebSearch calls with a count', () => {
    useSettingsStore.setState({ locale: 'zh' })

    const { container } = render(
      <ToolCallGroup
        toolCalls={[
          {
            id: 'tool-search-1',
            type: 'tool_use',
            toolName: 'WebSearch',
            toolUseId: 'search-1',
            input: { query: '美国总统是谁' },
            timestamp: 1,
          },
          {
            id: 'tool-search-2',
            type: 'tool_use',
            toolName: 'WebSearch',
            toolUseId: 'search-2',
            input: { query: 'United States president May 2026' },
            timestamp: 2,
          },
        ]}
        resultMap={new Map([
          ['search-1', {
            id: 'result-search-1',
            type: 'tool_result',
            toolUseId: 'search-1',
            content: 'result 1',
            isError: false,
            timestamp: 3,
          }],
          ['search-2', {
            id: 'result-search-2',
            type: 'tool_result',
            toolUseId: 'search-2',
            content: 'result 2',
            isError: false,
            timestamp: 4,
          }],
        ])}
        childToolCallsByParent={new Map()}
        agentTaskNotifications={{}}
      />,
    )

    expect(container.textContent).toContain('已搜索网页 2 次')
    expect(container.textContent).not.toContain('WebSearch')
  })

  it('renders HTTP 403 tool errors as target access failures', () => {
    const { container } = render(
      <ToolResultBlock
        content="Request failed with status code 403"
        isError
      />,
    )

    expect(container.textContent).toContain('Target access was blocked.')
    expect(container.textContent).not.toContain('Request failed with status code 403')
  })

  it('renders setup tool failures as soft actionable summaries', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__screenshot"
        input={{}}
        result={{
          content: "python venv creation failed with code 1: 'python' is not recognized as an internal or external command",
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('Python environment is not ready')
    expect(container.textContent).toContain('warning_amber')
    expect(container.textContent).not.toContain('python venv creation failed')
  })

  it('opens a tool call in the right-side workbench', () => {
    render(
      <ToolCallBlock
        toolUseId="write-1"
        toolName="Write"
        input={{ file_path: '/tmp/example.ts', content: 'const answer = 42' }}
        result={{ content: 'created', isError: false }}
      />,
    )

    fireEvent.click(screen.getByLabelText(/Open in workbench|打开/i))

    expect(useWorkbenchStore.getState().sessions['active-tab']).toMatchObject({
      isOpen: true,
      activeTab: 'diff',
      selectedToolUseId: 'write-1',
      selectedFilePath: '/tmp/example.ts',
    })
  })

  it('expands tool errors so full Computer Use gate messages are readable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__left_click"
        input={{ coordinate: [120, 220] }}
        result={{
          content: '"Claude Code GuGu" is not in the allowed applications and is currently in front. Take a new screenshot — it may have appeared since your last one.',
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('mcp__computer-use__left_click')
    expect(container.textContent).not.toContain('Take a new screenshot')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Take a new screenshot')
    expect(container.textContent).toContain('allowed applications')
  })

  it('shows a diff preview for edit permission requests', () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'Edit',
            input: {
              file_path: '/tmp/example.ts',
              old_string: 'const count = 1',
              new_string: 'const count = 2',
            },
          },
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

    const { container } = render(
      <PermissionDialog
        requestId="perm-1"
        toolName="Edit"
        input={{
          file_path: '/tmp/example.ts',
          old_string: 'const count = 1',
          new_string: 'const count = 2',
        }}
      />,
    )

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).toMatch(/Allow|允许/)
    // react-diff-viewer-continued uses styled-components tables that don't
    // fully render in jsdom, so we verify the DiffViewer wrapper is mounted
    expect(container.querySelector('[class*="rounded-[var(--radius-lg)]"]')).toBeTruthy()
  })
})

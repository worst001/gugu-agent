import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { StreamingIndicator } from './StreamingIndicator'
import { useChatStore } from '../../stores/chatStore'
import type { PerSessionState } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useWorkbenchStore } from '../../stores/workbenchStore'
import { useSettingsStore } from '../../stores/settingsStore'

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
  })

  it('shows active thinking as a compact one-line status', () => {
    const { container } = render(<ThinkingBlock content="正在分析上下文" isActive />)

    expect(screen.getByText(/thinking|思考/i)).toBeTruthy()
    expect(container.textContent).toContain('正在分析上下文')
    expect(container.querySelector('.thinking-inline-cursor')).toBeTruthy()
    expect(container.querySelector('.thinking-cursor')).toBeNull()
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

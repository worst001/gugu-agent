import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    reveal: vi.fn(),
  },
}))

vi.mock('./CodeViewer', () => ({
  CodeViewer: ({ code, language }: { code: string; language?: string }) => (
    <div data-testid="code-viewer" data-language={language ?? ''}>
      {code}
    </div>
  ),
}))

vi.mock('./MermaidRenderer', () => ({
  MermaidRenderer: ({ code }: { code: string }) => (
    <div data-testid="mermaid-renderer">{code}</div>
  ),
}))

import { PermissionDialog } from './PermissionDialog'
import { useChatStore, type PerSessionState } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

const ACTIVE_TAB = 'active-tab'

function makeSessionState(overrides: Partial<PerSessionState> = {}): PerSessionState {
  return {
    messages: [],
    chatState: 'permission_pending',
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
    composerPrefill: null,
    ...overrides,
  }
}

describe('PermissionDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useTabStore.setState({
      activeTabId: ACTIVE_TAB,
      tabs: [{ sessionId: ACTIVE_TAB, title: 'Test', type: 'session', status: 'idle' }],
    })
  })

  it('renders ExitPlanMode input as a readable markdown plan preview', () => {
    const input = {
      allowedPrompts: [{ tool: 'Bash', prompt: '检查工作目录状态' }],
      plan: '# 俄罗斯方块游戏实现方案\n\n## Context\n用户要实现一个可玩的小游戏。\n\n## Steps\n\n1. 创建画布。\n2. 实现方块移动。',
      planFilePath: 'C:\\Users\\Administrator\\.claude\\plans\\Lucky-dreaming-lightning.md',
    }

    useChatStore.setState({
      sessions: {
        [ACTIVE_TAB]: makeSessionState({
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'ExitPlanMode',
            input,
          },
        }),
      },
    })

    render(
      <PermissionDialog
        requestId="perm-1"
        toolName="ExitPlanMode"
        input={input}
      />,
    )

    expect(screen.getByText('确认这份计划？')).toBeInTheDocument()
    expect(screen.getByText('俄罗斯方块游戏实现方案')).toBeInTheDocument()
    expect(screen.getByText('Context')).toBeInTheDocument()
    expect(screen.getByText('创建画布。')).toBeInTheDocument()
    expect(screen.getByText(/计划文件: C:\\Users\\Administrator/)).toBeInTheDocument()
    expect(screen.queryByText(/allowedPrompts/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /显示完整输入/ }))

    expect(screen.getByText(/allowedPrompts/)).toBeInTheDocument()
  })

  it('offers ExitPlanMode implement and feedback actions', () => {
    const originalRespondToPermission = useChatStore.getState().respondToPermission
    const respondToPermission = vi.fn()
    const input = {
      plan: '# Tetris plan\n\n1. Create `tetris.html`.\n2. Add keyboard controls.',
      planFilePath: 'C:\\Users\\Administrator\\.claude\\plans\\tetris.md',
    }

    try {
      useSettingsStore.setState({ locale: 'en' })
      useChatStore.setState({
        respondToPermission,
        sessions: {
          [ACTIVE_TAB]: makeSessionState({
            pendingPermission: {
              requestId: 'perm-2',
              toolName: 'ExitPlanMode',
              input,
            },
          }),
        },
      })

      render(
        <PermissionDialog
          requestId="perm-2"
          toolName="ExitPlanMode"
          input={input}
        />,
      )

      expect(screen.getByRole('button', { name: /Implement plan/ })).toBeInTheDocument()
      expect(screen.getByText(/Confirm to let Gugu implement the plan/i)).toBeInTheDocument()
      const updateButton = screen.getByRole('button', { name: /Submit feedback/ })
      expect(updateButton).toBeDisabled()
      expect(screen.queryByRole('button', { name: /^Allow$/ })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /Implement plan/ }))
      expect(respondToPermission).toHaveBeenCalledWith(ACTIVE_TAB, 'perm-2', true)

      respondToPermission.mockClear()
      fireEvent.change(screen.getByPlaceholderText('Describe anything to add, remove, or change...'), {
        target: { value: 'Keep everything in one HTML file.' },
      })
      expect(updateButton).not.toBeDisabled()
      fireEvent.click(updateButton)

      expect(respondToPermission).toHaveBeenCalledWith(ACTIVE_TAB, 'perm-2', false, {
        message: 'Please revise the plan based on this feedback:\n\nKeep everything in one HTML file.',
      })
    } finally {
      act(() => {
        useChatStore.setState({ respondToPermission: originalRespondToPermission })
      })
    }
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageEntry } from '../types/session'
import { useSessionRuntimeStore } from './sessionRuntimeStore'

const {
  sendMock,
  getMemberBySessionIdMock,
  sendMessageToMemberMock,
  handleTeamCreatedMock,
  handleTeamUpdateMock,
  handleTeamDeletedMock,
  fetchSessionTasksMock,
  clearTasksMock,
  setTasksFromTodosMock,
  markCompletedAndDismissedMock,
  resetCompletedTasksMock,
  refreshTasksMock,
  notifyChatTaskCompleteMock,
  cliTaskStoreSnapshot,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getMemberBySessionIdMock: vi.fn<(sessionId: string) => any>(() => null),
  sendMessageToMemberMock: vi.fn(async () => {}),
  handleTeamCreatedMock: vi.fn(),
  handleTeamUpdateMock: vi.fn(),
  handleTeamDeletedMock: vi.fn(),
  fetchSessionTasksMock: vi.fn(),
  clearTasksMock: vi.fn(),
  setTasksFromTodosMock: vi.fn(),
  markCompletedAndDismissedMock: vi.fn(),
  resetCompletedTasksMock: vi.fn(async () => {}),
  refreshTasksMock: vi.fn(),
  notifyChatTaskCompleteMock: vi.fn(),
  cliTaskStoreSnapshot: {
    tasks: [] as Array<{ id: string; subject: string; status: string; activeForm?: string }>,
    sessionId: null as string | null,
  },
}))

vi.mock('../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: sendMock,
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('./teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: getMemberBySessionIdMock,
      sendMessageToMember: sendMessageToMemberMock,
      handleTeamCreated: handleTeamCreatedMock,
      handleTeamUpdate: handleTeamUpdateMock,
      handleTeamDeleted: handleTeamDeletedMock,
    }),
  },
}))

vi.mock('./tabStore', () => ({
  useTabStore: {
    getState: () => ({
      updateTabStatus: vi.fn(),
      updateTabTitle: vi.fn(),
    }),
  },
}))

vi.mock('./sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      updateSessionTitle: vi.fn(),
    }),
  },
}))

vi.mock('./cliTaskStore', () => ({
  useCLITaskStore: {
    getState: () => ({
      fetchSessionTasks: fetchSessionTasksMock,
      tasks: cliTaskStoreSnapshot.tasks,
      sessionId: cliTaskStoreSnapshot.sessionId,
      clearTasks: clearTasksMock,
      setTasksFromTodos: setTasksFromTodosMock,
      markCompletedAndDismissed: markCompletedAndDismissedMock,
      resetCompletedTasks: resetCompletedTasksMock,
      refreshTasks: refreshTasksMock,
    }),
  },
}))

vi.mock('../utils/taskCompletionNotification', () => ({
  notifyChatTaskComplete: notifyChatTaskCompleteMock,
}))

import { mapHistoryMessagesToUiMessages, useChatStore, type PerSessionState } from './chatStore'
import { buildCeWorkflowMessage } from '../constants/ceWorkflowRoles'
import { buildPlanModeMessage } from '../constants/agentRunModes'
import { buildOfficeToolMessage } from '../constants/officeTools'
import { buildTaskContextMessage } from '../constants/taskContextGraph'
import { sessionsApi } from '../api/sessions'
import { wsManager } from '../api/websocket'

const TEST_SESSION_ID = 'test-session-1'
const initialState = useChatStore.getState()

function makeSession(overrides: Partial<PerSessionState> = {}): PerSessionState {
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
    isCompacting: false,
    statusVerb: '',
    statusElapsedSeconds: 0,
    slashCommands: [],
    agentTaskNotifications: {},
    elapsedTimer: null,
    composerPrefill: null,
    ...overrides,
  }
}

function seedSession(overrides: Partial<PerSessionState> = {}) {
  useChatStore.setState({
    sessions: {
      [TEST_SESSION_ID]: makeSession(overrides),
    },
  })
}

describe('chatStore history mapping', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getMemberBySessionIdMock.mockReset()
    getMemberBySessionIdMock.mockReturnValue(null)
    sendMessageToMemberMock.mockReset()
    fetchSessionTasksMock.mockReset()
    clearTasksMock.mockReset()
    setTasksFromTodosMock.mockReset()
    markCompletedAndDismissedMock.mockReset()
    resetCompletedTasksMock.mockReset()
    refreshTasksMock.mockReset()
    notifyChatTaskCompleteMock.mockReset()
    cliTaskStoreSnapshot.tasks = []
    cliTaskStoreSnapshot.sessionId = null
    vi.mocked(wsManager.connect).mockClear()
    vi.mocked(wsManager.disconnect).mockClear()
    vi.mocked(wsManager.clearHandlers).mockClear()
    vi.mocked(wsManager.onMessage).mockReset()
    vi.mocked(wsManager.onMessage).mockImplementation(() => () => {})
    useSessionRuntimeStore.setState({ selections: {} })
    localStorage.clear()
    useChatStore.setState({
      ...initialState,
      sessions: {},
    })
  })

  it('preserves thinking blocks when restoring transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'thinking', thinking: 'internal reasoning' },
          { type: 'text', text: '目录结构分析' },
          { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: 'src/App.tsx' } },
        ],
      },
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:01.000Z',
        parentToolUseId: 'agent-1',
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'ok', is_error: false },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped.map((message) => message.type)).toEqual([
      'thinking',
      'assistant_text',
      'tool_use',
      'tool_result',
    ])
    expect(mapped[2]).toMatchObject({ parentToolUseId: 'agent-1' })
    expect(mapped[3]).toMatchObject({ parentToolUseId: 'agent-1' })
  })

  it('marks proactive tick history and skips hidden tick prompts', () => {
    const mapped = mapHistoryMessagesToUiMessages([
      {
        id: 'tick-user',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<tick>12:00:00</tick>',
        origin: { kind: 'proactive_tick' },
      },
      {
        id: 'tick-assistant',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:01.000Z',
        model: 'test-model',
        origin: { kind: 'proactive_tick' },
        content: [
          { type: 'thinking', thinking: 'checking quietly' },
          { type: 'text', text: 'still here' },
        ],
      },
    ])

    expect(mapped.some((message) => message.type === 'user_text')).toBe(false)
    expect(mapped.find((message) => message.type === 'thinking')).toMatchObject({
      origin: 'proactive_tick',
    })
    expect(mapped.find((message) => message.type === 'assistant_text')).toMatchObject({
      content: 'still here',
      origin: 'proactive_tick',
    })
  })

  it('maps restored thinking to a brief Chinese status', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '粗略看下这个文件',
      },
      {
        id: 'assistant-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:01.000Z',
        content: [
          {
            type: 'thinking',
            thinking: 'The user wants me to look at the attached PDF file. Let me inspect the parsed attachment results.',
          },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped[1]).toMatchObject({
      type: 'thinking',
      content: '正在检查附件',
    })
  })

  it('merges consecutive assistant text blocks when restoring transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'assistant-merge-1',
        type: 'assistant',
        timestamp: '2026-04-06T00:00:00.000Z',
        model: 'opus',
        content: [
          { type: 'text', text: '第一段：Windows 下的桌面端输出。' },
          { type: 'text', text: '\r\n第二段：刷新后也不应该被拆开。' },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：Windows 下的桌面端输出。\r\n第二段：刷新后也不应该被拆开。',
      },
    ])
  })

  it('surfaces teammate prompt content when mapping member transcript history', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: '<teammate-message teammate_id="security-reviewer">Review the auth diff and call out risks.</teammate-message>',
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages, {
      includeTeammateMessages: true,
    })

    expect(mapped).toMatchObject([
      {
        type: 'user_text',
        content: 'Review the auth diff and call out risks.',
      },
    ])
  })

  it('preserves source user ids when restoring array-content user prompts', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-with-attachment',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          { type: 'text', text: '请看这个文件' },
          { type: 'file', name: 'report.md' },
        ],
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-with-attachment',
        type: 'user_text',
        content: '请看这个文件',
        attachments: [{ type: 'file', name: 'report.md' }],
      },
    ])
  })

  it('restores a locally submitted image when attachment parser history no longer contains the raw image block', async () => {
    seedSession()

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      'parsed wire prompt',
      [{ type: 'image', name: 'whale.png', data: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png' }],
      {
        displayContent: '',
        displayAttachments: [
          { type: 'image', name: 'whale.png', data: 'data:image/png;base64,aW1hZ2U=', mimeType: 'image/png' },
        ],
      },
    )

    seedSession()
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      messages: [
        {
          id: 'history-user-with-parser-output',
          type: 'user',
          timestamp: '2026-04-06T00:00:00.000Z',
          content: [
            {
              type: 'text',
              text: '<闄勪欢瑙ｆ瀽缁撴灉>\nimage markdown\n</闄勭欢瑙ｆ瀽缁撴灉>\n\n<鐢ㄦ埛姝ｆ枃>\n\n</鐢ㄦ埛姝ｆ枃>',
            },
          ],
        },
      ],
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.some((message) =>
        message.type === 'user_text' &&
        message.attachments?.some((attachment) =>
          attachment.type === 'image' &&
          attachment.name === 'whale.png' &&
          attachment.data === 'data:image/png;base64,aW1hZ2U='
        )
      ),
    ).toBe(true)
  })

  it('shows only the user prompt in the local echo for current attachment parser XML tags', () => {
    seedSession()
    const wire = [
      'The user uploaded attachments. The following attachment parse results were generated from those files.',
      '',
      '<attachment_parse_results>',
      '## Attachment 1: lesson.md',
      'Parsed method: local text parser',
      '</attachment_parse_results>',
      '',
      '<user_message>',
      'How many paragraphs are there?',
      '</user_message>',
    ].join('\n')

    useChatStore.getState().sendMessage(TEST_SESSION_ID, wire, [])

    const session = useChatStore.getState().getSession(TEST_SESSION_ID)
    expect(session.messages[0]).toMatchObject({
      type: 'user_text',
      content: 'How many paragraphs are there?',
    })
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'user_message',
      content: wire,
      attachments: [],
    }))
  })

  it('shows task context notices locally without sending them to the server', () => {
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'wire prompt', [], {
      displayContent: 'user prompt',
      taskContextNotice: '已识别为：编码。会优先使用强模型处理复杂内容。',
      ceModelPreference: 'strong',
    })

    const session = useChatStore.getState().getSession(TEST_SESSION_ID)
    expect(session.messages).toMatchObject([
      { type: 'user_text', content: 'user prompt' },
      { type: 'system', content: '已识别为：编码。会优先使用强模型处理复杂内容。', variant: 'task_context' },
    ])
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'user_message',
      content: 'wire prompt',
      attachments: [],
      ceModelPreference: 'strong',
    }))
  })

  it('does not send a new local message while the session is active', () => {
    seedSession({ chatState: 'thinking' })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'second message')

    expect(sendMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])
  })
  it('does not send a new local message while stop confirmation is pending', () => {
    seedSession({ chatState: 'stopping' })

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'continue too soon')

    expect(sendMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])
  })

  it('removes the optimistic local message when a stale client receives a busy rejection', () => {
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'second message')
    const sent = sendMock.mock.calls.find(([, payload]) => {
      return typeof payload === 'object' && payload !== null && (payload as { type?: string }).type === 'user_message'
    })?.[1] as { clientMessageId?: string } | undefined
    expect(sent?.clientMessageId).toEqual(expect.any(String))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'user_message_rejected',
      data: {
        reason: 'session_busy',
        clientMessageId: sent!.clientMessageId,
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('thinking')
    expect(session?.messages.some((message) => message.id === sent!.clientMessageId)).toBe(false)
    expect(session?.messages).toEqual([
      expect.objectContaining({
        type: 'system',
        content: expect.stringContaining('not sent'),
      }),
    ])
  })

  it('does not resurrect raw attachment parser local echoes from older versions', async () => {
    seedSession()
    const wire = [
      'The user uploaded attachments. The following attachment parse results were generated from those files.',
      '',
      '<attachment_parse_results>',
      '## Attachment 1: lesson.md',
      'Parsed method: local text parser',
      '</attachment_parse_results>',
      '',
      '<user_message>',
      'How many paragraphs are there?',
      '</user_message>',
    ].join('\n')
    localStorage.setItem('gugu-agent-local-user-echoes-v1', JSON.stringify([
      {
        sessionId: TEST_SESSION_ID,
        createdAt: Date.now(),
        message: {
          id: 'old-local-raw-echo',
          type: 'user_text',
          content: wire,
          timestamp: Date.now(),
        },
      },
    ]))
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      messages: [
        {
          id: 'history-user-with-parser-output',
          type: 'user',
          timestamp: '2026-04-06T00:00:00.000Z',
          content: wire,
        },
      ],
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]).toMatchObject({
      id: 'history-user-with-parser-output',
      type: 'user_text',
      content: 'How many paragraphs are there?',
    })
  })

  it('replaces optimistic local-only messages when richer transcript history arrives', async () => {
    seedSession({
      messages: [{
        id: 'local-user-1',
        type: 'user_text',
        content: 'write a txt file',
        timestamp: 1,
      }],
    })
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      messages: [
        {
          id: 'history-user-1',
          type: 'user',
          timestamp: '2026-04-06T00:00:00.000Z',
          content: 'write a txt file',
        },
        {
          id: 'history-assistant-1',
          type: 'assistant',
          timestamp: '2026-04-06T00:00:01.000Z',
          content: [{ type: 'text', text: '已创建 `D:\\Claude Code\\MyWindows\\test.txt`。' }],
        },
      ],
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages?.some((message) =>
      message.type === 'assistant_text' &&
      message.content.includes('test.txt')
    )).toBe(true)
  })

  it('replaces equal-length stale local messages when transcript content differs', async () => {
    seedSession({
      messages: [
        {
          id: 'local-user-1',
          type: 'user_text',
          content: 'bilibili.com/video/BV1rpeezNEnW/',
          timestamp: 1,
        },
        {
          id: 'local-user-2',
          type: 'user_text',
          content: 'help identify the product in this video',
          timestamp: 2,
        },
      ],
    })
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      messages: [
        {
          id: 'history-user-1',
          type: 'user',
          timestamp: '2026-04-06T00:00:00.000Z',
          content: 'bilibili.com/video/BV1rpeezNEnW/ help identify the product in this video',
        },
        {
          id: 'history-assistant-1',
          type: 'assistant',
          timestamp: '2026-04-06T00:00:01.000Z',
          content: 'I will inspect the video and identify the product.',
        },
      ],
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toHaveLength(2)
    expect(messages?.some((message) =>
      message.type === 'assistant_text' &&
      message.content.includes('identify the product')
    )).toBe(true)
  })

  it('keeps status elapsed time moving after an attachment parsing notice', () => {
    vi.useFakeTimers()
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '处理附件', [])
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: '正在解析附件，已等待 15 秒',
      elapsed: 15,
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusElapsedSeconds).toBe(15)

    vi.advanceTimersByTime(2000)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.elapsedSeconds).toBe(2)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusElapsedSeconds).toBe(17)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'thinking',
      verb: '正在解析附件，已等待 15 秒',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.statusElapsedSeconds).toBe(17)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'idle',
    })
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('blocks new user messages while context compaction is running', () => {
    vi.useFakeTimers()
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '/compact', undefined, {
      displayContent: 'Auto compacting context',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(true)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'system',
        content: 'Auto compacting context',
        variant: 'compact_pending',
      },
    ])
    const messageCountAfterCompact = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.length ?? 0
    sendMock.mockClear()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'this should wait')

    expect(sendMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(messageCountAfterCompact)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'idle',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(true)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 10, output_tokens: 1 },
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(true)

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'this should still wait')
    expect(sendMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(messageCountAfterCompact)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'compact_boundary',
      message: 'Context compacted',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toHaveLength(messageCountAfterCompact)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages[0]).toMatchObject({
      type: 'system',
      content: 'Context automatically compacted',
      variant: 'compact_complete',
    })
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(false)

    sendMock.mockClear()
    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'continue after compact')
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'user_message',
      content: 'continue after compact',
    }))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 11, output_tokens: 2 },
    })
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('unlocks context compaction if the boundary event never arrives', () => {
    vi.useFakeTimers()
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '/compact', undefined, {
      displayContent: 'Auto compacting context',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 10, output_tokens: 1 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(true)

    vi.advanceTimersByTime(2_999)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.isCompacting).toBe(true)

    vi.advanceTimersByTime(1)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.isCompacting).toBe(false)
    expect(session?.messages[0]).toMatchObject({
      type: 'system',
      content: 'Context automatically compacted',
      variant: 'compact_complete',
    })

    sendMock.mockClear()
    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'continue after compact fallback')
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'user_message',
      content: 'continue after compact fallback',
    }))

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 11, output_tokens: 2 },
    })
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('filters blank assistant transcript messages from history', () => {
    const mapped = mapHistoryMessagesToUiMessages([
      {
        id: 'assistant-empty',
        type: 'assistant',
        timestamp: '2026-06-09T00:00:00.000Z',
        content: '   ',
      },
      {
        id: 'assistant-visible',
        type: 'assistant',
        timestamp: '2026-06-09T00:00:01.000Z',
        content: 'visible result',
      },
    ])

    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({ type: 'assistant_text', content: 'visible result' })
  })

  it('shows a visible notice when a turn completes with no assistant text', () => {
    seedSession({
      messages: [
        {
          id: 'user-empty-result',
          type: 'user_text',
          content: '再检查一下',
          timestamp: Date.now(),
        },
      ],
      chatState: 'streaming',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 10, output_tokens: 0 },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.messages).toHaveLength(2)
    expect(session?.messages[1]).toMatchObject({ type: 'system' })
    if (session?.messages[1]?.type === 'system') {
      expect(session.messages[1].content.length).toBeGreaterThan(0)
      expect(session.messages[1].content).toMatch(/visible|可显示/i)
    }
  })

  it('accepts richer transcript history while the local turn still appears active', async () => {
    seedSession({
      chatState: 'thinking',
      activeThinkingId: 'thinking-1',
      messages: [
        {
          id: 'local-user-1',
          type: 'user_text',
          content: 'summarize the project',
          timestamp: 1,
        },
        {
          id: 'thinking-1',
          type: 'thinking',
          content: 'Thinking',
          rawContent: 'Thinking',
          timestamp: 2,
        },
      ],
    })
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({
      messages: [
        {
          id: 'history-user-1',
          type: 'user',
          timestamp: '2026-06-07T00:00:00.000Z',
          content: 'summarize the project',
        },
        {
          id: 'history-assistant-1',
          type: 'assistant',
          timestamp: '2026-06-07T00:00:01.000Z',
          content: 'Project summary is ready.',
        },
      ],
    })

    await useChatStore.getState().loadHistory(TEST_SESSION_ID)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'assistant_text',
        content: 'Project summary is ready.',
      }),
    ]))
    expect(session?.messages.some((message) => message.id === 'thinking-1')).toBe(false)
  })

  it('does not resurrect a forgotten local echo after rewind history reloads', async () => {
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'write a table')
    useChatStore.getState().forgetLocalUserEcho(TEST_SESSION_ID, {
      id: 'server-user-id',
      content: 'write a table',
    })
    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({ messages: [] })

    await useChatStore.getState().reloadHistory(TEST_SESSION_ID)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])
  })

  it('rewinds local-only messages and forgets the optimistic echo', async () => {
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, 'write a table')
    const localUser = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.find(
      (message) => message.type === 'user_text',
    )
    expect(localUser?.type).toBe('user_text')

    useChatStore.setState((state) => {
      const session = state.sessions[TEST_SESSION_ID]!
      return {
        sessions: {
          ...state.sessions,
          [TEST_SESSION_ID]: {
            ...session,
            messages: [
              ...session.messages,
              {
                id: 'assistant-after-local',
                type: 'assistant_text',
                content: 'working',
                timestamp: 2,
              },
            ],
            streamingText: 'partial',
          },
        },
      }
    })

    const result = useChatStore.getState().rewindLocalMessages(TEST_SESSION_ID, {
      id: localUser!.id,
      content: localUser!.type === 'user_text' ? localUser!.content : '',
      attachments: localUser!.type === 'user_text' ? localUser!.attachments : undefined,
      userMessageIndex: 0,
    })
    expect(result).toEqual({ messagesRemoved: 2 })

    const sessionAfterRewind = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(sessionAfterRewind?.messages).toEqual([])
    expect(sessionAfterRewind?.chatState).toBe('idle')
    expect(sessionAfterRewind?.streamingText).toBe('')

    vi.mocked(sessionsApi.getMessages).mockResolvedValueOnce({ messages: [] })
    await useChatStore.getState().reloadHistory(TEST_SESSION_ID)

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toEqual([])
  })

  it('keeps parent tool linkage for live tool events', () => {
    // Initialize the session first
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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
          slashCommands: [{ name: 'old-command', description: 'Old command' }],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'src/App.tsx' },
      parentToolUseId: 'agent-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      content: 'ok',
      isError: false,
      parentToolUseId: 'agent-1',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'tool_use',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
      {
        type: 'tool_result',
        toolUseId: 'tool-1',
        parentToolUseId: 'agent-1',
      },
    ])
  })

  it('does not send set_runtime_config on connect (model comes from server .env)', () => {
    useSessionRuntimeStore.getState().setSelection(TEST_SESSION_ID, {
      providerId: 'provider-1',
      modelId: 'kimi-k2.6',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(
      sendMock.mock.calls.some(
        (c) => c[0] === TEST_SESSION_ID && (c[1] as { type?: string })?.type === 'set_runtime_config',
      ),
    ).toBe(false)
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, { type: 'prewarm_session' })
  })

  it('prewarms regular desktop sessions when connecting', () => {
    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('routes websocket status updates to the matching session only', () => {
    const handlers = new Map<string, Parameters<typeof wsManager.onMessage>[1]>()
    vi.mocked(wsManager.onMessage).mockImplementation((sessionId, handler) => {
      handlers.set(sessionId, handler)
      return () => {}
    })

    useChatStore.getState().connectToSession('session-a')
    useChatStore.getState().connectToSession('session-b')

    handlers.get('session-a')?.({ type: 'status', state: 'thinking', verb: 'checking A', elapsed: 3 })
    handlers.get('session-b')?.({ type: 'status', state: 'tool_executing', verb: 'checking B', elapsed: 5 })

    const sessions = useChatStore.getState().sessions
    expect(sessions['session-a']).toMatchObject({
      chatState: 'thinking',
      statusVerb: 'checking A',
      statusElapsedSeconds: 3,
    })
    expect(sessions['session-b']).toMatchObject({
      chatState: 'tool_executing',
      statusVerb: 'checking B',
      statusElapsedSeconds: 5,
    })
  })

  it('stops only the requested session and waits for backend idle confirmation', () => {
    useChatStore.setState({
      sessions: {
        'session-a': makeSession({
          chatState: 'permission_pending',
          activeToolUseId: 'tool-a',
          activeToolName: 'Bash',
          activeThinkingId: 'thinking-a',
          streamingToolInput: 'npm run build',
          pendingPermission: {
            requestId: 'perm-a',
            toolName: 'Bash',
            input: { command: 'npm run build' },
          },
          statusVerb: 'Waiting for permission',
          statusElapsedSeconds: 12,
        }),
        'session-b': makeSession({
          chatState: 'streaming',
          streamingText: 'partial B',
          activeThinkingId: 'thinking-b',
          statusVerb: 'Streaming B',
          statusElapsedSeconds: 8,
        }),
      },
    })

    useChatStore.getState().stopGeneration('session-a')

    expect(sendMock).toHaveBeenCalledWith('session-a', { type: 'stop_generation' })
    expect(sendMock).not.toHaveBeenCalledWith('session-b', { type: 'stop_generation' })
    expect(useChatStore.getState().sessions['session-a']).toMatchObject({
      chatState: 'stopping',
      activeToolUseId: null,
      activeToolName: null,
      activeThinkingId: null,
      streamingToolInput: '',
      pendingPermission: null,
      pendingPermissionQueue: [],
      pendingComputerUsePermission: null,
      statusVerb: '',
      statusElapsedSeconds: 0,
    })

    useChatStore.getState().handleServerMessage('session-a', { type: 'status', state: 'idle' })
    expect(useChatStore.getState().sessions['session-a']?.chatState).toBe('idle')

    expect(useChatStore.getState().sessions['session-b']).toMatchObject({
      chatState: 'streaming',
      streamingText: 'partial B',
      activeThinkingId: 'thinking-b',
      statusVerb: 'Streaming B',
      statusElapsedSeconds: 8,
    })
  })

  it('unlocks a stopping session if the backend idle confirmation is lost', () => {
    vi.useFakeTimers()
    try {
      useChatStore.setState({
        sessions: {
          'session-a': makeSession({
            chatState: 'streaming',
            streamingText: 'partial response',
            statusVerb: 'Streaming',
            statusElapsedSeconds: 8,
          }),
        },
      })

      useChatStore.getState().stopGeneration('session-a')

      expect(useChatStore.getState().sessions['session-a']?.chatState).toBe('stopping')

      vi.advanceTimersByTime(7_999)
      expect(useChatStore.getState().sessions['session-a']?.chatState).toBe('stopping')

      vi.advanceTimersByTime(1)
      expect(useChatStore.getState().sessions['session-a']).toMatchObject({
        chatState: 'idle',
        activeToolUseId: null,
        activeToolName: null,
        activeThinkingId: null,
        pendingPermission: null,
        pendingPermissionQueue: [],
        pendingComputerUsePermission: null,
        statusVerb: '',
        statusElapsedSeconds: 0,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends effort updates to the active session', () => {
    seedSession()

    useChatStore.getState().setSessionEffort(TEST_SESSION_ID, 'high')

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'set_effort',
      level: 'high',
    })
  })

  it('does not send effort updates while a turn is running', () => {
    seedSession({ chatState: 'tool_executing' })

    useChatStore.getState().setSessionEffort(TEST_SESSION_ID, 'high')

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does not prewarm team member sessions', () => {
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'reviewer@test-team',
      role: 'reviewer',
      status: 'running',
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(sendMock).not.toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'prewarm_session',
    })
  })

  it('does not prewarm synthetic app tabs', () => {
    useChatStore.getState().connectToSession('__settings__')

    expect(sendMock).not.toHaveBeenCalledWith('__settings__', {
      type: 'prewarm_session',
    })
  })

  it('keeps AskUserQuestion permission requests out of the message list while tracking the pending request', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            {
              id: 'ask-1',
              type: 'tool_use',
              toolName: 'AskUserQuestion',
              toolUseId: 'tool-ask-1',
              input: {
                questions: [
                  {
                    question: 'Should we persist data?',
                    options: [{ label: 'No' }, { label: 'Yes' }],
                  },
                ],
              },
              timestamp: 1,
            },
          ],
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            question: 'Should we persist data?',
            options: [{ label: 'No' }, { label: 'Yes' }],
          },
        ],
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
    })
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'tool_use',
      toolUseId: 'tool-ask-1',
    })
  })

  it('queues command permission requests behind an unanswered AskUserQuestion prompt', () => {
    seedSession({
      messages: [
        {
          id: 'ask-1',
          type: 'tool_use',
          toolName: 'AskUserQuestion',
          toolUseId: 'tool-ask-1',
          input: {
            questions: [
              {
                question: 'Technical stack?',
                options: [{ label: 'HTML' }, { label: 'React' }],
              },
            ],
          },
          timestamp: 1,
        },
        {
          id: 'bash-1',
          type: 'tool_use',
          toolName: 'Bash',
          toolUseId: 'tool-bash-1',
          input: { command: 'ls -la "D:\\Claude Code\\Test"' },
          timestamp: 2,
        },
      ],
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'tool-ask-1',
      input: {
        questions: [
          {
            question: 'Technical stack?',
            options: [{ label: 'HTML' }, { label: 'React' }],
          },
        ],
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'permission_request',
      requestId: 'perm-bash-1',
      toolName: 'Bash',
      toolUseId: 'tool-bash-1',
      input: { command: 'ls -la "D:\\Claude Code\\Test"' },
      description: 'List files in working directory',
    })

    let session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
    })
    expect(session?.pendingPermissionQueue).toHaveLength(1)
    expect(session?.messages.some((message) => message.type === 'permission_request')).toBe(false)

    useChatStore.getState().respondToPermission(TEST_SESSION_ID, 'perm-ask-1', true, {
      updatedInput: {
        answers: {
          'Technical stack?': 'HTML',
        },
      },
    })

    session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-ask-1',
      allowed: true,
      updatedInput: {
        answers: {
          'Technical stack?': 'HTML',
        },
      },
    })
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-bash-1',
      toolName: 'Bash',
    })
    expect(session?.pendingPermissionQueue).toEqual([])
    expect(session?.chatState).toBe('permission_pending')
    expect(session?.messages.filter((message) => message.type === 'permission_request')).toMatchObject([
      {
        type: 'permission_request',
        requestId: 'perm-bash-1',
        toolName: 'Bash',
        toolUseId: 'tool-bash-1',
      },
    ])
  })

  it('does not advance the visible permission when a queued request is answered out of order', () => {
    seedSession({
      pendingPermission: {
        requestId: 'perm-ask-1',
        toolName: 'AskUserQuestion',
        toolUseId: 'tool-ask-1',
        input: { questions: [{ question: '继续吗？' }] },
      },
      pendingPermissionQueue: [
        {
          requestId: 'perm-bash-1',
          toolName: 'Bash',
          toolUseId: 'tool-bash-1',
          input: { command: 'ls' },
        },
      ],
      chatState: 'permission_pending',
    })

    useChatStore.getState().respondToPermission(TEST_SESSION_ID, 'perm-bash-1', true)

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.pendingPermission).toMatchObject({
      requestId: 'perm-ask-1',
      toolName: 'AskUserQuestion',
    })
    expect(session?.pendingPermissionQueue).toEqual([])
    expect(session?.chatState).toBe('permission_pending')
  })

  it('sends permission denial feedback messages to the server', () => {
    seedSession({
      pendingPermission: {
        requestId: 'perm-plan-1',
        toolName: 'ExitPlanMode',
        input: { plan: 'Plan' },
      },
      chatState: 'permission_pending',
    })

    useChatStore.getState().respondToPermission(TEST_SESSION_ID, 'perm-plan-1', false, {
      message: 'Please revise the plan.',
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'permission_response',
      requestId: 'perm-plan-1',
      allowed: false,
      message: 'Please revise the plan.',
    })
  })

  it('ignores stale permission status heartbeats after a permission was answered', () => {
    seedSession({
      chatState: 'tool_executing',
      statusVerb: '',
      pendingPermission: null,
      pendingComputerUsePermission: null,
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'permission_pending',
      verb: 'Waiting for permission',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('tool_executing')
    expect(session?.statusVerb).toBe('')
  })

  it('sends permission mode updates to the active session only', () => {
    useChatStore.getState().setSessionPermissionMode('nonexistent-session', 'acceptEdits')
    expect(sendMock).not.toHaveBeenCalled()

    useChatStore.setState({
      sessions: {
        'session-1': {
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
    useChatStore.getState().setSessionPermissionMode('session-1', 'acceptEdits')

    expect(sendMock).toHaveBeenCalledWith('session-1', {
      type: 'set_permission_mode',
      mode: 'acceptEdits',
    })
  })

  it('does not send permission mode updates while a turn is running', () => {
    seedSession({ chatState: 'permission_pending' })

    useChatStore.getState().setSessionPermissionMode(TEST_SESSION_ID, 'bypassPermissions')

    expect(sendMock).not.toHaveBeenCalled()
  })

  it('stores terminal task notifications for agent tool cards', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'task_notification',
      data: {
        task_id: 'agent-task-1',
        tool_use_id: 'agent-tool-1',
        status: 'completed',
        summary: 'Agent "修复异常处理" completed',
        output_file: '/tmp/agent-output.txt',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.agentTaskNotifications[
        'agent-tool-1'
      ],
    ).toMatchObject({
      taskId: 'agent-task-1',
      toolUseId: 'agent-tool-1',
      status: 'completed',
      summary: 'Agent "修复异常处理" completed',
      outputFile: '/tmp/agent-output.txt',
    })
  })

  it('clears local desktop chat state when the server confirms /clear', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [
            { id: 'u1', type: 'user_text', content: '/clear', timestamp: Date.now() },
            { id: 'a1', type: 'assistant_text', content: 'old context', timestamp: Date.now() },
          ],
          chatState: 'thinking',
          connectionState: 'connected',
          streamingText: 'pending',
          streamingToolInput: 'tool',
          activeToolUseId: 'tool-1',
          activeToolName: 'Read',
          activeThinkingId: 'thinking-1',
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 12, output_tokens: 34 },
          elapsedSeconds: 5,
          statusVerb: 'Thinking',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'session_cleared',
      message: 'Conversation cleared',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toEqual([])
    expect(session?.streamingText).toBe('')
    expect(session?.chatState).toBe('idle')
    expect(session?.tokenUsage).toEqual({ input_tokens: 0, output_tokens: 0 })
    expect(session?.slashCommands).toEqual([])
    expect(clearTasksMock).toHaveBeenCalled()
  })

  it('renders compact boundary notifications as system messages', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'compact_boundary',
      message: 'Context compacted',
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      { type: 'system', content: 'Context automatically compacted', variant: 'compact_complete' },
    ])
  })

  it('renders agent recovery notifications as neutral system messages and unlocks input', () => {
    seedSession({
      chatState: 'thinking',
      streamingText: 'partial answer',
      activeThinkingId: 'thinking-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'agent_recovery',
      message: '本轮响应长时间未恢复，已自动停止。当前停在：等待模型继续输出；尚未得到最终回复。你可以重新运行，或直接说「从这里继续」。',
      data: { reason: 'agent_stalled' },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.streamingText).toBe('')
    expect(session?.messages).toMatchObject([
      {
        type: 'system',
        content: '本轮响应长时间未恢复，已自动停止。当前停在：等待模型继续输出；尚未得到最终回复。你可以重新运行，或直接说「从这里继续」。',
      },
    ])
  })

  it('keeps the turn active for non-terminal model stall notifications', () => {
    seedSession({
      chatState: 'thinking',
      streamingText: 'partial answer',
      activeThinkingId: 'thinking-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'agent_recovery',
      message: '模型响应暂时中断，正在等待恢复。你可以继续等待，或点击停止后重试。',
      data: { reason: 'model_stream_stalled' },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('thinking')
    expect(session?.streamingText).toBe('partial answer')
    expect(session?.activeThinkingId).toBe('thinking-1')
    expect(session?.messages).toMatchObject([
      {
        type: 'system',
        content: '模型响应暂时中断，正在等待恢复。你可以继续等待，或点击停止后重试。',
      },
    ])
  })

  it('keeps the turn active after a restored connection still has no progress', () => {
    seedSession({
      chatState: 'thinking',
      streamingText: '',
      activeThinkingId: 'thinking-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'agent_recovery',
      message: 'Agent 连接已恢复，但本轮还没有新的输出；Gugu 会继续等待，长时间没有进展时会自动停止并给出下一步。',
      data: { reason: 'agent_restored_without_progress', reconnects: 1 },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('thinking')
    expect(session?.activeThinkingId).toBe('thinking-1')
    expect(session?.messages).toMatchObject([
      {
        type: 'system',
        content: 'Agent 连接已恢复，但本轮还没有新的输出；Gugu 会继续等待，长时间没有进展时会自动停止并给出下一步。',
      },
    ])
  })

  it('maps live thinking to a brief Chinese status', () => {
    seedSession({
      chatState: 'thinking',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: '粗略看下这个文件',
          timestamp: 1,
        },
      ],
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'The user wants me to inspect the attached PDF file and OCR parsing results.',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'Looking at the attachment parsing results, this appears to be a datasheet PDF.',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages).toMatchObject([
      { type: 'user_text', content: '粗略看下这个文件' },
      {
        type: 'thinking',
        content: '正在检查附件',
      },
    ])
  })

  it('hides proactive tick thinking and successful tool progress while keeping final text', () => {
    seedSession({ chatState: 'idle' })

    const store = useChatStore.getState()
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'turn_origin',
      origin: 'proactive_tick',
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: 'checking quietly',
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_use_complete',
      toolName: 'Bash',
      toolUseId: 'tool-1',
      input: { command: 'git status' },
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'tool_result',
      toolUseId: 'tool-1',
      content: 'ok',
      isError: false,
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'still here',
    })
    store.handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.currentTurnOrigin).toBeNull()
    expect(session?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: 'still here',
        origin: 'proactive_tick',
      },
    ])
  })

  it('keeps consecutive proactive tick replies as separate assistant messages', () => {
    seedSession({ chatState: 'idle' })

    const store = useChatStore.getState()
    const sendTickReply = (text: string) => {
      store.handleServerMessage(TEST_SESSION_ID, {
        type: 'turn_origin',
        origin: 'proactive_tick',
      })
      store.handleServerMessage(TEST_SESSION_ID, {
        type: 'content_start',
        blockType: 'text',
      })
      store.handleServerMessage(TEST_SESSION_ID, {
        type: 'content_delta',
        text,
      })
      store.handleServerMessage(TEST_SESSION_ID, {
        type: 'message_complete',
        usage: { input_tokens: 1, output_tokens: 1 },
      })
    }

    sendTickReply('first check-in')
    sendTickReply('second check-in')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: 'first check-in',
        origin: 'proactive_tick',
      },
      {
        type: 'assistant_text',
        content: 'second check-in',
        origin: 'proactive_tick',
      },
    ])
  })

  it('keeps throttled streaming text isolated between simultaneous sessions', () => {
    vi.useFakeTimers()
    try {
      useChatStore.setState({
        sessions: {
          sessionA: makeSession({ chatState: 'streaming' }),
          sessionB: makeSession({ chatState: 'streaming' }),
        },
      })

      const store = useChatStore.getState()
      store.handleServerMessage('sessionA', { type: 'content_delta', text: 'Alpha' })
      store.handleServerMessage('sessionB', { type: 'content_delta', text: 'Beta' })

      vi.advanceTimersByTime(60)

      const sessions = useChatStore.getState().sessions
      expect(sessions.sessionA?.streamingText).toBe('Alpha')
      expect(sessions.sessionB?.streamingText).toBe('Beta')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops one session without flushing another session pending stream', () => {
    vi.useFakeTimers()
    try {
      useChatStore.setState({
        sessions: {
          sessionA: makeSession({ chatState: 'streaming' }),
          sessionB: makeSession({ chatState: 'streaming' }),
        },
      })

      const store = useChatStore.getState()
      store.handleServerMessage('sessionA', { type: 'content_delta', text: 'Alpha' })
      store.handleServerMessage('sessionB', { type: 'content_delta', text: 'Beta' })
      store.stopGeneration('sessionA')

      let sessions = useChatStore.getState().sessions
      expect(sendMock).toHaveBeenCalledWith('sessionA', { type: 'stop_generation' })
      expect(sessions.sessionA?.chatState).toBe('stopping')
      expect(sessions.sessionA?.streamingText).toBe('Alpha')
      expect(sessions.sessionB?.streamingText).toBe('')

      vi.advanceTimersByTime(60)

      sessions = useChatStore.getState().sessions
      expect(sessions.sessionB?.streamingText).toBe('Beta')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps chunked thinking streams as one brief status without exposing raw fragments', () => {
    seedSession({
      chatState: 'thinking',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: '这是什么',
          timestamp: 1,
        },
      ],
    })

    for (const text of ['鬼', '灭', '之', '刃']) {
      useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
        type: 'thinking',
        text,
      })
    }

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages[session.messages.length - 1]).toMatchObject({
      type: 'thinking',
      content: '正在分析上下文',
    })
  })

  it('maps live Chinese thinking text to a brief status', () => {
    seedSession({
      chatState: 'thinking',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: '这是什么',
          timestamp: 1,
        },
      ],
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'thinking',
      text: '我需要先查看附件解析结果。',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.messages[session.messages.length - 1]).toMatchObject({
      type: 'thinking',
      content: '正在检查附件',
    })
  })

  it('strips hidden CE workflow preamble when restoring user transcript history', () => {
    const { wire } = buildCeWorkflowMessage('quick', '这是什么')
    const messages: MessageEntry[] = [
      {
        id: 'user-ce-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-ce-1',
        type: 'user_text',
        content: '这是什么',
      },
    ])
  })

  it('strips hidden plan mode preamble when restoring user transcript history', () => {
    const { wire } = buildPlanModeMessage('Plan the composer modes')
    const messages: MessageEntry[] = [
      {
        id: 'user-plan-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-plan-1',
        type: 'user_text',
        content: 'Plan the composer modes',
      },
    ])
  })

  it('strips hidden office toolbox preamble when restoring user transcript history', () => {
    const { wire } = buildOfficeToolMessage('coding-assistant', '写个俄罗斯方块', {
      hasAttachments: false,
    })
    const messages: MessageEntry[] = [
      {
        id: 'user-office-tool-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-office-tool-1',
        type: 'user_text',
        content: '写个俄罗斯方块',
      },
    ])
  })

  it('strips hidden task context router preamble when restoring user transcript history', () => {
    const message = buildTaskContextMessage('Please debug this crash', {
      text: 'Please debug this crash',
      workDir: 'D:/project/app',
    })
    expect(message).not.toBeNull()
    const messages: MessageEntry[] = [
      {
        id: 'user-task-context-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: message!.wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-task-context-1',
        type: 'user_text',
        content: 'Please debug this crash',
      },
    ])
  })

  it('does not show internal office toolbox fallback text for attachment-only history', () => {
    const { wire } = buildOfficeToolMessage('file-assistant', '', {
      hasAttachments: true,
    })
    const messages: MessageEntry[] = [
      {
        id: 'user-office-attachment-only-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-office-attachment-only-1',
        type: 'user_text',
        content: '',
      },
    ])
  })

  it('strips nested plan and office toolbox scaffolding from restored transcript text', () => {
    const { wire: officeWire } = buildOfficeToolMessage('ppt-draft', '做一份发布会 PPT', {
      hasAttachments: false,
    })
    const { wire } = buildPlanModeMessage(officeWire)
    const messages: MessageEntry[] = [
      {
        id: 'user-office-plan-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-office-plan-1',
        type: 'user_text',
        content: '做一份发布会 PPT',
      },
    ])
  })

  it('strips deeply nested hidden scaffolding from restored transcript text', () => {
    const prompt = 'Summarize this long uploaded lesson'
    const { wire: officeWire } = buildOfficeToolMessage('document-summary', prompt, {
      hasAttachments: true,
    })
    const { wire: planWire } = buildPlanModeMessage(officeWire)
    const attachmentWire = [
      'The user uploaded attachments. The following attachment parse results were generated from those files.',
      '',
      '<attachment_parse_results>',
      '## Attachment 1: lesson.md',
      'Parsed method: local text parser',
      'Long lesson content.',
      '</attachment_parse_results>',
      '',
      '<user_message>',
      planWire,
      '</user_message>',
    ].join('\n')
    const { wire } = buildPlanModeMessage(attachmentWire)

    const mapped = mapHistoryMessagesToUiMessages([
      {
        id: 'user-deeply-nested-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: wire,
      },
    ])

    expect(mapped).toMatchObject([
      {
        id: 'user-deeply-nested-1',
        type: 'user_text',
        content: prompt,
      },
    ])
  })

  it('shows only the original prompt when restoring GLM attachment parser transcript text', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-glm-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          '用户上传了附件。以下“附件解析结果”由 GLM 根据附件生成。',
          '',
          '<附件解析结果>',
          '## 附件 1: screen.png',
          '一张应用截图',
          '</附件解析结果>',
          '',
          '<用户正文>',
          '这是什么',
          '</用户正文>',
        ].join('\n'),
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-glm-1',
        type: 'user_text',
        content: '这是什么',
      },
    ])
  })

  it('shows only the original prompt when restoring current attachment parser XML tags', () => {
    const messages: MessageEntry[] = [
      {
        id: 'user-attachment-xml-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          'The user uploaded attachments. The following attachment parse results were generated from those files.',
          '',
          '<attachment_parse_results>',
          '## Attachment 1: lesson.md',
          'Parsed method: local text parser',
          '</attachment_parse_results>',
          '',
          '<user_message>',
          'How many paragraphs are there?',
          '</user_message>',
        ].join('\n'),
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-attachment-xml-1',
        type: 'user_text',
        content: 'How many paragraphs are there?',
      },
    ])
  })

  it('strips nested GLM and CE workflow scaffolding from restored transcript text', () => {
    const { wire } = buildCeWorkflowMessage('quick', '这是什么')
    const messages: MessageEntry[] = [
      {
        id: 'user-nested-1',
        type: 'user',
        timestamp: '2026-04-06T00:00:00.000Z',
        content: [
          '用户上传了附件。以下“附件解析结果”由 GLM 根据附件生成。',
          '',
          '<附件解析结果>',
          '## 附件 1: screen.png',
          '一张应用截图',
          '</附件解析结果>',
          '',
          '<用户正文>',
          wire,
          '</用户正文>',
        ].join('\n'),
      },
    ]

    const mapped = mapHistoryMessagesToUiMessages(messages)

    expect(mapped).toMatchObject([
      {
        id: 'user-nested-1',
        type: 'user_text',
        content: '这是什么',
      },
    ])
  })

  it('renders attachment parser failures as neutral system messages and unlocks input', () => {
    seedSession({
      chatState: 'thinking',
      streamingText: 'partial answer',
      activeThinkingId: 'thinking-1',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'attachment_parser',
      message: 'Please configure GLM API Key before parsing attachments.',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.streamingText).toBe('')
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({ type: 'system' })
    const content = session?.messages[0]?.type === 'system' ? session.messages[0].content : ''
    expect(content).toContain('Attachment parsing did not finish')
    expect(content).toContain('The file parsing model is unavailable or not configured.')
    expect(content).toContain('Please configure GLM API Key before parsing attachments.')
  })

  it('explains managed attachment parser quota failures clearly', () => {
    seedSession({ chatState: 'thinking' })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'attachment_parser',
      message: 'Gugu 托管附件解析失败：额度已用完，请购买套餐或输入激活码继续使用。',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    const content = session?.messages[0]?.type === 'system' ? session.messages[0].content : ''
    expect(content).toContain('Gugu managed attachment parsing credits have been used up.')
    expect(content).toContain('Normal chat still works, but this attachment was not parsed')
    expect(content).toContain('Purchase a plan, enter an activation code')
  })

  it('attaches successful parser previews to the visible user message without adding a chat bubble', () => {
    seedSession({
      chatState: 'thinking',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: '这是什么',
          timestamp: 1,
          attachments: [
            {
              type: 'image',
              name: 'screen.png',
              data: 'data:image/png;base64,abc123',
              mimeType: 'image/png',
            },
          ],
        },
      ],
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'attachment_parser',
      data: {
        status: 'parsed',
        preview: {
          promptText: '<附件解析结果>\n# 截图\n</附件解析结果>',
          results: [
            {
              name: 'screen.png',
              type: 'image',
              mimeType: 'image/png',
              method: 'vision',
              markdown: '# 截图\n一个应用界面。',
            },
          ],
        },
      },
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('thinking')
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'user_text',
      content: '这是什么',
      attachmentParser: {
        promptText: '<附件解析结果>\n# 截图\n</附件解析结果>',
        results: [
          {
            name: 'screen.png',
            method: 'vision',
            markdown: '# 截图\n一个应用界面。',
          },
        ],
      },
    })
  })

  it('turns recoverable agent timeout errors into neutral system messages', () => {
    seedSession({ chatState: 'thinking' })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      code: 'CLI_ERROR',
      message: '本轮响应长时间未恢复，已自动停止。当前停在：等待上游模型继续输出；尚未得到最终回复。你可以重新运行，或直接说「从这里继续」。',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'system',
      content: '本轮响应长时间未恢复，已自动停止。当前停在：等待上游模型继续输出；尚未得到最终回复。你可以重新运行，或直接说「从这里继续」。',
    })
  })

  it('turns max-turn errors into neutral system messages', () => {
    seedSession({ chatState: 'thinking' })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      code: 'CLI_ERROR',
      message: 'Reached maximum number of turns (20)',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'system',
    })
    if (session?.messages[0]?.type === 'system') {
      expect(session.messages[0].content).toContain('20')
    }
  })

  it('shows max-turn system notifications without entering error state', () => {
    seedSession({ chatState: 'thinking' })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'system_notification',
      subtype: 'max_turns_reached',
      message: '本轮连续操作已达到上限（20 轮），Gugu 已先停下来。',
    })

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.chatState).toBe('idle')
    expect(session?.messages).toHaveLength(1)
    expect(session?.messages[0]).toMatchObject({
      type: 'system',
      content: '本轮连续操作已达到上限（20 轮），Gugu 已先停下来。',
    })
  })

  it('turns unsupported image provider errors into assistant guidance', () => {
    seedSession()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      code: 'invalid_request_error',
      message:
        'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Model \\"deepseek-v4-pro\\" does not support image input on the active provider. Switch to a vision-capable provider/model, or send text only."}}',
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]).toMatchObject({ type: 'assistant_text' })
    const content = messages?.[0]?.type === 'assistant_text' ? messages[0].content : ''
    expect(content).not.toContain('API Error')
    expect(content).not.toContain('deepseek-v4-pro')
    expect(content.length).toBeGreaterThan(0)
  })

  it('deduplicates the follow-up CLI error for unsupported attachments', () => {
    seedSession()
    const providerError =
      'Model "deepseek-v4-pro" does not support image input on the active provider. Switch to a vision-capable provider/model, or send text only.'

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      code: 'invalid_request_error',
      message: providerError,
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'error',
      code: 'CLI_ERROR',
      message: `API Error: 400 ${providerError}`,
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toHaveLength(1)
    expect(messages?.[0]).toMatchObject({ type: 'assistant_text' })
  })

  it('replaces streamed unsupported attachment API text with assistant guidance', () => {
    seedSession()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text:
        'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Model \\"deepseek-v4-pro\\" does not support image input on the active provider. Switch to a vision-capable provider/model, or send text only."}}',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 0, output_tokens: 0 },
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    const content = messages?.[0]?.type === 'assistant_text' ? messages[0].content : ''
    expect(messages).toHaveLength(1)
    expect(content).not.toContain('API Error')
    expect(content).not.toContain('deepseek-v4-pro')
    expect(content.length).toBeGreaterThan(0)
  })

  it('flushes the previous assistant draft before starting a new user turn', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'streaming',
          connectionState: 'connected',
          streamingText: '上一次分析结果 **还在流式区域**',
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

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '你是什么模型？')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '上一次分析结果 **还在流式区域**',
      },
      {
        type: 'user_text',
        content: '你是什么模型？',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeThinkingId).toBeNull()
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.streamingText).toBe('')
  })

  it('does not add a local thinking block for casual default-mode chat', () => {
    seedSession()

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '用掉点额度，随便回复几句')

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '用掉点额度，随便回复几句',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.some((message) => message.type === 'thinking')).toBe(false)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState).toBe('thinking')
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeThinkingId).toBeNull()
  })

  it('uses the visible text from CE wire prompts when the local display echo is blank', () => {
    seedSession()
    const prompt = '请构建一个小型网站，用于展示动漫女性角色排行，并设计美观界面。'
    const { wire } = buildCeWorkflowMessage('standard', prompt)

    useChatStore.getState().sendMessage(TEST_SESSION_ID, wire, [], {
      displayContent: '',
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toMatchObject([
      {
        type: 'user_text',
        content: prompt,
      },
    ])
    expect(messages?.some((message) => message.type === 'thinking')).toBe(false)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeThinkingId).toBeNull()
    if (messages?.[0]?.type === 'user_text') {
      expect(messages[0].content).not.toContain('[Workflow:')
    }
  })

  it('uses the original user prompt from attachment parser wire prompts when the local display echo is blank', () => {
    seedSession()
    const wire = [
      'The user uploaded attachments. The following attachment parse results were generated from those files.',
      '',
      '<attachment_parse_results>',
      '## Attachment 1: lesson.md',
      'Parsed method: local text parser',
      'A long lesson draft.',
      '</attachment_parse_results>',
      '',
      '<user_message>',
      'How many paragraphs are there?',
      '</user_message>',
    ].join('\n')

    useChatStore.getState().sendMessage(TEST_SESSION_ID, wire, [], {
      displayContent: '',
    })

    const messages = useChatStore.getState().sessions[TEST_SESSION_ID]?.messages
    expect(messages).toMatchObject([
      {
        type: 'user_text',
        content: 'How many paragraphs are there?',
      },
    ])
    if (messages?.[0]?.type === 'user_text') {
      expect(messages[0].content).not.toContain('<attachment_parse_results>')
      expect(messages[0].content).not.toContain('<user_message>')
    }
  })

  it('keeps an intentionally blank local echo for unrecognized attachment parser payloads', () => {
    seedSession()

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      'parsed wire prompt',
      undefined,
      {
        displayContent: '',
        displayAttachments: [
          {
            type: 'image',
            name: 'screen.png',
            data: 'aW1hZ2U=',
            mimeType: 'image/png',
          },
        ],
      },
    )

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages[0]).toMatchObject({
      type: 'user_text',
      content: '',
      attachments: [
        {
          type: 'image',
          name: 'screen.png',
          data: 'data:image/png;base64,aW1hZ2U=',
        },
      ],
    })
  })

  it('can display image attachments without sending them over the wire', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().sendMessage(
      TEST_SESSION_ID,
      'image as base64 text',
      undefined,
      {
        displayContent: '看这张图',
        displayAttachments: [
          {
            type: 'image',
            name: 'screen.png',
            data: 'aW1hZ2U=',
            mimeType: 'image/png',
          },
        ],
      },
    )

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, expect.objectContaining({
      type: 'user_message',
      content: 'image as base64 text',
      attachments: undefined,
    }))
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'user_text',
        content: '看这张图',
        attachments: [
          {
            type: 'image',
            name: 'screen.png',
            data: 'data:image/png;base64,aW1hZ2U=',
          },
        ],
      },
    ])
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.messages.some((message) => message.type === 'thinking'),
    ).toBe(false)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeThinkingId).toBeNull()
  })

  it('resets completed CLI tasks before continuing the next user turn', () => {
    cliTaskStoreSnapshot.sessionId = TEST_SESSION_ID
    cliTaskStoreSnapshot.tasks = [
      { id: '1', subject: 'Existing completed task', status: 'completed' },
      { id: '2', subject: 'Another completed task', status: 'completed' },
    ]

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().sendMessage(TEST_SESSION_ID, '继续下一轮')

    expect(resetCompletedTasksMock).toHaveBeenCalledTimes(1)
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'task_summary',
        tasks: [
          { id: '1', subject: 'Existing completed task', status: 'completed' },
          { id: '2', subject: 'Another completed task', status: 'completed' },
        ],
      },
      {
        type: 'user_text',
        content: '继续下一轮',
      },
    ])
    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.activeThinkingId).toBeNull()
  })

  it('tracks Computer Use approval requests separately from generic tool permissions', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'computer_use_permission_request',
      requestId: 'cu-1',
      request: {
        requestId: 'cu-1',
        reason: 'Open Finder and inspect a file',
        apps: [
          {
            requestedName: 'Finder',
            resolved: {
              bundleId: 'com.apple.finder',
              displayName: 'Finder',
            },
            isSentinel: false,
            alreadyGranted: false,
            proposedTier: 'full',
          },
        ],
        requestedFlags: { clipboardRead: true },
        screenshotFiltering: 'native',
      },
    })

    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toMatchObject({
      requestId: 'cu-1',
      request: {
        reason: 'Open Finder and inspect a file',
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('permission_pending')
  })

  it('notifies when an active user turn completes', () => {
    seedSession({
      chatState: 'thinking',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: 'build a small page',
          timestamp: 1,
        },
      ],
      streamingText: 'Done.',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(notifyChatTaskCompleteMock).toHaveBeenCalledWith({
      sessionId: TEST_SESSION_ID,
      sessionTitle: undefined,
    })
  })

  it('does not notify for idle duplicate completion events', () => {
    seedSession({
      chatState: 'idle',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: 'build a small page',
          timestamp: 1,
        },
      ],
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(notifyChatTaskCompleteMock).not.toHaveBeenCalled()
  })

  it('keeps delayed text blocks from one streamed assistant turn in a single message', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '第一段：先到达。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '\r\n第二段：稍后到达，但仍属于同一轮回复。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: '第一段：先到达。\r\n第二段：稍后到达，但仍属于同一轮回复。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('deduplicates full snapshot text that arrives after streamed text', () => {
    vi.useFakeTimers()
    seedSession()

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'Configured API key auth.',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'Configured API key auth. Ready.',
    })
    vi.advanceTimersByTime(60)
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: 'Configured API key auth. Ready.',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content: 'Configured API key auth. Ready.',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('does not split one streamed markdown reply when task progress arrives mid-stream', () => {
    vi.useFakeTimers()

    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_start',
      blockType: 'text',
    })
    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'status',
      state: 'tool_executing',
      verb: 'Task in progress',
    })

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'content_delta',
      text: ' 建议直接用 `subprocess.PIPE` 流式处理。',
    })
    vi.advanceTimersByTime(60)

    useChatStore.getState().handleServerMessage(TEST_SESSION_ID, {
      type: 'message_complete',
      usage: { input_tokens: 1, output_tokens: 2 },
    })

    expect(useChatStore.getState().sessions[TEST_SESSION_ID]?.messages).toMatchObject([
      {
        type: 'assistant_text',
        content:
          '1. **`core/audio/waveform.py:19-31`** — 同步阻塞 I/O。 建议直接用 `subprocess.PIPE` 流式处理。',
      },
    ])

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('sends Computer Use approval payloads back over websocket', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
          messages: [],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: {
            requestId: 'cu-1',
            request: {
              requestId: 'cu-1',
              reason: 'Open Finder',
              apps: [],
              requestedFlags: {},
              screenshotFiltering: 'native',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    useChatStore.getState().respondToComputerUsePermission(TEST_SESSION_ID, 'cu-1', {
      granted: [],
      denied: [],
      flags: {
        clipboardRead: true,
        clipboardWrite: false,
        systemKeyCombos: false,
      },
      userConsented: true,
    })

    expect(sendMock).toHaveBeenCalledWith(TEST_SESSION_ID, {
      type: 'computer_use_permission_response',
      requestId: 'cu-1',
      response: {
        granted: [],
        denied: [],
        flags: {
          clipboardRead: true,
          clipboardWrite: false,
          systemKeyCombos: false,
        },
        userConsented: true,
      },
    })
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.pendingComputerUsePermission,
    ).toBeNull()
    expect(
      useChatStore.getState().sessions[TEST_SESSION_ID]?.chatState,
    ).toBe('tool_executing')
  })

  it('routes member-session messages through team mailbox delivery instead of websocket', async () => {
    const memberSessionId = 'team-member:security-reviewer@test-team'
    getMemberBySessionIdMock.mockReturnValue({
      agentId: 'security-reviewer@test-team',
      role: 'security-reviewer',
      status: 'running',
    })

    useChatStore.setState({
      sessions: {
        [memberSessionId]: {
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

    useChatStore.getState().sendMessage(memberSessionId, 'Check the latest regression')
    await Promise.resolve()

    expect(sendMessageToMemberMock).toHaveBeenCalledWith(
      memberSessionId,
      'Check the latest regression',
    )
    expect(sendMock).not.toHaveBeenCalled()
    const sessionMessages = useChatStore.getState().sessions[memberSessionId]?.messages ?? []

    expect(sessionMessages[sessionMessages.length - 1]).toMatchObject({
      type: 'user_text',
      content: 'Check the latest regression',
      pending: true,
    })
  })

  it('preserves optimistic messages and active state when reconnecting a just-submitted session', async () => {
    seedSession({
      connectionState: 'disconnected',
      chatState: 'thinking',
      activeThinkingId: 'thinking-1',
      messages: [
        {
          id: 'user-1',
          type: 'user_text',
          content: 'build a small website',
          timestamp: 1,
        },
        {
          id: 'thinking-1',
          type: 'thinking',
          content: 'Thinking',
          rawContent: 'Thinking',
          timestamp: 2,
        },
      ],
    })

    useChatStore.getState().connectToSession(TEST_SESSION_ID)
    await Promise.resolve()

    const session = useChatStore.getState().sessions[TEST_SESSION_ID]
    expect(session?.connectionState).toBe('connecting')
    expect(session?.chatState).toBe('thinking')
    expect(session?.activeThinkingId).toBe('thinking-1')
    expect(session?.messages).toMatchObject([
      { type: 'user_text', content: 'build a small website' },
      { type: 'thinking', id: 'thinking-1' },
    ])
  })

  it('refreshes CLI tasks when switching to an already-connected session', () => {
    useChatStore.setState({
      sessions: {
        [TEST_SESSION_ID]: {
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

    useChatStore.getState().connectToSession(TEST_SESSION_ID)

    expect(fetchSessionTasksMock).toHaveBeenCalledWith(TEST_SESSION_ID)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, listMock, renameMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  renameMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    create: createMock,
    list: listMock,
    delete: vi.fn(),
    rename: renameMock,
  },
}))

import { useSessionStore } from './sessionStore'
import { useTabStore } from './tabStore'

const initialState = useSessionStore.getState()
const initialTabState = useTabStore.getState()

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessionStore', () => {
  beforeEach(() => {
    createMock.mockReset()
    listMock.mockReset()
    renameMock.mockReset()
    useSessionStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
      removedProjects: [],
      newSessionWorkDir: null,
    })
    useTabStore.setState({
      ...initialTabState,
      tabs: [],
      activeTabId: null,
    })
  })

  afterEach(() => {
    useSessionStore.setState(initialState)
    useTabStore.setState(initialTabState)
  })

  it('returns a new session id before the background refresh completes', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-1' })
    listMock.mockImplementation(() => new Promise(() => {}))

    const result = await Promise.race([
      useSessionStore.getState().createSession('D:/workspace/code/myself_code/cc-haha'),
      delay(100).then(() => 'timed-out'),
    ])

    expect(result).toBe('session-optimistic-1')
    expect(useSessionStore.getState().activeSessionId).toBe('session-optimistic-1')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-1',
      title: 'New Session',
      workDir: 'D:/workspace/code/myself_code/cc-haha',
      workDirExists: true,
    })
    expect(listMock).toHaveBeenCalledOnce()
  })

  it('keeps the active optimistic empty session when a background refresh returns a stale list', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-2' })
    listMock.mockResolvedValue({ sessions: [], total: 0 })

    await useSessionStore.getState().createSession('/Users/hanwenhao/Downloads/HTML')
    await delay(0)

    expect(useSessionStore.getState().activeSessionId).toBe('session-optimistic-2')
    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-2',
      title: 'New Session',
      workDir: '/Users/hanwenhao/Downloads/HTML',
      workDirExists: true,
    })
  })

  it('keeps an optimistic workDir when the refresh item for the same session is missing it', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-optimistic-3' })
    listMock.mockResolvedValue({
      sessions: [{
        id: 'session-optimistic-3',
        title: 'New Session',
        createdAt: '2026-05-30T00:00:00.000Z',
        modifiedAt: '2026-05-30T00:00:00.000Z',
        messageCount: 0,
        projectPath: '',
        workDir: null,
        workDirExists: false,
      }],
      total: 1,
    })

    await useSessionStore.getState().createSession('/Users/hanwenhao/Downloads/HTML')
    await delay(0)

    expect(useSessionStore.getState().sessions[0]).toMatchObject({
      id: 'session-optimistic-3',
      workDir: '/Users/hanwenhao/Downloads/HTML',
      workDirExists: true,
    })
  })

  it('removes projects from the current sidebar state without deleting sessions', async () => {
    useSessionStore.setState({
      selectedProjects: ['/workspace/project-a', '/workspace/project-b'],
      removedProjects: [],
      newSessionWorkDir: '/workspace/project-a',
    })

    useSessionStore.getState().removeProjects(['/workspace/project-a'])

    expect(useSessionStore.getState().removedProjects).toEqual(['/workspace/project-a'])
    expect(useSessionStore.getState().selectedProjects).toEqual(['/workspace/project-b'])
    expect(useSessionStore.getState().newSessionWorkDir).toBeNull()

    createMock.mockResolvedValue({ sessionId: 'session-restored' })
    listMock.mockImplementation(() => new Promise(() => {}))

    await useSessionStore.getState().createSession('/workspace/project-a')

    expect(useSessionStore.getState().removedProjects).toEqual([])
  })

  it('keeps a pending sidebar new-session directory after creating a session', async () => {
    createMock.mockResolvedValue({ sessionId: 'session-created' })
    listMock.mockImplementation(() => new Promise(() => {}))
    useSessionStore.setState({ newSessionWorkDir: '/workspace/project-a' })

    await useSessionStore.getState().createSession('/workspace/project-a')

    expect(useSessionStore.getState().newSessionWorkDir).toBe('/workspace/project-a')
  })

  it('syncs an open tab title when a session is renamed', async () => {
    renameMock.mockResolvedValue({ ok: true })
    useSessionStore.setState({
      sessions: [{
        id: 'session-rename',
        title: '旧标题',
        createdAt: '2026-06-22T00:00:00.000Z',
        modifiedAt: '2026-06-22T00:00:00.000Z',
        messageCount: 3,
        projectPath: '',
        workDir: '/workspace/project-a',
        workDirExists: true,
      }],
    })
    useTabStore.setState({
      tabs: [{
        sessionId: 'session-rename',
        title: '旧标题',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'session-rename',
    })

    await useSessionStore.getState().renameSession('session-rename', '你是文案策划师')

    expect(renameMock).toHaveBeenCalledWith('session-rename', '你是文案策划师')
    expect(useSessionStore.getState().sessions[0]?.title).toBe('你是文案策划师')
    expect(useTabStore.getState().tabs[0]?.title).toBe('你是文案策划师')
  })
})

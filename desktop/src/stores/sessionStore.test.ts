import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    create: createMock,
    list: listMock,
    delete: vi.fn(),
    rename: vi.fn(),
  },
}))

import { useSessionStore } from './sessionStore'

const initialState = useSessionStore.getState()

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('sessionStore', () => {
  beforeEach(() => {
    createMock.mockReset()
    listMock.mockReset()
    useSessionStore.setState({
      ...initialState,
      sessions: [],
      activeSessionId: null,
      isLoading: false,
      error: null,
      selectedProjects: [],
      availableProjects: [],
    })
  })

  afterEach(() => {
    useSessionStore.setState(initialState)
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
})

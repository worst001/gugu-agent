import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { resolveNewSessionWorkDir } from './newSessionWorkDir'

describe('resolveNewSessionWorkDir', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      newSessionWorkDir: null,
      removedProjects: [],
    })
    useTabStore.setState({ tabs: [], activeTabId: null })
  })

  it('does not reuse a directory the user removed from the sidebar', () => {
    useSessionStore.setState({
      newSessionWorkDir: 'D:\\Workspace\\App',
      removedProjects: ['d:/workspace/app'],
      sessions: [
        {
          id: 'session-a',
          title: 'A',
          createdAt: '2026-06-19T08:00:00.000Z',
          modifiedAt: '2026-06-19T09:00:00.000Z',
          messageCount: 2,
          projectPath: 'app-key',
          workDir: 'D:\\Workspace\\App',
          workDirExists: true,
        },
      ],
    })
    useTabStore.setState({
      tabs: [{ sessionId: 'session-a', title: 'A', type: 'session', status: 'idle' }],
      activeTabId: 'session-a',
    })

    expect(resolveNewSessionWorkDir()).toBeUndefined()
  })
})

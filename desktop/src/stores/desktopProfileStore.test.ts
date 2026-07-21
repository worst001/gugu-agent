import { beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopProfileApi } from '../api/desktopProfile'
import { sessionsApi } from '../api/sessions'
import type { DesktopProfileBundle } from '../types/desktopProfile'
import {
  flushDesktopProfileWrites,
  useDesktopProfileStore,
} from './desktopProfileStore'
import {
  hydrateDesktopProfile,
  initializeDesktopProfilePersistence,
  reloadDesktopProfile,
  resetDesktopProfilePersistenceForTests,
} from './desktopProfilePersistence'
import { useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'
import { useTabStore } from './tabStore'
import { useUIStore } from './uiStore'
import { useWorkbenchStore } from './workbenchStore'

vi.mock('../api/desktopProfile', () => ({
  desktopProfileApi: {
    get: vi.fn(),
    patch: vi.fn(),
    reset: vi.fn(),
  },
}))

vi.mock('../api/sessions', () => ({
  sessionsApi: {
    list: vi.fn(),
  },
}))

const mockedApi = vi.mocked(desktopProfileApi)
const mockedSessionsApi = vi.mocked(sessionsApi)

function createBundle(migrated = false): DesktopProfileBundle {
  return {
    profile: {
      schemaVersion: 1,
      preferences: {
        appearance: { theme: 'dark', locale: 'zh' },
        layout: {
          sidebarWidth: 280,
          workbenchWidth: 390,
          capabilityPanelCollapsed: false,
        },
        updates: { dismissedVersion: null },
        work: { newSessionDefault: 'smart' },
      },
      migration: { legacyLocalStorageV1: migrated },
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    workspaceState: {
      schemaVersion: 1,
      projects: { pinned: [], removed: [] },
      tabs: { openTabs: [], activeTabId: null },
      drafts: {},
      assistants: { custom: [] },
      tools: { agentRunModes: {}, ceWorkflowRoles: {}, sessionRuntimes: {} },
      migration: { legacyLocalStorageV1: migrated },
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
  }
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  resetDesktopProfilePersistenceForTests()
  localStorage.clear()
  useDesktopProfileStore.setState({ bundle: null, loaded: false, lastError: null })
  useUIStore.setState({ theme: 'dark', sidebarWidth: 280, capabilityPanelCollapsed: false })
  useSettingsStore.setState({ theme: 'dark', locale: 'zh' })
  useWorkbenchStore.setState({ panelWidth: 390 })
  useSessionStore.setState({
    pinnedProjects: [],
    removedProjects: [],
    newSessionWorkType: 'smart',
  })
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('desktop profile migration', () => {
  it('migrates existing appearance, layout, and recoverable work state once', async () => {
    localStorage.setItem('cc-haha-theme', 'gray-dark')
    localStorage.setItem('cc-haha-locale', 'en')
    localStorage.setItem('gugu-agent-sidebar-width-v1', '332')
    localStorage.setItem('gugu-agent-workbench-width-v1', '444')
    localStorage.setItem('gugu-agent-pinned-projects-v1', JSON.stringify(['D:/work']))
    localStorage.setItem('cc-haha-agent-run-mode-v1', JSON.stringify({ session: 'plan' }))
    mockedApi.get.mockResolvedValue(createBundle(false))
    const migrated = createBundle(true)
    migrated.profile.preferences.appearance = { theme: 'gray-dark', locale: 'en' }
    migrated.profile.preferences.layout.sidebarWidth = 332
    migrated.profile.preferences.layout.workbenchWidth = 444
    migrated.workspaceState.projects.pinned = ['D:/work']
    migrated.workspaceState.tools.agentRunModes = { session: 'plan' }
    mockedApi.patch.mockResolvedValue(migrated)

    const result = await useDesktopProfileStore.getState().loadAndMigrate()

    expect(result?.profile.preferences.appearance).toEqual({ theme: 'gray-dark', locale: 'en' })
    expect(mockedApi.patch).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        migration: { legacyLocalStorageV1: true },
        preferences: expect.objectContaining({
          appearance: { theme: 'gray-dark', locale: 'en' },
          layout: expect.objectContaining({ sidebarWidth: 332, workbenchWidth: 444 }),
        }),
      }),
      workspaceState: expect.objectContaining({
        projects: expect.objectContaining({ pinned: ['D:/work'] }),
        tools: expect.objectContaining({ agentRunModes: { session: 'plan' } }),
      }),
    }))
  })

  it('keeps an already migrated profile authoritative over stale localStorage', async () => {
    localStorage.setItem('cc-haha-theme', 'light')
    const stored = createBundle(true)
    stored.profile.preferences.appearance.theme = 'green-dark'
    mockedApi.get.mockResolvedValue(stored)

    const result = await useDesktopProfileStore.getState().loadAndMigrate()

    expect(result?.profile.preferences.appearance.theme).toBe('green-dark')
    expect(mockedApi.patch).not.toHaveBeenCalled()
  })

  it('retains legacy values but does not mark a failed migration complete', async () => {
    localStorage.setItem('cc-haha-theme', 'pink-dark')
    mockedApi.get.mockResolvedValue(createBundle(false))
    mockedApi.patch.mockRejectedValue(new Error('disk unavailable'))

    const result = await useDesktopProfileStore.getState().loadAndMigrate()

    expect(result?.profile.preferences.appearance.theme).toBe('pink-dark')
    expect(result?.profile.migration.legacyLocalStorageV1).toBe(false)
    expect(result?.workspaceState.migration.legacyLocalStorageV1).toBe(false)
    expect(useDesktopProfileStore.getState().lastError).toBe('disk unavailable')
  })
})

describe('desktop profile hydration and autosave', () => {
  it('hydrates theme, locale, layout, and project choices from the profile', () => {
    const bundle = createBundle(true)
    bundle.profile.preferences.appearance = { theme: 'blue-dark', locale: 'en' }
    bundle.profile.preferences.layout = {
      sidebarWidth: 345,
      workbenchWidth: 456,
      capabilityPanelCollapsed: true,
    }
    bundle.profile.preferences.work.newSessionDefault = 'short_video_production'
    bundle.workspaceState.projects = { pinned: ['D:/pinned'], removed: ['D:/hidden'] }

    hydrateDesktopProfile(bundle)

    expect(useUIStore.getState()).toMatchObject({
      theme: 'blue-dark',
      sidebarWidth: 345,
      capabilityPanelCollapsed: true,
    })
    expect(useSettingsStore.getState()).toMatchObject({ theme: 'blue-dark', locale: 'en' })
    expect(useWorkbenchStore.getState().panelWidth).toBe(456)
    expect(useSessionStore.getState()).toMatchObject({
      pinnedProjects: ['D:/pinned'],
      removedProjects: ['D:/hidden'],
      newSessionWorkType: 'short_video_production',
    })
    expect(localStorage.getItem('cc-haha-theme')).toBe('blue-dark')
  })

  it('falls back to smart routing when a running legacy backend omits work preferences', () => {
    const legacyBundle = createBundle(true)
    delete (legacyBundle.profile.preferences as Partial<
      DesktopProfileBundle['profile']['preferences']
    >).work

    hydrateDesktopProfile(legacyBundle)

    expect(useSessionStore.getState().newSessionWorkType).toBe('smart')
  })

  it('replaces live tabs with the imported profile tabs on reload', async () => {
    const bundle = createBundle(true)
    bundle.workspaceState.tabs = {
      openTabs: [{
        sessionId: 'imported-session',
        title: 'Imported tab',
        type: 'session',
      }],
      activeTabId: 'imported-session',
    }
    mockedApi.get.mockResolvedValue(bundle)
    mockedSessionsApi.list.mockResolvedValue({
      sessions: [{
        id: 'imported-session',
        title: 'Imported session',
        createdAt: '2026-07-14T00:00:00.000Z',
        modifiedAt: '2026-07-14T00:00:00.000Z',
        messageCount: 1,
        projectPath: 'project',
        workDir: 'D:/project',
        workDirExists: true,
      }],
      total: 1,
    })
    useTabStore.setState({
      tabs: [{
        sessionId: 'old-session',
        title: 'Old tab',
        type: 'session',
        status: 'idle',
      }],
      activeTabId: 'old-session',
    })

    await reloadDesktopProfile()

    expect(useTabStore.getState()).toMatchObject({
      activeTabId: 'imported-session',
      tabs: [expect.objectContaining({
        sessionId: 'imported-session',
        title: 'Imported session',
      })],
    })
  })

  it('rolls back an optimistic profile patch when persistence fails', async () => {
    const bundle = createBundle(true)
    useDesktopProfileStore.setState({ bundle, loaded: true, lastError: null })
    mockedApi.patch.mockRejectedValue(new Error('disk unavailable'))

    const result = await useDesktopProfileStore.getState().patch({
      workspaceState: {
        assistants: {
          custom: [{
            id: 'custom-1',
            name: 'Temporary assistant',
            description: '',
            baseRole: 'knowledge_worker',
            instructions: 'Draft a report.',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
          }],
        },
      },
    })

    expect(result).toBe(bundle)
    expect(useDesktopProfileStore.getState().bundle).toBe(bundle)
    expect(useDesktopProfileStore.getState().lastError).toBe('disk unavailable')
  })
  it('coalesces UI changes into the profile after initialization', async () => {
    vi.useFakeTimers()
    const bundle = createBundle(true)
    mockedApi.get.mockResolvedValue(bundle)
    mockedApi.patch.mockImplementation(async () => bundle)
    await initializeDesktopProfilePersistence()

    useUIStore.getState().setTheme('green-dark')
    useUIStore.getState().setSidebarWidth(318)
    useSessionStore.getState().setNewSessionWorkType('knowledge_delivery')
    await vi.advanceTimersByTimeAsync(350)
    await flushDesktopProfileWrites()

    expect(mockedApi.patch).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        preferences: expect.objectContaining({
          appearance: { theme: 'green-dark' },
          layout: expect.objectContaining({ sidebarWidth: 318 }),
          work: { newSessionDefault: 'knowledge_delivery' },
        }),
      }),
    }))
  })
})

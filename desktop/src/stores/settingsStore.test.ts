import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  getPermissionMode: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
  listModels: vi.fn(),
  getCurrentModel: vi.fn(),
  setCurrentModel: vi.fn(),
  getEffort: vi.fn(),
  setEffort: vi.fn(),
  setPermissionMode: vi.fn(),
}))

vi.mock('../api/settings', () => ({
  settingsApi: {
    getPermissionMode: apiMocks.getPermissionMode,
    getUser: apiMocks.getUser,
    updateUser: apiMocks.updateUser,
    setPermissionMode: apiMocks.setPermissionMode,
  },
}))

vi.mock('../api/models', () => ({
  modelsApi: {
    list: apiMocks.listModels,
    getCurrent: apiMocks.getCurrentModel,
    setCurrent: apiMocks.setCurrentModel,
    getEffort: apiMocks.getEffort,
    setEffort: apiMocks.setEffort,
  },
}))

function mockFetchAllSettings(userSettings: Record<string, unknown>) {
  apiMocks.getPermissionMode.mockResolvedValue({ mode: 'default' })
  apiMocks.listModels.mockResolvedValue({ models: [], provider: null })
  apiMocks.getCurrentModel.mockResolvedValue({ model: null })
  apiMocks.getEffort.mockResolvedValue({ level: 'medium' })
  apiMocks.getUser.mockResolvedValue(userSettings)
}

describe('settingsStore locale defaults', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('defaults to Chinese when no locale is stored', async () => {
    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().locale).toBe('zh')
  })

  it('keeps a stored locale override', async () => {
    window.localStorage.setItem('cc-haha-locale', 'en')

    const { useSettingsStore } = await import('./settingsStore')

    expect(useSettingsStore.getState().locale).toBe('en')
  })
})

describe('theme mode helpers', () => {
  it('normalizes expanded theme modes and preserves colorway when toggling tone', async () => {
    const { getThemeOppositeTone, getThemeTone, normalizeThemeMode } = await import('../types/settings')

    expect(normalizeThemeMode('blue-dark')).toBe('blue-dark')
    expect(normalizeThemeMode('unknown-theme')).toBe('dark')
    expect(getThemeTone('pink-dark')).toBe('dark')
    expect(getThemeTone('green-light')).toBe('light')
    expect(getThemeOppositeTone('blue-light')).toBe('blue-dark')
    expect(getThemeOppositeTone('gray-dark')).toBe('gray-light')
  })
})

describe('settingsStore theme hydration', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    vi.clearAllMocks()
  })

  it('keeps a stored local theme when user settings omit theme', async () => {
    window.localStorage.setItem('cc-haha-theme', 'gray-dark')
    mockFetchAllSettings({})

    const { useSettingsStore } = await import('./settingsStore')
    const { useUIStore } = await import('./uiStore')

    await useSettingsStore.getState().fetchAll()

    expect(useSettingsStore.getState().theme).toBe('gray-dark')
    expect(useUIStore.getState().theme).toBe('gray-dark')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('gray-dark')
  })

  it('does not let shared user settings override the desktop theme', async () => {
    window.localStorage.setItem('cc-haha-theme', 'gray-dark')
    mockFetchAllSettings({ theme: 'light' })

    const { useSettingsStore } = await import('./settingsStore')
    const { useUIStore } = await import('./uiStore')

    await useSettingsStore.getState().fetchAll()

    expect(useSettingsStore.getState().theme).toBe('gray-dark')
    expect(useUIStore.getState().theme).toBe('gray-dark')
    expect(window.localStorage.getItem('cc-haha-theme')).toBe('gray-dark')
  })
})

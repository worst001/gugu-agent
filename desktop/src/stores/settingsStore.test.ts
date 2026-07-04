import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    expect(normalizeThemeMode('unknown-theme')).toBe('light')
    expect(getThemeTone('pink-dark')).toBe('dark')
    expect(getThemeTone('green-light')).toBe('light')
    expect(getThemeOppositeTone('blue-light')).toBe('blue-dark')
    expect(getThemeOppositeTone('gray-dark')).toBe('gray-light')
  })
})

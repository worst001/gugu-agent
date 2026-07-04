// Source: src/server/api/models.ts, src/server/api/settings.ts

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'
export const THEME_MODES = [
  'light',
  'dark',
  'blue-light',
  'blue-dark',
  'gray-light',
  'gray-dark',
  'pink-light',
  'pink-dark',
  'green-light',
  'green-dark',
] as const

export type ThemeMode = typeof THEME_MODES[number]

const THEME_MODE_SET = new Set<string>(THEME_MODES)

export function normalizeThemeMode(value: unknown): ThemeMode {
  return typeof value === 'string' && THEME_MODE_SET.has(value)
    ? value as ThemeMode
    : 'light'
}

export function getThemeTone(theme: ThemeMode): 'light' | 'dark' {
  return theme === 'dark' || theme.endsWith('-dark') ? 'dark' : 'light'
}

const THEME_OPPOSITE_TONE: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'light',
  'blue-light': 'blue-dark',
  'blue-dark': 'blue-light',
  'gray-light': 'gray-dark',
  'gray-dark': 'gray-light',
  'pink-light': 'pink-dark',
  'pink-dark': 'pink-light',
  'green-light': 'green-dark',
  'green-dark': 'green-light',
}

export function getThemeOppositeTone(theme: ThemeMode): ThemeMode {
  return THEME_OPPOSITE_TONE[theme]
}

export type ModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

export type UserSettings = {
  model?: string
  modelContext?: string
  effort?: EffortLevel
  permissionMode?: PermissionMode
  theme?: ThemeMode
  skipWebFetchPreflight?: boolean
  /** Default CLI working directory for new sessions (stored in ~/.claude/settings.json). */
  defaultSessionWorkDir?: string
  [key: string]: unknown
}

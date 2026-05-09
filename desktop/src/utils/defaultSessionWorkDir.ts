import { settingsApi } from '../api/settings'

/**
 * Preferred CLI cwd for new desktop sessions: user setting in ~/.claude/settings.json,
 * then optional Vite env for local dev (desktop/.env).
 */
export async function resolveDefaultSessionWorkDir(): Promise<string | undefined> {
  try {
    const user = await settingsApi.getUser()
    const fromSettings =
      typeof user.defaultSessionWorkDir === 'string'
        ? user.defaultSessionWorkDir.trim()
        : ''
    if (fromSettings) return fromSettings
  } catch {
    /* offline or API error — fall through to env */
  }

  const raw = import.meta.env.VITE_DEFAULT_SESSION_WORKDIR
  const fromEnv = typeof raw === 'string' ? raw.trim() : ''
  return fromEnv || undefined
}

import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'

export function resolveNewSessionWorkDir(): string | undefined {
  const { newSessionWorkDir, sessions } = useSessionStore.getState()
  const fromSidebar = normalizeWorkDir(newSessionWorkDir)
  if (fromSidebar) return fromSidebar

  const activeTabId = useTabStore.getState().activeTabId
  const activeSession = activeTabId
    ? sessions.find((session) => session.id === activeTabId)
    : null
  return normalizeWorkDir(activeSession?.workDir)
}

function normalizeWorkDir(workDir: string | null | undefined): string | undefined {
  const trimmed = typeof workDir === 'string' ? workDir.trim() : ''
  return trimmed || undefined
}

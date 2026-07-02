import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import { isProjectInSet } from './projectKeys'

export function resolveNewSessionWorkDir(): string | undefined {
  const { newSessionWorkDir, removedProjects, sessions } = useSessionStore.getState()
  const removedProjectSet = new Set(removedProjects)
  const fromSidebar = normalizeWorkDir(newSessionWorkDir)
  if (fromSidebar && !isProjectInSet(removedProjectSet, fromSidebar)) return fromSidebar

  const activeTabId = useTabStore.getState().activeTabId
  const activeSession = activeTabId
    ? sessions.find((session) => session.id === activeTabId)
    : null
  const fromActiveSession = normalizeWorkDir(activeSession?.workDir)
  if (fromActiveSession && !isProjectInSet(removedProjectSet, fromActiveSession)) return fromActiveSession
  return undefined
}

function normalizeWorkDir(workDir: string | null | undefined): string | undefined {
  const trimmed = typeof workDir === 'string' ? workDir.trim() : ''
  return trimmed || undefined
}

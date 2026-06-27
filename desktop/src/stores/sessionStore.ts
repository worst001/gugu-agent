import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useTabStore } from './tabStore'
import type { SessionListItem } from '../types/session'
import { resolveDefaultSessionWorkDir } from '../utils/defaultSessionWorkDir'
import { sanitizeSessionTitle } from '../utils/sessionTitle'
import { expandProjectKeys, isProjectInSet, projectMatchesKey } from '../utils/projectKeys'

const REMOVED_PROJECTS_STORAGE_KEY = 'gugu-agent-removed-projects-v1'

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]
  removedProjects: string[]
  newSessionWorkDir: string | null

  fetchSessions: (project?: string) => Promise<void>
  createSession: (workDir?: string) => Promise<string>
  forkSession: (
    sourceSessionId: string,
    target: {
      targetUserMessageId?: string
      userMessageIndex?: number
      expectedContent?: string
    },
  ) => Promise<{ sessionId: string; title: string }>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setSelectedProjects: (projects: string[]) => void
  setNewSessionWorkDir: (workDir: string | null) => void
  removeProjects: (projects: string[]) => void
  restoreProject: (project: string) => void
}

function loadRemovedProjects(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(REMOVED_PROJECTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return expandProjectKeys(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return []
  }
}

function saveRemovedProjects(projects: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(REMOVED_PROJECTS_STORAGE_KEY, JSON.stringify(expandProjectKeys(projects)))
  } catch {
    // localStorage can be unavailable or full; losing this preference should not block chat.
  }
}

function mergeFetchedSessionsWithOptimisticState(
  fetchedSessions: SessionListItem[],
  currentSessions: SessionListItem[],
  activeSessionId: string | null,
): SessionListItem[] {
  const currentById = new Map(currentSessions.map((session) => [session.id, session]))
  const merged = fetchedSessions.map((session) => {
    const current = currentById.get(session.id)
    if (!current) return session
    const workDir = session.workDir || current.workDir
    return {
      ...session,
      projectPath: session.projectPath || current.projectPath,
      workDir,
      workDirExists: session.workDir ? session.workDirExists : current.workDirExists,
    }
  })

  if (activeSessionId && !merged.some((session) => session.id === activeSessionId)) {
    const activeSession = currentById.get(activeSessionId)
    if (activeSession && activeSession.messageCount === 0) {
      merged.unshift(activeSession)
    }
  }

  return merged
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],
  removedProjects: loadRemovedProjects(),
  newSessionWorkDir: null,

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const currentSessions = get().sessions
      const activeSessionId = get().activeSessionId
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      // Deduplicate by session ID — keep the most recently modified entry
      const byId = new Map<string, SessionListItem>()
      for (const s of raw) {
        const existing = byId.get(s.id)
        if (!existing || new Date(s.modifiedAt) > new Date(existing.modifiedAt)) {
          byId.set(s.id, s)
        }
      }
      const fetchedSessions = [...byId.values()].map((session) => ({
        ...session,
        title: sanitizeSessionTitle(session.title),
      }))
      const sessions = mergeFetchedSessionsWithOptimisticState(
        fetchedSessions,
        currentSessions,
        activeSessionId,
      )
      const availableProjects = [...new Set(sessions.map((s) => s.projectPath).filter(Boolean))].sort()
      set({ sessions, availableProjects, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (workDir?: string) => {
    let resolved = workDir
    if (resolved === undefined || resolved === null || resolved === '') {
      resolved = await resolveDefaultSessionWorkDir()
    }
    if (resolved) {
      get().restoreProject(resolved)
    }
    const { sessionId: id } = await sessionsApi.create(resolved || undefined)
    const now = new Date().toISOString()
    const optimisticSession: SessionListItem = {
      id,
      title: 'New Session',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath: '',
      workDir: resolved ?? null,
      workDirExists: true,
    }

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
    }))

    void get().fetchSessions()
    return id
  },

  forkSession: async (sourceSessionId, target) => {
    const result = await sessionsApi.fork(sourceSessionId, target)
    if (result.workDir) {
      get().restoreProject(result.workDir)
    }
    const now = new Date().toISOString()
    const optimisticSession: SessionListItem = {
      id: result.sessionId,
      title: sanitizeSessionTitle(result.title),
      createdAt: now,
      modifiedAt: now,
      messageCount: result.messagesCopied,
      projectPath: '',
      workDir: result.workDir,
      workDirExists: Boolean(result.workDir),
    }

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === result.sessionId)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: result.sessionId,
    }))

    void get().fetchSessions()
    return { sessionId: result.sessionId, title: sanitizeSessionTitle(result.title) }
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id)
    useSessionRuntimeStore.getState().clearSelection(id)
    set((s) => ({
      sessions: s.sessions.filter((session) => session.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    }))
  },

  renameSession: async (id: string, title: string) => {
    await sessionsApi.rename(id, title)
    const displayTitle = sanitizeSessionTitle(title)
    useTabStore.getState().updateTabTitle(id, displayTitle)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title: displayTitle } : session,
      ),
    }))
  },

  updateSessionTitle: (id, title) => {
    const displayTitle = sanitizeSessionTitle(title)
    useTabStore.getState().updateTabTitle(id, displayTitle)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title: displayTitle } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setNewSessionWorkDir: (workDir) => set({ newSessionWorkDir: workDir && workDir.trim() ? workDir : null }),
  setSelectedProjects: (projects) => set((state) => {
    const removedProjectSet = new Set(state.removedProjects)
    return {
      selectedProjects: projects.filter((project) => !isProjectInSet(removedProjectSet, project)),
    }
  }),
  removeProjects: (projects) => set((state) => {
    const nextRemoved = expandProjectKeys([...state.removedProjects, ...projects])
    const removedProjectSet = new Set(nextRemoved)
    const shouldClearNewSessionWorkDir = Boolean(
      state.newSessionWorkDir && isProjectInSet(removedProjectSet, state.newSessionWorkDir),
    )
    saveRemovedProjects(nextRemoved)
    return {
      removedProjects: nextRemoved,
      selectedProjects: state.selectedProjects.filter((project) => !isProjectInSet(removedProjectSet, project)),
      newSessionWorkDir: shouldClearNewSessionWorkDir ? null : state.newSessionWorkDir,
    }
  }),
  restoreProject: (project) => set((state) => {
    const nextRemoved = state.removedProjects.filter((item) => !projectMatchesKey(project, item))
    saveRemovedProjects(nextRemoved)
    return { removedProjects: nextRemoved }
  }),
}))

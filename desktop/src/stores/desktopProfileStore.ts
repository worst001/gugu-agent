import { create } from 'zustand'
import { desktopProfileApi } from '../api/desktopProfile'
import { THEME_MODES, type ThemeMode } from '../types/settings'
import type {
  DesktopProfile,
  DesktopProfileBundle,
  DesktopProfileBundlePatch,
  DesktopProfilePatch,
  DesktopWorkspaceState,
  DesktopWorkspaceStatePatch,
} from '../types/desktopProfile'

const LEGACY_KEYS = {
  theme: 'cc-haha-theme',
  locale: 'cc-haha-locale',
  sidebarWidth: 'gugu-agent-sidebar-width-v1',
  workbenchWidth: 'gugu-agent-workbench-width-v1',
  capabilityPanelCollapsed: 'gugu-agent-capability-panel-collapsed-v1',
  dismissedUpdateVersion: 'cc-haha-dismissed-update-version',
  pinnedProjects: 'gugu-agent-pinned-projects-v1',
  removedProjects: 'gugu-agent-removed-projects-v1',
  tabs: 'cc-haha-open-tabs',
  drafts: 'cc-haha-composer-drafts-v1',
  agentRunModes: 'cc-haha-agent-run-mode-v1',
  ceWorkflowRoles: 'cc-haha-ce-workflow-role-v2',
  sessionRuntimes: 'cc-haha-session-runtime-v2',
} as const

const THEME_MODE_SET = new Set<string>(THEME_MODES)
const MAX_DRAFTS = 50
const MAX_DRAFT_TEXT_LENGTH = 100_000

type DesktopProfileStore = {
  bundle: DesktopProfileBundle | null
  loaded: boolean
  lastError: string | null
  loadAndMigrate: () => Promise<DesktopProfileBundle | null>
  patch: (patch: DesktopProfileBundlePatch) => Promise<DesktopProfileBundle | null>
  reset: () => Promise<void>
}

function readLegacyValue(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function parseLegacyJson(key: string): unknown {
  const raw = readLegacyValue(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function parseStringArray(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.length > 0 && item.length <= 2_000
  )))].slice(0, limit)
}

function readLegacyProfilePatch(): DesktopProfilePatch {
  const appearance: NonNullable<DesktopProfilePatch['preferences']>['appearance'] = {}
  const layout: NonNullable<DesktopProfilePatch['preferences']>['layout'] = {}
  const updates: NonNullable<DesktopProfilePatch['preferences']>['updates'] = {}

  const theme = readLegacyValue(LEGACY_KEYS.theme)
  if (theme && THEME_MODE_SET.has(theme)) appearance.theme = theme as ThemeMode

  const locale = readLegacyValue(LEGACY_KEYS.locale)
  if (locale === 'zh' || locale === 'en') appearance.locale = locale

  const sidebarWidth = Number(readLegacyValue(LEGACY_KEYS.sidebarWidth))
  if (Number.isFinite(sidebarWidth) && sidebarWidth >= 220 && sidebarWidth <= 420) {
    layout.sidebarWidth = Math.round(sidebarWidth)
  }

  const workbenchWidth = Number(readLegacyValue(LEGACY_KEYS.workbenchWidth))
  if (Number.isFinite(workbenchWidth) && workbenchWidth >= 240 && workbenchWidth <= 2_000) {
    layout.workbenchWidth = Math.round(workbenchWidth)
  }

  const collapsed = readLegacyValue(LEGACY_KEYS.capabilityPanelCollapsed)
  if (collapsed === 'true' || collapsed === 'false') {
    layout.capabilityPanelCollapsed = collapsed === 'true'
  }

  const dismissedVersion = readLegacyValue(LEGACY_KEYS.dismissedUpdateVersion)
  if (dismissedVersion) updates.dismissedVersion = dismissedVersion.slice(0, 100)

  return {
    preferences: { appearance, layout, updates },
    migration: { legacyLocalStorageV1: true },
  }
}

function readLegacyTabs(): DesktopWorkspaceState['tabs'] {
  const value = asRecord(parseLegacyJson(LEGACY_KEYS.tabs))
  const openTabs = Array.isArray(value.openTabs)
    ? value.openTabs.flatMap((item) => {
      const tab = asRecord(item)
      if (typeof tab.sessionId !== 'string' || typeof tab.title !== 'string') return []
      const rawType = tab.type ?? 'session'
      if (rawType !== 'session' && rawType !== 'settings' && rawType !== 'scheduled') return []
      const type: 'session' | 'settings' | 'scheduled' = rawType
      return [{
        sessionId: tab.sessionId.slice(0, 500),
        title: tab.title.slice(0, 500),
        type,
      }]
    }).slice(0, 100)
    : []
  const activeTabId = typeof value.activeTabId === 'string' &&
    openTabs.some((tab) => tab.sessionId === value.activeTabId)
    ? value.activeTabId.slice(0, 500)
    : (openTabs[0]?.sessionId ?? null)
  return { openTabs, activeTabId }
}

function readLegacyDrafts(): DesktopWorkspaceState['drafts'] {
  return Object.fromEntries(Object.entries(asRecord(parseLegacyJson(LEGACY_KEYS.drafts)))
    .flatMap(([key, value]) => {
      const draft = asRecord(value)
      if (!key || key.length > 500 || typeof draft.text !== 'string' || !draft.text.trim()) return []
      const updatedAt = typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt)
        ? Math.max(0, Math.round(draft.updatedAt))
        : 0
      return [[key, { text: draft.text.slice(0, MAX_DRAFT_TEXT_LENGTH), updatedAt }] as const]
    })
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DRAFTS))
}

function readStringRecord(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(asRecord(parseLegacyJson(key)))
    .filter((entry): entry is [string, string] => (
      entry[0].length > 0 && entry[0].length <= 500 &&
      typeof entry[1] === 'string' && entry[1].length > 0 && entry[1].length <= 500
    ))
    .slice(0, 500))
}

function readLegacyWorkspaceStatePatch(): DesktopWorkspaceStatePatch {
  const rawModes = readStringRecord(LEGACY_KEYS.agentRunModes)
  const agentRunModes = Object.fromEntries(Object.entries(rawModes)
    .filter(([, value]) => value === 'normal' || value === 'plan' || value === 'ce')) as DesktopWorkspaceState['tools']['agentRunModes']
  const sessionRuntimes = Object.fromEntries(Object.entries(asRecord(parseLegacyJson(LEGACY_KEYS.sessionRuntimes)))
    .flatMap(([key, value]) => {
      const runtime = asRecord(value)
      if (!key || key.length > 500 || typeof runtime.modelId !== 'string' || !runtime.modelId) return []
      if (runtime.providerId !== null && typeof runtime.providerId !== 'string') return []
      return [[key, {
        providerId: typeof runtime.providerId === 'string' ? runtime.providerId.slice(0, 500) : null,
        modelId: runtime.modelId.slice(0, 500),
      }] as const]
    })
    .slice(0, 500))

  return {
    projects: {
      pinned: parseStringArray(parseLegacyJson(LEGACY_KEYS.pinnedProjects)),
      removed: parseStringArray(parseLegacyJson(LEGACY_KEYS.removedProjects)),
    },
    tabs: readLegacyTabs(),
    drafts: readLegacyDrafts(),
    tools: {
      agentRunModes,
      ceWorkflowRoles: readStringRecord(LEGACY_KEYS.ceWorkflowRoles),
      sessionRuntimes,
    },
    migration: { legacyLocalStorageV1: true },
  }
}

function mergeProfile(profile: DesktopProfile, patch?: DesktopProfilePatch): DesktopProfile {
  if (!patch) return profile
  return {
    ...profile,
    preferences: {
      ...profile.preferences,
      appearance: { ...profile.preferences.appearance, ...patch.preferences?.appearance },
      layout: { ...profile.preferences.layout, ...patch.preferences?.layout },
      updates: { ...profile.preferences.updates, ...patch.preferences?.updates },
    },
    migration: { ...profile.migration, ...patch.migration },
  }
}

function mergeWorkspaceState(
  state: DesktopWorkspaceState,
  patch?: DesktopWorkspaceStatePatch,
): DesktopWorkspaceState {
  if (!patch) return state
  return {
    ...state,
    projects: { ...state.projects, ...patch.projects },
    tabs: { ...state.tabs, ...patch.tabs },
    drafts: patch.drafts ?? state.drafts,
    tools: { ...state.tools, ...patch.tools },
    migration: { ...state.migration, ...patch.migration },
  }
}

function mergeBundle(
  bundle: DesktopProfileBundle,
  patch: DesktopProfileBundlePatch,
): DesktopProfileBundle {
  return {
    profile: mergeProfile(bundle.profile, patch.profile),
    workspaceState: mergeWorkspaceState(bundle.workspaceState, patch.workspaceState),
  }
}

export const useDesktopProfileStore = create<DesktopProfileStore>((set, get) => ({
  bundle: null,
  loaded: false,
  lastError: null,

  loadAndMigrate: async () => {
    try {
      const bundle = await desktopProfileApi.get()
      const patch: DesktopProfileBundlePatch = {}
      if (!bundle.profile.migration.legacyLocalStorageV1) {
        patch.profile = readLegacyProfilePatch()
      }
      if (!bundle.workspaceState.migration.legacyLocalStorageV1) {
        patch.workspaceState = readLegacyWorkspaceStatePatch()
      }

      if (!patch.profile && !patch.workspaceState) {
        set({ bundle, loaded: true, lastError: null })
        return bundle
      }

      const localBundle = mergeBundle(bundle, patch)
      localBundle.profile.migration = bundle.profile.migration
      localBundle.workspaceState.migration = bundle.workspaceState.migration
      try {
        const migrated = await desktopProfileApi.patch(patch)
        set({ bundle: migrated, loaded: true, lastError: null })
        return migrated
      } catch (error) {
        set({
          bundle: localBundle,
          loaded: true,
          lastError: error instanceof Error ? error.message : String(error),
        })
        return localBundle
      }
    } catch (error) {
      set({
        loaded: true,
        lastError: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  },

  patch: async (patch) => {
    const current = get().bundle
    if (current) set({ bundle: mergeBundle(current, patch) })
    try {
      const bundle = await desktopProfileApi.patch(patch)
      set({ bundle, lastError: null })
      return bundle
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) })
      return get().bundle
    }
  },

  reset: async () => {
    await flushDesktopProfileWrites()
    await desktopProfileApi.reset()
    set({ bundle: null, loaded: false, lastError: null })
  },
}))

let writeQueue = Promise.resolve<DesktopProfileBundle | null>(null)
let pendingPatch: DesktopProfileBundlePatch | null = null
let pendingTimer: number | null = null

function mergeQueuedPatch(
  current: DesktopProfileBundlePatch | null,
  next: DesktopProfileBundlePatch,
): DesktopProfileBundlePatch {
  if (!current) return next
  return {
    profile: next.profile ? {
      ...current.profile,
      ...next.profile,
      preferences: {
        ...current.profile?.preferences,
        ...next.profile.preferences,
        appearance: {
          ...current.profile?.preferences?.appearance,
          ...next.profile.preferences?.appearance,
        },
        layout: {
          ...current.profile?.preferences?.layout,
          ...next.profile.preferences?.layout,
        },
        updates: {
          ...current.profile?.preferences?.updates,
          ...next.profile.preferences?.updates,
        },
      },
      migration: { ...current.profile?.migration, ...next.profile.migration },
    } : current.profile,
    workspaceState: next.workspaceState ? {
      ...current.workspaceState,
      ...next.workspaceState,
      projects: { ...current.workspaceState?.projects, ...next.workspaceState.projects },
      tabs: { ...current.workspaceState?.tabs, ...next.workspaceState.tabs },
      tools: { ...current.workspaceState?.tools, ...next.workspaceState.tools },
      migration: { ...current.workspaceState?.migration, ...next.workspaceState.migration },
    } : current.workspaceState,
  }
}

export function persistDesktopProfilePatch(
  patch: DesktopProfileBundlePatch,
): Promise<DesktopProfileBundle | null> {
  writeQueue = writeQueue
    .catch(() => null)
    .then(() => useDesktopProfileStore.getState().patch(patch))
  return writeQueue
}

export function scheduleDesktopProfilePatch(
  patch: DesktopProfileBundlePatch,
  delay = 300,
): void {
  pendingPatch = mergeQueuedPatch(pendingPatch, patch)
  if (pendingTimer !== null) window.clearTimeout(pendingTimer)
  pendingTimer = window.setTimeout(() => {
    const next = pendingPatch
    pendingPatch = null
    pendingTimer = null
    if (next) void persistDesktopProfilePatch(next)
  }, delay)
}

export async function flushDesktopProfileWrites(): Promise<void> {
  if (pendingTimer !== null) window.clearTimeout(pendingTimer)
  const next = pendingPatch
  pendingPatch = null
  pendingTimer = null
  if (next) await persistDesktopProfilePatch(next)
  await writeQueue
}

import type { DesktopProfileBundle } from '../types/desktopProfile'
import { useAgentRunModeStore } from './agentRunModeStore'
import { useCeWorkflowRoleStore } from './ceWorkflowRoleStore'
import {
  flushDesktopProfileWrites,
  scheduleDesktopProfilePatch,
  useDesktopProfileStore,
} from './desktopProfileStore'
import { useSessionRuntimeStore } from './sessionRuntimeStore'
import { useSessionStore } from './sessionStore'
import { useSettingsStore } from './settingsStore'
import { useTabStore } from './tabStore'
import { applyTheme, useUIStore } from './uiStore'
import { useWorkbenchStore } from './workbenchStore'

const STORAGE_KEYS = {
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

type Unsubscribe = () => void

let unsubscribers: Unsubscribe[] = []
let beforeUnloadHandler: (() => void) | null = null

export const DESKTOP_STATE_FLUSH_EVENT = 'gugu:flush-desktop-state'

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Legacy mirrors are best-effort during the migration release.
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  writeStorage(key, JSON.stringify(value))
}

export function hydrateDesktopProfile(bundle: DesktopProfileBundle): void {
  const { appearance, layout, updates } = bundle.profile.preferences
  const { workspaceState } = bundle

  applyTheme(appearance.theme)
  writeStorage(STORAGE_KEYS.theme, appearance.theme)
  writeStorage(STORAGE_KEYS.locale, appearance.locale)
  writeStorage(STORAGE_KEYS.sidebarWidth, String(layout.sidebarWidth))
  writeStorage(STORAGE_KEYS.workbenchWidth, String(layout.workbenchWidth))
  writeStorage(STORAGE_KEYS.capabilityPanelCollapsed, String(layout.capabilityPanelCollapsed))
  writeStorage(STORAGE_KEYS.dismissedUpdateVersion, updates.dismissedVersion)

  writeJsonStorage(STORAGE_KEYS.pinnedProjects, workspaceState.projects.pinned)
  writeJsonStorage(STORAGE_KEYS.removedProjects, workspaceState.projects.removed)
  writeJsonStorage(STORAGE_KEYS.tabs, workspaceState.tabs)
  writeJsonStorage(STORAGE_KEYS.drafts, workspaceState.drafts)
  writeJsonStorage(STORAGE_KEYS.agentRunModes, workspaceState.tools.agentRunModes)
  writeJsonStorage(STORAGE_KEYS.ceWorkflowRoles, workspaceState.tools.ceWorkflowRoles)
  writeJsonStorage(STORAGE_KEYS.sessionRuntimes, workspaceState.tools.sessionRuntimes)

  useUIStore.setState({
    theme: appearance.theme,
    sidebarWidth: layout.sidebarWidth,
    capabilityPanelCollapsed: layout.capabilityPanelCollapsed,
  })
  useSettingsStore.setState({ theme: appearance.theme, locale: appearance.locale })
  useWorkbenchStore.setState({ panelWidth: layout.workbenchWidth })
  useSessionStore.setState({
    pinnedProjects: workspaceState.projects.pinned,
    removedProjects: workspaceState.projects.removed,
  })
  useAgentRunModeStore.setState({ selections: workspaceState.tools.agentRunModes })
  useCeWorkflowRoleStore.setState({ selections: workspaceState.tools.ceWorkflowRoles })
  useSessionRuntimeStore.setState({ selections: workspaceState.tools.sessionRuntimes })
}

function persistTabs(): void {
  const { tabs, activeTabId } = useTabStore.getState()
  const openTabs = tabs
    .filter((tab) => tab.type !== 'terminal' && tab.type !== 'draft')
    .map((tab) => ({
      sessionId: tab.sessionId,
      title: tab.title,
      type: tab.type as 'session' | 'settings' | 'scheduled',
    }))
  scheduleDesktopProfilePatch({
    workspaceState: {
      tabs: {
        openTabs,
        activeTabId: activeTabId && openTabs.some((tab) => tab.sessionId === activeTabId)
          ? activeTabId
          : (openTabs[0]?.sessionId ?? null),
      },
    },
  })
}

function installSubscriptions(): void {
  if (unsubscribers.length > 0) return

  unsubscribers = [
    useUIStore.subscribe((state, previous) => {
      const appearanceChanged = state.theme !== previous.theme
      const layoutChanged = state.sidebarWidth !== previous.sidebarWidth ||
        state.capabilityPanelCollapsed !== previous.capabilityPanelCollapsed
      if (!appearanceChanged && !layoutChanged) return
      if (appearanceChanged) useSettingsStore.setState({ theme: state.theme })
      scheduleDesktopProfilePatch({
        profile: {
          preferences: {
            appearance: appearanceChanged ? { theme: state.theme } : undefined,
            layout: layoutChanged ? {
              sidebarWidth: state.sidebarWidth,
              capabilityPanelCollapsed: state.capabilityPanelCollapsed,
            } : undefined,
          },
        },
      })
    }),
    useSettingsStore.subscribe((state, previous) => {
      if (state.locale === previous.locale) return
      scheduleDesktopProfilePatch({
        profile: { preferences: { appearance: { locale: state.locale } } },
      })
    }),
    useWorkbenchStore.subscribe((state, previous) => {
      if (state.panelWidth === previous.panelWidth) return
      scheduleDesktopProfilePatch({
        profile: { preferences: { layout: { workbenchWidth: state.panelWidth } } },
      })
    }),
    useSessionStore.subscribe((state, previous) => {
      if (state.pinnedProjects === previous.pinnedProjects &&
        state.removedProjects === previous.removedProjects) return
      scheduleDesktopProfilePatch({
        workspaceState: {
          projects: {
            pinned: state.pinnedProjects,
            removed: state.removedProjects,
          },
        },
      })
    }),
    useTabStore.subscribe((state, previous) => {
      if (state.tabs === previous.tabs && state.activeTabId === previous.activeTabId) return
      persistTabs()
    }),
    useAgentRunModeStore.subscribe((state, previous) => {
      if (state.selections === previous.selections) return
      scheduleDesktopProfilePatch({
        workspaceState: { tools: { agentRunModes: state.selections } },
      })
    }),
    useCeWorkflowRoleStore.subscribe((state, previous) => {
      if (state.selections === previous.selections) return
      scheduleDesktopProfilePatch({
        workspaceState: { tools: { ceWorkflowRoles: state.selections } },
      })
    }),
    useSessionRuntimeStore.subscribe((state, previous) => {
      if (state.selections === previous.selections) return
      scheduleDesktopProfilePatch({
        workspaceState: { tools: { sessionRuntimes: state.selections } },
      })
    }),
  ]

  beforeUnloadHandler = () => {
    void flushDesktopStateWrites()
  }
  window.addEventListener('beforeunload', beforeUnloadHandler)
}

export async function flushDesktopStateWrites(): Promise<void> {
  window.dispatchEvent(new Event(DESKTOP_STATE_FLUSH_EVENT))
  await flushDesktopProfileWrites()
}

export async function initializeDesktopProfilePersistence(): Promise<DesktopProfileBundle | null> {
  const bundle = await useDesktopProfileStore.getState().loadAndMigrate()
  if (bundle) hydrateDesktopProfile(bundle)
  installSubscriptions()
  return bundle
}

export async function reloadDesktopProfile(): Promise<DesktopProfileBundle | null> {
  const bundle = await useDesktopProfileStore.getState().loadAndMigrate()
  if (bundle) {
    hydrateDesktopProfile(bundle)
    useTabStore.setState({ tabs: [], activeTabId: null })
    await useTabStore.getState().restoreTabs()
  }
  return bundle
}

export async function resetDesktopProfileData(): Promise<void> {
  await useDesktopProfileStore.getState().reset()
  for (const key of Object.values(STORAGE_KEYS)) {
    writeStorage(key, null)
  }
  window.location.reload()
}

export function resetDesktopProfilePersistenceForTests(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler)
  beforeUnloadHandler = null
}

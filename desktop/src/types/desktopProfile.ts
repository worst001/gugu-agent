import type { Locale } from '../i18n'
import type { AgentRunMode } from '../constants/agentRunModes'
import type { AgentTaskRole } from './agentTask'
import type { RuntimeSelection } from './runtime'
import type { ThemeMode } from './settings'

export type NewSessionWorkType =
  | 'smart'
  | 'chat'
  | 'software_delivery'
  | 'knowledge_delivery'
  | 'short_video_production'

export type DesktopProfile = {
  schemaVersion: 1
  preferences: {
    appearance: {
      theme: ThemeMode
      locale: Locale
    }
    layout: {
      sidebarWidth: number
      workbenchWidth: number
      capabilityPanelCollapsed: boolean
    }
    updates: {
      dismissedVersion: string | null
    }
    work: {
      newSessionDefault: NewSessionWorkType
    }
  }
  migration: {
    legacyLocalStorageV1: boolean
  }
  updatedAt: string
}

export type CustomAssistant = {
  id: string
  name: string
  description: string
  baseRole: AgentTaskRole
  instructions: string
  createdAt: string
  updatedAt: string
}

export type DesktopWorkspaceState = {
  schemaVersion: 1
  projects: {
    pinned: string[]
    removed: string[]
  }
  tabs: {
    openTabs: Array<{
      sessionId: string
      title: string
      type: 'session' | 'settings' | 'scheduled' | 'knowledge' | 'team'
    }>
    activeTabId: string | null
  }
  drafts: Record<string, {
    text: string
    updatedAt: number
  }>
  assistants: {
    custom: CustomAssistant[]
  }
  tools: {
    agentRunModes: Record<string, AgentRunMode>
    ceWorkflowRoles: Record<string, string>
    sessionRuntimes: Record<string, RuntimeSelection>
  }
  migration: {
    legacyLocalStorageV1: boolean
  }
  updatedAt: string
}

export type DesktopProfilePatch = {
  preferences?: {
    appearance?: Partial<DesktopProfile['preferences']['appearance']>
    layout?: Partial<DesktopProfile['preferences']['layout']>
    updates?: Partial<DesktopProfile['preferences']['updates']>
    work?: Partial<DesktopProfile['preferences']['work']>
  }
  migration?: Partial<DesktopProfile['migration']>
}

export type DesktopWorkspaceStatePatch = {
  projects?: Partial<DesktopWorkspaceState['projects']>
  tabs?: Partial<DesktopWorkspaceState['tabs']>
  drafts?: DesktopWorkspaceState['drafts']
  assistants?: Partial<DesktopWorkspaceState['assistants']>
  tools?: Partial<DesktopWorkspaceState['tools']>
  migration?: Partial<DesktopWorkspaceState['migration']>
}

export type DesktopProfileBundle = {
  profile: DesktopProfile
  workspaceState: DesktopWorkspaceState
}

export type DesktopProfileBundlePatch = {
  profile?: DesktopProfilePatch
  workspaceState?: DesktopWorkspaceStatePatch
}

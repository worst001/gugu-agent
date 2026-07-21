import { z } from 'zod/v4'
import { AGENT_TASK_ROLES } from '../../agentTask/types.js'

export const DESKTOP_PROFILE_SCHEMA_VERSION = 1 as const
export const MAX_DESKTOP_DRAFTS = 50
export const MAX_DESKTOP_DRAFT_TEXT_LENGTH = 100_000

export const desktopThemeSchema = z.enum([
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
])

export const desktopLocaleSchema = z.enum(['zh', 'en'])
export const desktopAgentRunModeSchema = z.enum(['normal', 'plan', 'ce'])
export const desktopAgentTaskRoleSchema = z.enum(AGENT_TASK_ROLES)
export const desktopNewSessionWorkTypeSchema = z.enum([
  'smart',
  'chat',
  'software_delivery',
  'knowledge_delivery',
  'short_video_production',
])
export const desktopTabTypeSchema = z.enum([
  'session',
  'settings',
  'scheduled',
  'knowledge',
  'team',
])

const desktopCustomAssistantSchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  description: z.string().max(280),
  baseRole: desktopAgentTaskRoleSchema,
  instructions: z.string().min(1).max(4_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const appearanceSchema = z.strictObject({
  theme: desktopThemeSchema,
  locale: desktopLocaleSchema,
})

const layoutSchema = z.strictObject({
  sidebarWidth: z.number().int().min(220).max(420),
  workbenchWidth: z.number().int().min(240).max(2_000),
  capabilityPanelCollapsed: z.boolean(),
})

const updatePreferencesSchema = z.strictObject({
  dismissedVersion: z.string().max(100).nullable(),
})

const workPreferencesSchema = z.strictObject({
  newSessionDefault: desktopNewSessionWorkTypeSchema,
})

const migrationSchema = z.strictObject({
  legacyLocalStorageV1: z.boolean(),
})

export const desktopProfileSchema = z.strictObject({
  schemaVersion: z.literal(DESKTOP_PROFILE_SCHEMA_VERSION),
  preferences: z.strictObject({
    appearance: appearanceSchema,
    layout: layoutSchema,
    updates: updatePreferencesSchema,
    work: workPreferencesSchema,
  }),
  migration: migrationSchema,
  updatedAt: z.string().datetime(),
})

const desktopTabSchema = z.strictObject({
  sessionId: z.string().min(1).max(500),
  title: z.string().max(500),
  type: desktopTabTypeSchema,
})

const composerDraftSchema = z.strictObject({
  text: z.string().max(MAX_DESKTOP_DRAFT_TEXT_LENGTH),
  updatedAt: z.number().int().nonnegative(),
})

const runtimeSelectionSchema = z.strictObject({
  providerId: z.string().max(500).nullable(),
  modelId: z.string().min(1).max(500),
})

const boundedStringRecord = (valueSchema: z.ZodType) =>
  z.record(z.string().min(1).max(500), valueSchema)
    .refine((value) => Object.keys(value).length <= 500, 'Too many entries')

export const desktopWorkspaceStateSchema = z.strictObject({
  schemaVersion: z.literal(DESKTOP_PROFILE_SCHEMA_VERSION),
  projects: z.strictObject({
    pinned: z.array(z.string().min(1).max(2_000)).max(500),
    removed: z.array(z.string().min(1).max(2_000)).max(500),
  }),
  tabs: z.strictObject({
    openTabs: z.array(desktopTabSchema).max(100),
    activeTabId: z.string().max(500).nullable(),
  }),
  drafts: boundedStringRecord(composerDraftSchema),
  assistants: z.strictObject({
    custom: z.array(desktopCustomAssistantSchema).max(50),
  }),
  tools: z.strictObject({
    agentRunModes: boundedStringRecord(desktopAgentRunModeSchema),
    ceWorkflowRoles: boundedStringRecord(z.string().min(1).max(500)),
    sessionRuntimes: boundedStringRecord(runtimeSelectionSchema),
  }),
  migration: migrationSchema,
  updatedAt: z.string().datetime(),
})

export const desktopProfilePatchSchema = z.strictObject({
  preferences: z.strictObject({
    appearance: appearanceSchema.partial().optional(),
    layout: layoutSchema.partial().optional(),
    updates: updatePreferencesSchema.partial().optional(),
    work: workPreferencesSchema.partial().optional(),
  }).partial().optional(),
  migration: migrationSchema.partial().optional(),
})

export const desktopWorkspaceStatePatchSchema = z.strictObject({
  projects: desktopWorkspaceStateSchema.shape.projects.partial().optional(),
  tabs: desktopWorkspaceStateSchema.shape.tabs.partial().optional(),
  drafts: desktopWorkspaceStateSchema.shape.drafts.optional(),
  assistants: desktopWorkspaceStateSchema.shape.assistants.partial().optional(),
  tools: desktopWorkspaceStateSchema.shape.tools.partial().optional(),
  migration: migrationSchema.partial().optional(),
})

export const desktopProfileBundlePatchSchema = z.strictObject({
  profile: desktopProfilePatchSchema.optional(),
  workspaceState: desktopWorkspaceStatePatchSchema.optional(),
})

export type DesktopProfile = z.infer<typeof desktopProfileSchema>
export type DesktopProfilePatch = z.infer<typeof desktopProfilePatchSchema>
export type DesktopWorkspaceState = z.infer<typeof desktopWorkspaceStateSchema>
export type DesktopWorkspaceStatePatch = z.infer<typeof desktopWorkspaceStatePatchSchema>

function now(): string {
  return new Date().toISOString()
}

export function createDefaultDesktopProfile(): DesktopProfile {
  return {
    schemaVersion: DESKTOP_PROFILE_SCHEMA_VERSION,
    preferences: {
      appearance: { theme: 'dark', locale: 'zh' },
      layout: {
        sidebarWidth: 280,
        workbenchWidth: 390,
        capabilityPanelCollapsed: false,
      },
      updates: { dismissedVersion: null },
      work: { newSessionDefault: 'smart' },
    },
    migration: { legacyLocalStorageV1: false },
    updatedAt: now(),
  }
}

export function createDefaultDesktopWorkspaceState(): DesktopWorkspaceState {
  return {
    schemaVersion: DESKTOP_PROFILE_SCHEMA_VERSION,
    projects: { pinned: [], removed: [] },
    tabs: { openTabs: [], activeTabId: null },
    drafts: {},
    assistants: { custom: [] },
    tools: {
      agentRunModes: {},
      ceWorkflowRoles: {},
      sessionRuntimes: {},
    },
    migration: { legacyLocalStorageV1: false },
    updatedAt: now(),
  }
}

function parseOr<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.length > 0 && item.length <= 2_000
  )))].slice(0, 500)
}

function normalizeRecord<T>(
  value: unknown,
  schema: z.ZodType<T>,
  limit = 500,
): Record<string, T> {
  const entries: Array<[string, T]> = []
  for (const [key, item] of Object.entries(asRecord(value))) {
    if (!key || key.length > 500 || entries.length >= limit) continue
    const parsed = schema.safeParse(item)
    if (parsed.success) entries.push([key, parsed.data])
  }
  return Object.fromEntries(entries)
}

export function normalizeDesktopProfile(value: unknown): DesktopProfile {
  const defaults = createDefaultDesktopProfile()
  const root = asRecord(value)
  const preferences = asRecord(root.preferences)
  const appearance = asRecord(preferences.appearance)
  const layout = asRecord(preferences.layout)
  const updates = asRecord(preferences.updates)
  const work = asRecord(preferences.work)
  const migration = asRecord(root.migration)

  return {
    schemaVersion: DESKTOP_PROFILE_SCHEMA_VERSION,
    preferences: {
      appearance: {
        theme: parseOr(desktopThemeSchema, appearance.theme, defaults.preferences.appearance.theme),
        locale: parseOr(desktopLocaleSchema, appearance.locale, defaults.preferences.appearance.locale),
      },
      layout: {
        sidebarWidth: parseOr(layoutSchema.shape.sidebarWidth, layout.sidebarWidth, defaults.preferences.layout.sidebarWidth),
        workbenchWidth: parseOr(layoutSchema.shape.workbenchWidth, layout.workbenchWidth, defaults.preferences.layout.workbenchWidth),
        capabilityPanelCollapsed: parseOr(z.boolean(), layout.capabilityPanelCollapsed, defaults.preferences.layout.capabilityPanelCollapsed),
      },
      updates: {
        dismissedVersion: parseOr(updatePreferencesSchema.shape.dismissedVersion, updates.dismissedVersion, null),
      },
      work: {
        newSessionDefault: parseOr(
          desktopNewSessionWorkTypeSchema,
          work.newSessionDefault,
          defaults.preferences.work.newSessionDefault,
        ),
      },
    },
    migration: {
      legacyLocalStorageV1: parseOr(z.boolean(), migration.legacyLocalStorageV1, false),
    },
    updatedAt: parseOr(z.string().datetime(), root.updatedAt, defaults.updatedAt),
  }
}

export function normalizeDesktopWorkspaceState(value: unknown): DesktopWorkspaceState {
  const defaults = createDefaultDesktopWorkspaceState()
  const root = asRecord(value)
  const projects = asRecord(root.projects)
  const tabs = asRecord(root.tabs)
  const tools = asRecord(root.tools)
  const assistants = asRecord(root.assistants)
  const migration = asRecord(root.migration)
  const drafts = Object.entries(normalizeRecord(root.drafts, composerDraftSchema))
    .filter(([, draft]) => draft.text.trim().length > 0)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_DESKTOP_DRAFTS)

  const openTabs = Array.isArray(tabs.openTabs)
    ? tabs.openTabs.flatMap((tab) => {
      const parsed = desktopTabSchema.safeParse(tab)
      return parsed.success ? [parsed.data] : []
    }).slice(0, 100)
    : []
  const activeTabId = parseOr(desktopWorkspaceStateSchema.shape.tabs.shape.activeTabId, tabs.activeTabId, null)

  return {
    schemaVersion: DESKTOP_PROFILE_SCHEMA_VERSION,
    projects: {
      pinned: normalizeStringList(projects.pinned),
      removed: normalizeStringList(projects.removed),
    },
    tabs: {
      openTabs,
      activeTabId: activeTabId && openTabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : (openTabs[0]?.sessionId ?? null),
    },
    drafts: Object.fromEntries(drafts),
    assistants: {
      custom: Array.isArray(assistants.custom)
        ? assistants.custom.flatMap((assistant) => {
          const parsed = desktopCustomAssistantSchema.safeParse(assistant)
          return parsed.success ? [parsed.data] : []
        }).filter((assistant, index, items) =>
          items.findIndex((item) => item.id === assistant.id) === index
        ).slice(0, 50)
        : defaults.assistants.custom,
    },
    tools: {
      agentRunModes: normalizeRecord(tools.agentRunModes, desktopAgentRunModeSchema),
      ceWorkflowRoles: normalizeRecord(tools.ceWorkflowRoles, z.string().min(1).max(500)),
      sessionRuntimes: normalizeRecord(tools.sessionRuntimes, runtimeSelectionSchema),
    },
    migration: {
      legacyLocalStorageV1: parseOr(z.boolean(), migration.legacyLocalStorageV1, false),
    },
    updatedAt: parseOr(z.string().datetime(), root.updatedAt, defaults.updatedAt),
  }
}

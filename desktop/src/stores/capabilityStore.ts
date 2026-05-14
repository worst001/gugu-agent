import { create } from 'zustand'
import { attachmentParserApi } from '../api/attachmentParser'
import { mcpApi } from '../api/mcp'
import { modelsApi } from '../api/models'
import { pluginsApi } from '../api/plugins'
import { skillsApi } from '../api/skills'
import type { EffortLevel, ModelInfo } from '../types/settings'

export type AttachmentParserCapabilityStatus = 'off' | 'needs_config' | 'ready' | 'error'

export type CapabilitySummary = {
  providerName: string | null
  providerId: string | null
  model: ModelInfo | null
  effort: EffortLevel | null
  attachmentParser: {
    status: AttachmentParserCapabilityStatus
    enabled: boolean
    hasApiKey: boolean
    label: string
  }
  mcp: {
    total: number
    connected: number
    attention: number
  }
  skills: {
    total: number
    invocable: number
  }
  plugins: {
    total: number
    enabled: number
    errors: number
  }
  cwd?: string
  updatedAt: number | null
  errors: Partial<Record<'models' | 'effort' | 'attachmentParser' | 'mcp' | 'skills' | 'plugins', string>>
}

type CapabilityStore = {
  summary: CapabilitySummary
  isLoading: boolean
  refreshCapabilities: (cwd?: string, options?: { force?: boolean }) => Promise<void>
}

const EMPTY_SUMMARY: CapabilitySummary = {
  providerName: null,
  providerId: null,
  model: null,
  effort: null,
  attachmentParser: {
    status: 'off',
    enabled: false,
    hasApiKey: false,
    label: 'Off',
  },
  mcp: {
    total: 0,
    connected: 0,
    attention: 0,
  },
  skills: {
    total: 0,
    invocable: 0,
  },
  plugins: {
    total: 0,
    enabled: 0,
    errors: 0,
  },
  updatedAt: null,
  errors: {},
}

const REFRESH_STALE_MS = 30_000

export const useCapabilityStore = create<CapabilityStore>((set, get) => ({
  summary: EMPTY_SUMMARY,
  isLoading: false,

  refreshCapabilities: async (cwd, options) => {
    const current = get().summary
    const now = Date.now()
    if (
      !options?.force &&
      current.updatedAt &&
      current.cwd === cwd &&
      now - current.updatedAt < REFRESH_STALE_MS
    ) {
      return
    }

    set({ isLoading: true })

    const [
      modelsResult,
      currentModelResult,
      effortResult,
      parserResult,
      mcpResult,
      skillsResult,
      pluginsResult,
    ] = await Promise.allSettled([
      modelsApi.list(),
      modelsApi.getCurrent(),
      modelsApi.getEffort(),
      attachmentParserApi.getConfig(),
      mcpApi.list(cwd),
      skillsApi.list(cwd),
      pluginsApi.list(cwd),
    ] as const)

    const errors: CapabilitySummary['errors'] = {}
    const next: CapabilitySummary = {
      ...EMPTY_SUMMARY,
      cwd,
      updatedAt: Date.now(),
      errors,
    }

    if (modelsResult.status === 'fulfilled') {
      next.providerName = modelsResult.value.provider?.name ?? null
      next.providerId = modelsResult.value.provider?.id ?? null
    } else {
      errors.models = getErrorMessage(modelsResult.reason)
    }

    if (currentModelResult.status === 'fulfilled') {
      next.model = currentModelResult.value.model
    } else {
      errors.models = errors.models ?? getErrorMessage(currentModelResult.reason)
    }

    if (effortResult.status === 'fulfilled') {
      next.effort = effortResult.value.level
    } else {
      errors.effort = getErrorMessage(effortResult.reason)
    }

    if (parserResult.status === 'fulfilled') {
      const config = parserResult.value.config
      const status: AttachmentParserCapabilityStatus = !config.enabled
        ? 'off'
        : config.hasApiKey
          ? 'ready'
          : 'needs_config'
      next.attachmentParser = {
        status,
        enabled: config.enabled,
        hasApiKey: config.hasApiKey,
        label: getAttachmentParserLabel(status),
      }
    } else {
      errors.attachmentParser = getErrorMessage(parserResult.reason)
      next.attachmentParser = {
        status: 'error',
        enabled: false,
        hasApiKey: false,
        label: 'Error',
      }
    }

    if (mcpResult.status === 'fulfilled') {
      const servers = mcpResult.value.servers
      next.mcp = {
        total: servers.length,
        connected: servers.filter((server) => server.status === 'connected').length,
        attention: servers.filter((server) =>
          server.enabled && server.status !== 'connected' && server.status !== 'checking'
        ).length,
      }
    } else {
      errors.mcp = getErrorMessage(mcpResult.reason)
    }

    if (skillsResult.status === 'fulfilled') {
      const skills = skillsResult.value.skills
      next.skills = {
        total: skills.length,
        invocable: skills.filter((skill) => skill.userInvocable).length,
      }
    } else {
      errors.skills = getErrorMessage(skillsResult.reason)
    }

    if (pluginsResult.status === 'fulfilled') {
      next.plugins = {
        total: pluginsResult.value.summary?.total ?? pluginsResult.value.plugins.length,
        enabled: pluginsResult.value.summary?.enabled ?? pluginsResult.value.plugins.filter((plugin) => plugin.enabled).length,
        errors: pluginsResult.value.summary?.errorCount ?? pluginsResult.value.plugins.filter((plugin) => plugin.hasErrors).length,
      }
    } else {
      errors.plugins = getErrorMessage(pluginsResult.reason)
    }

    set({ summary: next, isLoading: false })
  },
}))

function getAttachmentParserLabel(status: AttachmentParserCapabilityStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'needs_config':
      return 'Needs key'
    case 'error':
      return 'Error'
    case 'off':
    default:
      return 'Off'
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

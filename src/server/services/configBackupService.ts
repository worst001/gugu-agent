import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { AgentService, type AgentDefinition } from './agentService.js'
import { PluginService } from './pluginService.js'
import { ProviderService } from './providerService.js'
import { SettingsService } from './settingsService.js'
import {
  addMcpConfig,
  getClaudeCodeMcpConfigs,
  getMcpConfigByName,
  isMcpServerDisabled,
  removeMcpConfig,
  setMcpServerEnabled,
} from '../../services/mcp/config.js'
import type {
  ConfigScope,
  McpServerConfig,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import { getCwd, runWithCwdOverride } from '../../utils/cwd.js'
import type { ProvidersIndex, SavedProvider } from '../types/provider.js'

const CONFIG_FORMAT = 'gugu-config-export'
const CONFIG_VERSION = 1
const MASKED_SECRET = '__CC_HAHA_SECRET_OMITTED__'
const EDITABLE_MCP_SCOPES = new Set<ConfigScope>(['user', 'project', 'local'])
const SKILL_ROOT_NAMES = ['skills', '.agents/skills'] as const

export type ConfigBackupSection =
  | 'providers'
  | 'attachmentParser'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'agents'
  | 'guiPreferences'

export type ConfigBackupExportOptions = {
  includeSecrets?: boolean
  cwd?: string
}

export type ConfigBackupImportOptions = {
  overwrite?: boolean
  cwd?: string
}

export type ConfigBackupPackage = {
  format: typeof CONFIG_FORMAT
  version: typeof CONFIG_VERSION
  exportedAt: string
  app: {
    name: 'Gugu Agent'
    configDir: string
  }
  secretsIncluded: boolean
  sections: Partial<{
    providers: ExportedProviders
    attachmentParser: ExportedAttachmentParserConfig
    mcp: ExportedMcpSection
    skills: ExportedInventoryItem[]
    plugins: ExportedInventoryItem[]
    agents: AgentDefinition[]
    guiPreferences: Record<string, unknown>
  }>
}

type ExportedProviders = {
  activeId: string | null
  providers: ExportedProvider[]
}

type ExportedProvider = Omit<SavedProvider, 'apiKey'> & {
  apiKey: string
  apiKeyMasked?: string
  hasApiKey: boolean
}

type ExportedAttachmentParserConfig = Record<string, unknown> & {
  apiKey?: string
  apiKeyMasked?: string
  hasApiKey?: boolean
}

type ExportedMcpSection = {
  servers: ExportedMcpServer[]
}

type ExportedMcpServer = {
  name: string
  scope: ConfigScope
  enabled: boolean
  config: McpServerConfig
}

type ExportedInventoryItem = {
  id: string
  name: string
  source?: string
  scope?: string
  enabled?: boolean
  description?: string
  version?: string
}

export type ConfigBackupPreviewAction =
  | 'add'
  | 'overwrite'
  | 'skip'
  | 'preserve'

export type ConfigBackupPreviewItem = {
  section: ConfigBackupSection
  name: string
  action: ConfigBackupPreviewAction
  reason?: string
}

export type ConfigBackupPreview = {
  valid: boolean
  format: string
  version: number
  secretsIncluded: boolean
  items: ConfigBackupPreviewItem[]
  summary: Record<ConfigBackupPreviewAction, number>
}

export type ConfigBackupImportResult = {
  ok: true
  preview: ConfigBackupPreview
}

type JsonObject = Record<string, unknown>

export class ConfigBackupService {
  private readonly agentService = new AgentService()
  private readonly pluginService = new PluginService()
  private readonly providerService = new ProviderService()
  private readonly settingsService = new SettingsService()

  async exportConfig(options: ConfigBackupExportOptions = {}): Promise<ConfigBackupPackage> {
    const cwd = options.cwd || getCwd()
    return runWithCwdOverride(cwd, async () => {
      const includeSecrets = options.includeSecrets === true
      const [
        providers,
        attachmentParser,
        mcp,
        skills,
        plugins,
        agents,
        guiPreferences,
      ] = await Promise.all([
        this.exportProviders(includeSecrets),
        this.exportAttachmentParser(includeSecrets),
        this.exportMcp(includeSecrets),
        this.exportSkills(cwd),
        this.exportPlugins(cwd),
        this.agentService.listAgents(),
        this.exportGuiPreferences(),
      ])

      return {
        format: CONFIG_FORMAT,
        version: CONFIG_VERSION,
        exportedAt: new Date().toISOString(),
        app: {
          name: 'Gugu Agent',
          configDir: this.getConfigDir(),
        },
        secretsIncluded: includeSecrets,
        sections: {
          providers,
          attachmentParser,
          mcp,
          skills,
          plugins,
          agents,
          guiPreferences,
        },
      }
    })
  }

  async previewImport(pkg: unknown, options: ConfigBackupImportOptions = {}): Promise<ConfigBackupPreview> {
    const parsed = this.assertPackage(pkg)
    const cwd = options.cwd || getCwd()

    return runWithCwdOverride(cwd, async () => {
      const items: ConfigBackupPreviewItem[] = []
      const currentProviders = await this.readProvidersIndex()
      const currentProviderIds = new Set(currentProviders.providers.map((provider) => provider.id))

      for (const provider of parsed.sections.providers?.providers ?? []) {
        items.push({
          section: 'providers',
          name: provider.name || provider.id,
          action: currentProviderIds.has(provider.id)
            ? options.overwrite === false ? 'skip' : 'overwrite'
            : 'add',
          reason: provider.hasApiKey && !provider.apiKey
            ? 'API key is masked and will not be imported.'
            : undefined,
        })
      }

      if (parsed.sections.attachmentParser) {
        items.push({
          section: 'attachmentParser',
          name: 'GLM file parser',
          action: options.overwrite === false ? 'skip' : 'overwrite',
          reason: parsed.sections.attachmentParser.hasApiKey && !parsed.sections.attachmentParser.apiKey
            ? 'GLM API key is masked and the existing key will be preserved.'
            : undefined,
        })
      }

      const currentMcp = await getClaudeCodeMcpConfigs()
      for (const server of parsed.sections.mcp?.servers ?? []) {
        if (!EDITABLE_MCP_SCOPES.has(server.scope)) {
          items.push({
            section: 'mcp',
            name: server.name,
            action: 'skip',
            reason: `Scope "${server.scope}" is not editable.`,
          })
          continue
        }
        items.push({
          section: 'mcp',
          name: server.name,
          action: currentMcp.servers[server.name]
            ? options.overwrite === false ? 'skip' : 'overwrite'
            : 'add',
        })
      }

      for (const agent of parsed.sections.agents ?? []) {
        const existing = await this.agentService.getAgent(agent.name)
        items.push({
          section: 'agents',
          name: agent.name,
          action: existing ? options.overwrite === false ? 'skip' : 'overwrite' : 'add',
        })
      }

      if (parsed.sections.guiPreferences && Object.keys(parsed.sections.guiPreferences).length > 0) {
        items.push({
          section: 'guiPreferences',
          name: 'GUI preferences',
          action: options.overwrite === false ? 'skip' : 'overwrite',
        })
      }

      for (const skill of parsed.sections.skills ?? []) {
        items.push({
          section: 'skills',
          name: skill.name || skill.id,
          action: 'skip',
          reason: 'Skill inventory is exported for sharing, but v1 does not install skill files.',
        })
      }

      for (const plugin of parsed.sections.plugins ?? []) {
        items.push({
          section: 'plugins',
          name: plugin.name || plugin.id,
          action: 'skip',
          reason: 'Plugin inventory is exported for sharing, but v1 does not install plugins automatically.',
        })
      }

      return {
        valid: true,
        format: parsed.format,
        version: parsed.version,
        secretsIncluded: parsed.secretsIncluded,
        items,
        summary: summarizeItems(items),
      }
    })
  }

  async importConfig(
    pkg: unknown,
    options: ConfigBackupImportOptions = {},
  ): Promise<ConfigBackupImportResult> {
    const parsed = this.assertPackage(pkg)
    const preview = await this.previewImport(parsed, options)
    const overwrite = options.overwrite !== false
    const cwd = options.cwd || getCwd()

    await runWithCwdOverride(cwd, async () => {
      await this.importProviders(parsed.sections.providers, overwrite)
      await this.importAttachmentParser(parsed.sections.attachmentParser, overwrite)
      await this.importMcp(parsed.sections.mcp, overwrite)
      await this.importAgents(parsed.sections.agents ?? [], overwrite)
      await this.importGuiPreferences(parsed.sections.guiPreferences, overwrite)
    })

    return { ok: true, preview }
  }

  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getCcHahaDir(): string {
    return path.join(this.getConfigDir(), 'cc-haha')
  }

  private getProvidersPath(): string {
    return path.join(this.getCcHahaDir(), 'providers.json')
  }

  private getAttachmentParserPath(): string {
    return path.join(this.getCcHahaDir(), 'attachment-parser.json')
  }

  private async exportProviders(includeSecrets: boolean): Promise<ExportedProviders> {
    const index = await this.readProvidersIndex()
    return {
      activeId: index.activeId,
      providers: index.providers.map((provider) => ({
        ...provider,
        apiKey: includeSecrets ? provider.apiKey : '',
        apiKeyMasked: maskSecret(provider.apiKey),
        hasApiKey: provider.apiKey.trim().length > 0,
      })),
    }
  }

  private async exportAttachmentParser(includeSecrets: boolean): Promise<ExportedAttachmentParserConfig> {
    const config = await this.readJsonFile(this.getAttachmentParserPath())
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey : ''
    return {
      ...config,
      apiKey: includeSecrets ? apiKey : '',
      apiKeyMasked: maskSecret(apiKey),
      hasApiKey: apiKey.trim().length > 0,
    }
  }

  private async exportMcp(includeSecrets: boolean): Promise<ExportedMcpSection> {
    const { servers } = await getClaudeCodeMcpConfigs()
    const exportedServers = Object.entries(servers)
      .filter(([, config]) => EDITABLE_MCP_SCOPES.has(config.scope))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, config]) => ({
        name,
        scope: config.scope,
        enabled: !isMcpServerDisabled(name),
        config: this.exportMcpConfig(config, includeSecrets),
      }))

    return { servers: exportedServers }
  }

  private exportMcpConfig(
    config: ScopedMcpServerConfig,
    includeSecrets: boolean,
  ): McpServerConfig {
    const { scope: _scope, pluginSource: _pluginSource, ...rest } = config
    if (includeSecrets) return rest
    return stripSensitiveFields(rest) as McpServerConfig
  }

  private async exportSkills(cwd: string): Promise<ExportedInventoryItem[]> {
    const roots = [
      ...SKILL_ROOT_NAMES.map((name) => path.join(this.getConfigDir(), name)),
      ...SKILL_ROOT_NAMES.map((name) => path.join(cwd, name)),
    ]
    const items: ExportedInventoryItem[] = []
    const seen = new Set<string>()
    for (const root of roots) {
      const source = root.startsWith(this.getConfigDir()) ? 'user' : 'project'
      const names = await this.readDirectoryNames(root)
      for (const name of names) {
        const id = `${source}:${name}`
        if (seen.has(id)) continue
        seen.add(id)
        const description = await this.readSkillDescription(path.join(root, name, 'SKILL.md'))
        items.push({ id, name, source, description })
      }
    }
    return items.sort((a, b) => a.id.localeCompare(b.id))
  }

  private async exportPlugins(cwd: string): Promise<ExportedInventoryItem[]> {
    try {
      const result = await this.pluginService.listPlugins(cwd)
      return result.plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        scope: plugin.scope,
        enabled: plugin.enabled,
        description: plugin.description,
        version: plugin.version,
        source: plugin.marketplace,
      }))
    } catch {
      return []
    }
  }

  private async exportGuiPreferences(): Promise<Record<string, unknown>> {
    const settings = await this.settingsService.getUserSettings()
    const prefs: Record<string, unknown> = {}
    for (const key of [
      'theme',
      'skipWebFetchPreflight',
      'defaultMode',
      'model',
      'effort',
      'defaultSessionWorkDir',
    ]) {
      if (settings[key] !== undefined) prefs[key] = settings[key]
    }
    return prefs
  }

  private async importProviders(section: ExportedProviders | undefined, overwrite: boolean): Promise<void> {
    if (!section) return
    const current = await this.readProvidersIndex()
    const byId = new Map(current.providers.map((provider) => [provider.id, provider]))

    for (const incoming of section.providers ?? []) {
      const existing = byId.get(incoming.id)
      if (existing && !overwrite) continue
      const provider = normalizeProviderForImport(incoming, existing)
      byId.set(provider.id, provider)
    }

    const nextProviders = [...byId.values()]
    const importedActiveProvider = section.activeId
      ? byId.get(section.activeId)
      : undefined
    const activeId = importedActiveProvider && providerHasUsableAuth(importedActiveProvider)
      ? importedActiveProvider.id
      : current.activeId
    await this.writeProvidersIndex({
      activeId,
      providers: nextProviders,
    })
    if (activeId && nextProviders.some((provider) => provider.id === activeId && providerHasUsableAuth(provider))) {
      await this.providerService.activateProvider(activeId)
    }
  }

  private async importAttachmentParser(
    section: ExportedAttachmentParserConfig | undefined,
    overwrite: boolean,
  ): Promise<void> {
    if (!section || !overwrite) return
    const current = await this.readJsonFile(this.getAttachmentParserPath())
    const next = {
      ...current,
      ...dropExportOnlyFields(section),
    }
    if (!hasUsableSecret(section.apiKey)) {
      if (current.apiKey !== undefined) next.apiKey = current.apiKey
      else delete next.apiKey
    }
    await this.writeJsonFile(this.getAttachmentParserPath(), next)
  }

  private async importMcp(section: ExportedMcpSection | undefined, overwrite: boolean): Promise<void> {
    if (!section) return
    for (const server of section.servers ?? []) {
      if (!EDITABLE_MCP_SCOPES.has(server.scope)) continue
      const existing = getMcpConfigByName(server.name)
      if (existing && !overwrite) continue
      if (existing && EDITABLE_MCP_SCOPES.has(existing.scope)) {
        await removeMcpConfig(server.name, existing.scope)
      }
      await addMcpConfig(server.name, server.config, server.scope)
      setMcpServerEnabled(server.name, server.enabled)
    }
  }

  private async importAgents(agents: AgentDefinition[], overwrite: boolean): Promise<void> {
    for (const agent of agents) {
      if (!agent.name) continue
      const existing = await this.agentService.getAgent(agent.name)
      if (existing) {
        if (overwrite) await this.agentService.updateAgent(agent.name, agent)
      } else {
        await this.agentService.createAgent(agent)
      }
    }
  }

  private async importGuiPreferences(
    preferences: Record<string, unknown> | undefined,
    overwrite: boolean,
  ): Promise<void> {
    if (!preferences || !overwrite) return
    await this.settingsService.updateUserSettings(preferences)
  }

  private async readProvidersIndex(): Promise<ProvidersIndex> {
    const parsed = await this.readJsonFile(this.getProvidersPath())
    return {
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter(isSavedProvider)
        : [],
    }
  }

  private async writeProvidersIndex(index: ProvidersIndex): Promise<void> {
    await this.writeJsonFile(this.getProvidersPath(), index as unknown as JsonObject)
  }

  private async readJsonFile(filePath: string): Promise<JsonObject> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as JsonObject
        : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read config file: ${filePath}`)
    }
  }

  private async writeJsonFile(filePath: string, data: JsonObject): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmpFile = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (error) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write config file: ${filePath}`)
    }
  }

  private async readDirectoryNames(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private async readSkillDescription(skillPath: string): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(skillPath, 'utf-8')
      const description = raw.match(/^description:\s*(.+)$/m)?.[1]?.trim()
      return description?.replace(/^["']|["']$/g, '')
    } catch {
      return undefined
    }
  }

  private assertPackage(value: unknown): ConfigBackupPackage {
    if (!value || typeof value !== 'object') {
      throw ApiError.badRequest('Invalid GuGu config package')
    }
    const pkg = value as Partial<ConfigBackupPackage>
    if (pkg.format !== CONFIG_FORMAT || pkg.version !== CONFIG_VERSION) {
      throw ApiError.badRequest('Unsupported GuGu config package format')
    }
    if (!pkg.sections || typeof pkg.sections !== 'object') {
      throw ApiError.badRequest('GuGu config package is missing sections')
    }
    return pkg as ConfigBackupPackage
  }
}

function summarizeItems(items: ConfigBackupPreviewItem[]): Record<ConfigBackupPreviewAction, number> {
  return items.reduce<Record<ConfigBackupPreviewAction, number>>(
    (summary, item) => {
      summary[item.action] += 1
      return summary
    },
    { add: 0, overwrite: 0, skip: 0, preserve: 0 },
  )
}

function maskSecret(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '********'
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

function hasUsableSecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value !== MASKED_SECRET
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return (
    normalized.includes('api_key') ||
    normalized.includes('apikey') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized.endsWith('_auth')
  )
}

function stripSensitiveFields(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, parentKey))
  }
  if (!value || typeof value !== 'object') {
    return isSensitiveKey(parentKey) ? MASKED_SECRET : value
  }
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    next[key] = isSensitiveKey(key)
      ? MASKED_SECRET
      : stripSensitiveFields(child, key)
  }
  return next
}

function dropExportOnlyFields(value: JsonObject): JsonObject {
  const { apiKeyMasked: _apiKeyMasked, hasApiKey: _hasApiKey, ...rest } = value
  return rest
}

function normalizeProviderForImport(
  incoming: ExportedProvider,
  existing?: SavedProvider,
): SavedProvider {
  return {
    id: incoming.id,
    presetId: incoming.presetId,
    name: incoming.name,
    apiKey: hasUsableSecret(incoming.apiKey) ? incoming.apiKey : existing?.apiKey ?? '',
    baseUrl: incoming.baseUrl,
    apiFormat: incoming.apiFormat ?? 'anthropic',
    authKind: incoming.authKind ?? 'api_key',
    models: incoming.models,
    ...(incoming.notes !== undefined ? { notes: incoming.notes } : {}),
  }
}

function providerHasUsableAuth(provider: SavedProvider): boolean {
  return provider.authKind === 'chatgpt_oauth' || provider.apiKey.trim().length > 0
}

function isSavedProvider(value: unknown): value is SavedProvider {
  if (!value || typeof value !== 'object') return false
  const provider = value as Partial<SavedProvider>
  return (
    typeof provider.id === 'string' &&
    typeof provider.presetId === 'string' &&
    typeof provider.name === 'string' &&
    typeof provider.apiKey === 'string' &&
    typeof provider.baseUrl === 'string' &&
    provider.models !== undefined &&
    typeof provider.models.main === 'string' &&
    typeof provider.models.haiku === 'string' &&
    typeof provider.models.sonnet === 'string' &&
    typeof provider.models.opus === 'string'
  )
}

export const configBackupService = new ConfigBackupService()

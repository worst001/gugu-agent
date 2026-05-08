/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.claude/cc-haha/providers.json (lightweight index)
 * Active provider env vars written to ~/.claude/cc-haha/settings.json
 * (isolated from the original Claude Code's ~/.claude/settings.json)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { anthropicToChatGPTCodexRequest } from '../proxy/transform/chatgptCodexRequest.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import {
  CHATGPT_CODEX_API_ENDPOINT,
  chatgptAuthService,
} from './chatgptAuthService.js'
import type { AnthropicRequest, AnthropicResponse } from '../proxy/transform/types.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ProviderTestStepResult,
  ApiFormat,
  ProviderAuthKind,
} from '../types/provider.js'

const MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
] as const

const DEFAULT_INDEX: ProvidersIndex = { activeId: null, providers: [] }
const CHATGPT_PROVIDER_PRESET_ID = 'chatgpt'
const CHATGPT_PROVIDER_NAME = 'ChatGPT Connect'
const CHATGPT_PROVIDER_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const CHATGPT_PROVIDER_MODELS = {
  main: 'gpt-5.4',
  haiku: 'gpt-5.4-mini',
  sonnet: 'gpt-5.4',
  opus: 'gpt-5.4',
}

export function getProviderModelIds(provider: Pick<SavedProvider, 'models'>): string[] {
  return [
    provider.models.main,
    provider.models.haiku,
    provider.models.sonnet,
    provider.models.opus,
  ]
    .map((model) => model.trim())
    .filter((model, index, models) => model.length > 0 && models.indexOf(model) === index)
}

export function isProviderModelId(
  provider: Pick<SavedProvider, 'models'>,
  modelId: string | undefined,
): boolean {
  const normalized = modelId?.trim()
  return Boolean(normalized && getProviderModelIds(provider).includes(normalized))
}

export function resolveProviderModelId(
  provider: Pick<SavedProvider, 'models'>,
  preferredModel: string | undefined,
  fallbackModel?: string,
): string {
  const preferred = preferredModel?.trim()
  if (preferred && isProviderModelId(provider, preferred)) return preferred

  const fallback = fallbackModel?.trim()
  if (fallback && isProviderModelId(provider, fallback)) return fallback

  return provider.models.main.trim()
}

function getPresetDefaultEnv(presetId: string): Record<string, string> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {}
}

function getManagedEnvKeys(): string[] {
  const keys = new Set<string>(MANAGED_ENV_KEYS)
  for (const preset of PROVIDER_PRESETS) {
    for (const key of Object.keys(preset.defaultEnv ?? {})) {
      keys.add(key)
    }
  }
  return [...keys]
}

export class ProviderService {
  private static serverPort = 3456

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getCcHahaDir(): string {
    return path.join(this.getConfigDir(), 'cc-haha')
  }

  private getIndexPath(): string {
    return path.join(this.getCcHahaDir(), 'providers.json')
  }

  private getSettingsPath(): string {
    return path.join(this.getCcHahaDir(), 'settings.json')
  }

  private async readIndex(): Promise<ProvidersIndex> {
    try {
      const raw = await fs.readFile(this.getIndexPath(), 'utf-8')
      return JSON.parse(raw) as ProvidersIndex
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...DEFAULT_INDEX, providers: [] }
      }
      throw ApiError.internal(`Failed to read providers index: ${err}`)
    }
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.getSettingsPath(), 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read settings.json: ${err}`)
    }
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getSettingsPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
  }

  async getManagedSettings(): Promise<Record<string, unknown>> {
    return this.readSettings()
  }

  async updateManagedSettings(settings: Record<string, unknown>): Promise<void> {
    const current = await this.readSettings()
    await this.writeSettings(Object.assign({}, current, settings))
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      apiFormat: input.apiFormat ?? 'anthropic',
      authKind: input.authKind ?? 'api_key',
      models: input.models,
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.authKind !== undefined && { authKind: input.authKind }),
      ...(input.models !== undefined && { models: input.models }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    if (provider.presetId === 'official') {
      await this.clearProviderFromSettings()
    } else {
      await this.syncToSettings(provider)
    }
  }

  async activateOfficial(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearProviderFromSettings()
  }

  async ensureChatGPTProvider(options?: { activate?: boolean }): Promise<SavedProvider> {
    const index = await this.readIndex()
    let provider = index.providers.find(
      (p) =>
        p.presetId === CHATGPT_PROVIDER_PRESET_ID ||
        p.authKind === 'chatgpt_oauth',
    )
    const wasCreated = !provider

    if (!provider) {
      provider = {
        id: crypto.randomUUID(),
        presetId: CHATGPT_PROVIDER_PRESET_ID,
        name: CHATGPT_PROVIDER_NAME,
        apiKey: '',
        baseUrl: CHATGPT_PROVIDER_BASE_URL,
        apiFormat: 'chatgpt_codex',
        authKind: 'chatgpt_oauth',
        models: { ...CHATGPT_PROVIDER_MODELS },
        notes:
          'Uses ChatGPT web OAuth and the Codex Responses backend. No API key is stored.',
      }
      index.providers.push(provider)
    } else {
      provider = {
        ...provider,
        apiFormat: 'chatgpt_codex',
        authKind: 'chatgpt_oauth',
        baseUrl: provider.baseUrl || CHATGPT_PROVIDER_BASE_URL,
        apiKey: provider.apiKey ?? '',
        models: {
          ...CHATGPT_PROVIDER_MODELS,
          ...provider.models,
        },
      }
      const idx = index.providers.findIndex((p) => p.id === provider!.id)
      index.providers[idx] = provider
    }

    const shouldActivate =
      options?.activate === true ||
      index.activeId === provider.id ||
      (wasCreated && index.activeId === null)

    if (shouldActivate) {
      index.activeId = provider.id
    }
    await this.writeIndex(index)
    if (shouldActivate) {
      await this.syncToSettings(provider)
    }
    return provider
  }

  // --- Settings sync ---

  private buildManagedEnv(
    provider: SavedProvider,
    options?: { proxyPath?: string },
  ): Record<string, string> {
    const needsProxy = provider.apiFormat != null && provider.apiFormat !== 'anthropic'
    const proxyPath = options?.proxyPath ?? '/proxy'
    const baseUrl = needsProxy
      ? `http://127.0.0.1:${ProviderService.serverPort}${proxyPath}`
      : provider.baseUrl

    return {
      ...getPresetDefaultEnv(provider.presetId),
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_API_KEY: needsProxy ? 'proxy-managed' : provider.apiKey,
      ANTHROPIC_MODEL: provider.models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus,
    }
  }

  async getProviderRuntimeEnv(id: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(id)
    return this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
    })
  }

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    const settings = await this.readSettings()
    const existingEnv = (settings.env as Record<string, string>) || {}
    const cleanedEnv = { ...existingEnv }

    for (const key of getManagedEnvKeys()) {
      delete cleanedEnv[key]
    }

    settings.env = {
      ...cleanedEnv,
      ...this.buildManagedEnv(provider),
    }

    await this.writeSettings(settings)
  }

  private async clearProviderFromSettings(): Promise<void> {
    const settings = await this.readSettings()
    const env = (settings.env as Record<string, string>) || {}

    for (const key of getManagedEnvKeys()) {
      delete env[key]
    }

    settings.env = env
    if (Object.keys(env).length === 0) {
      delete settings.env
    }

    await this.writeSettings(settings)
  }

  // --- Auth status ---

  /**
   * Check whether any usable auth exists:
   *  1. A cc-haha provider is active → has auth
   *  2. Original ~/.claude/settings.json has ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY → has auth
   *  3. process.env already has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN → has auth
   *  4. None of the above → needs setup
   */
  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: 'cc-haha-provider' | 'original-settings' | 'env' | 'none'
    activeProvider?: string
  }> {
    // 1. Check cc-haha active provider
    const index = await this.readIndex()
    if (index.activeId) {
      const provider = index.providers.find(p => p.id === index.activeId)
      if (provider?.authKind === 'chatgpt_oauth') {
        const tokens = await chatgptAuthService.ensureFreshTokens()
        if (tokens) {
          return { hasAuth: true, source: 'cc-haha-provider', activeProvider: provider.name }
        }
      }
      if (provider?.apiKey) {
        return { hasAuth: true, source: 'cc-haha-provider', activeProvider: provider.name }
      }
    }

    // 2. Check process.env (covers .env file + inherited env)
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { hasAuth: true, source: 'env' }
    }

    // 3. Check original ~/.claude/settings.json
    try {
      const originalPath = path.join(this.getConfigDir(), 'settings.json')
      const raw = await fs.readFile(originalPath, 'utf-8')
      const settings = JSON.parse(raw) as { env?: Record<string, string> }
      const env = settings.env ?? {}
      if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return { hasAuth: true, source: 'original-settings' }
      }
    } catch {
      // File doesn't exist or invalid
    }

    return { hasAuth: false, source: 'none' }
  }

  // --- Proxy support ---

  async getProviderForProxy(providerId?: string): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    authKind: ProviderAuthKind
  } | null> {
    if (providerId) {
      const provider = await this.getProvider(providerId)
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        apiFormat: provider.apiFormat ?? 'anthropic',
        authKind: provider.authKind ?? 'api_key',
      }
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = index.providers.find((p) => p.id === index.activeId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: provider.apiFormat ?? 'anthropic',
      authKind: provider.authKind ?? 'api_key',
    }
  }

  async getActiveProviderForProxy(): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    authKind: ProviderAuthKind
  } | null> {
    return this.getProviderForProxy()
  }

  // --- Test ---

  async testProvider(
    id: string,
    overrides?: { baseUrl?: string; modelId?: string; apiFormat?: ApiFormat },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const modelId = overrides?.modelId || provider.models.main
    const apiFormat = overrides?.apiFormat ?? provider.apiFormat ?? 'anthropic'

    if (!baseUrl || (apiFormat !== 'chatgpt_codex' && !provider.apiKey)) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }
    return this.testProviderConfig({
      baseUrl,
      apiKey: provider.apiKey,
      modelId,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const base = input.baseUrl.replace(/\/+$/, '')

    // ── Step 1: Basic connectivity ───────────────────────────
    // Directly call the upstream API to verify URL, key, and model.
    const step1 = await this.testConnectivity(base, input.apiKey, input.modelId, format)

    // If connectivity failed, no point running step 2
    if (!step1.success) {
      return { connectivity: step1 }
    }

    // For native Anthropic format, no proxy pipeline to test
    if (format === 'anthropic' || format === 'chatgpt_codex') {
      return { connectivity: step1 }
    }

    // ── Step 2: Full proxy pipeline ──────────────────────────
    // Anthropic request → transform → upstream → transform back → validate
    const step2 = await this.testProxyPipeline(base, input.apiKey, input.modelId, format)

    return { connectivity: step1, proxy: step2 }
  }

  /** Step 1: Direct upstream call to verify connectivity, auth, and model. */
  private async testConnectivity(
    base: string,
    apiKey: string,
    modelId: string,
    format: ApiFormat,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      if (format === 'chatgpt_codex') {
        const tokens = await chatgptAuthService.ensureFreshTokens()
        if (!tokens) {
          return {
            success: false,
            latencyMs: Date.now() - start,
            error: 'ChatGPT is not connected. Use Connect ChatGPT first.',
            modelUsed: modelId,
          }
        }
        const anthropicReq: AnthropicRequest = {
          model: modelId,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        }
        const transformedBody = anthropicToChatGPTCodexRequest(anthropicReq)
        transformedBody.stream = true
        const response = await fetch(CHATGPT_CODEX_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.accessToken}`,
            ...(tokens.accountId ? { 'ChatGPT-Account-Id': tokens.accountId } : {}),
            originator: 'cc-haha',
            'User-Agent': 'cc-haha',
          },
          body: JSON.stringify(transformedBody),
          signal: AbortSignal.timeout(30000),
        })
        const latencyMs = Date.now() - start
        if (!response.ok) {
          const errText = await response.text().catch(() => '')
          return {
            success: false,
            latencyMs,
            error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}`,
            modelUsed: modelId,
            httpStatus: response.status,
          }
        }
        const streamText = await response.text().catch(() => '')
        if (!streamText.includes('response.completed') && !streamText.includes('response.output_text')) {
          return {
            success: false,
            latencyMs,
            error: 'Unexpected Codex stream response',
            modelUsed: modelId,
            httpStatus: response.status,
          }
        }
        return { success: true, latencyMs, modelUsed: modelId, httpStatus: response.status }
      }
      const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      const latencyMs = Date.now() - start
      const resBody = await response.json().catch(() => null) as Record<string, unknown> | null

      if (!response.ok) {
        let error = `HTTP ${response.status}`
        if (resBody?.error && typeof resBody.error === 'object') {
          error = ((resBody.error as Record<string, unknown>).message as string) || error
        }
        return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
      }

      // Validate response structure
      const valid = validateResponseBody(resBody, format)
      if (!valid.ok) {
        return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
      }

      return { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Request timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }

  /** Step 2: Full proxy pipeline — Anthropic → transform → upstream → transform back → validate. */
  private async testProxyPipeline(
    base: string,
    apiKey: string,
    modelId: string,
    format: 'openai_chat' | 'openai_responses',
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      // Build an Anthropic Messages API request (same shape as what CLI sends)
      const anthropicReq: AnthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      }

      // Transform to OpenAI format
      let upstreamUrl: string
      let transformedBody: unknown
      if (format === 'openai_chat') {
        transformedBody = anthropicToOpenaiChat(anthropicReq)
        upstreamUrl = `${base}/v1/chat/completions`
      } else {
        transformedBody = anthropicToOpenaiResponses(anthropicReq)
        upstreamUrl = `${base}/v1/responses`
      }

      // Call upstream with transformed request
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(transformedBody),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        const latencyMs = Date.now() - start
        const errText = await response.text().catch(() => '')
        return { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}` }
      }

      // Transform response back to Anthropic format
      const responseBody = await response.json()
      const anthropicRes = format === 'openai_chat'
        ? openaiChatToAnthropic(responseBody, modelId)
        : openaiResponsesToAnthropic(responseBody, modelId)

      const latencyMs = Date.now() - start

      // Validate the final Anthropic response
      if (anthropicRes.type !== 'message' || !Array.isArray(anthropicRes.content)) {
        return { success: false, latencyMs, modelUsed: modelId,
          error: 'Proxy transform produced invalid Anthropic response' }
      }

      return { success: true, latencyMs, modelUsed: anthropicRes.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Proxy pipeline timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ApiFormat,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'

  if (format === 'openai_chat') {
    return {
      url: `${base}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
    }
  }
  if (format === 'openai_responses') {
    return {
      url: `${base}/v1/responses`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  // anthropic
  return {
    url: `${base}/v1/messages`,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
  }
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: ((body.error as Record<string, unknown>).message as string) || 'Error in response body' }
  }

  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  // anthropic
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return { ok: true, model: (body.model as string) || undefined }
}

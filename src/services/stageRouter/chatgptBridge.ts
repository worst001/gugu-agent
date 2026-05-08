import { ProviderService } from '../../server/services/providerService.js'
import type { SavedProvider } from '../../server/types/provider.js'
import type {
  AnthropicContentBlock,
  AnthropicResponse,
} from '../../server/proxy/transform/types.js'

export type ChatGPTBridgeRunOptions = {
  prompt: string
  system?: string
  maxTokens?: number
  timeoutMs?: number
}

export type ChatGPTBridgeRunResult =
  | { ok: true; output: string; model: string }
  | { ok: false; error: string }

type ChatGPTProviderRuntime = {
  ensureChatGPTProvider(options?: { activate?: boolean }): Promise<SavedProvider>
  getProviderRuntimeEnv(id: string): Promise<Record<string, string>>
}

type ChatGPTBridgeDeps = {
  providerService?: ChatGPTProviderRuntime
  ensureServer?: () => Promise<void>
  fetchFn?: typeof fetch
}

const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const PROXY_HOST = '127.0.0.1'
const PROXY_PORT = Number.parseInt(process.env.SERVER_PORT || '3456', 10)

export async function runChatGPTBridge(
  options: ChatGPTBridgeRunOptions,
  deps: ChatGPTBridgeDeps = {},
): Promise<ChatGPTBridgeRunResult> {
  const providerService = deps.providerService ?? new ProviderService()
  const provider = await providerService.ensureChatGPTProvider({ activate: false })
  const env = await providerService.getProviderRuntimeEnv(provider.id)
  const baseUrl = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '')
  const model = env.ANTHROPIC_MODEL || provider.models.main

  if (!baseUrl) {
    return { ok: false, error: 'ChatGPT provider runtime is missing ANTHROPIC_BASE_URL.' }
  }

  await (deps.ensureServer ?? ensureLocalProxyServer)()

  const response = await (deps.fetchFn ?? fetch)(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY || 'proxy-managed',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
      ...(options.system ? { system: options.system } : {}),
      messages: [{ role: 'user', content: options.prompt }],
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })

  if (!response.ok) {
    return {
      ok: false,
      error: await formatChatGPTError(response),
    }
  }

  const body = (await response.json()) as AnthropicResponse
  const output = extractText(body.content).trim()
  if (!output) {
    return { ok: false, error: 'ChatGPT returned an empty response.' }
  }

  return { ok: true, output, model: body.model || model }
}

async function ensureLocalProxyServer(): Promise<void> {
  if (await isLocalProxyHealthy()) return

  try {
    const { startServer } = await import('../../server/index.js')
    startServer(PROXY_PORT, PROXY_HOST)
  } catch {
    if (await isLocalProxyHealthy()) return
    throw new Error(
      `Could not start local proxy server at http://${PROXY_HOST}:${PROXY_PORT}.`,
    )
  }
}

async function isLocalProxyHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return response.ok
  } catch {
    return false
  }
}

async function formatChatGPTError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  let message = raw
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string }
      message?: string
    }
    message = parsed.error?.message || parsed.message || raw
  } catch {
    // Keep the raw body below.
  }

  const hint =
    response.status === 401
      ? ' ChatGPT is not connected or the token expired. Run /connect, then try again.'
      : ''

  return `ChatGPT planner request failed with HTTP ${response.status}: ${message.slice(0, 500)}${hint}`
}

function extractText(content: AnthropicContentBlock[]): string {
  return content
    .map(block => {
      if (block.type === 'text') return block.text
      if (block.type === 'thinking') return block.thinking
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

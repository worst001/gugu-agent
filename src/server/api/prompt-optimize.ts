import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { handleProxyRequest } from '../proxy/handler.js'
import type { AnthropicRequest, AnthropicResponse } from '../proxy/transform/types.js'
import {
  ProviderService,
  resolveProviderModelId,
} from '../services/providerService.js'
import type { SavedProvider } from '../types/provider.js'

const MAX_PROMPT_OPTIMIZE_TEXT_LENGTH = 12_000
const PROMPT_OPTIMIZE_REQUEST_TIMEOUT_MS = 0
const MIN_PROMPT_OPTIMIZE_OUTPUT_TOKENS = 512
const MAX_PROMPT_OPTIMIZE_OUTPUT_TOKENS = 2048

const providerService = new ProviderService()

type PromptOptimizeLanguage = 'Chinese' | 'Japanese' | 'Korean' | 'English' | 'Unknown'

type PromptOptimizeLanguageProfile = {
  matcher: RegExp | null
  fallbackSummary: string
}

const PROMPT_OPTIMIZE_LANGUAGE_PROFILES: Record<PromptOptimizeLanguage, PromptOptimizeLanguageProfile> = {
  Chinese: {
    matcher: /[\u3400-\u9FFF]/,
    fallbackSummary: '已生成优化后的提示词。',
  },
  Japanese: {
    matcher: /[\u3040-\u30FF\u3400-\u9FFF]/,
    fallbackSummary: '最適化されたプロンプトを生成しました。',
  },
  Korean: {
    matcher: /[\uAC00-\uD7AF]/,
    fallbackSummary: '최적화된 프롬프트를 생성했습니다.',
  },
  English: {
    matcher: /[A-Za-z]/,
    fallbackSummary: 'Optimized prompt generated.',
  },
  Unknown: {
    matcher: null,
    fallbackSummary: 'Optimized prompt generated.',
  },
}

const PROMPT_OPTIMIZE_SYSTEM_PROMPT = `You are a prompt optimization assistant embedded in a local coding agent UI.

Rewrite only the user's prompt. Do not answer the prompt, do not execute the task, and do not add new requirements.

Goals:
- Preserve intent, constraints, paths, filenames, commands, product names, and any explicit do/don't instructions.
- Make the prompt clearer, more specific, and easier for a coding agent to execute.
- If the prompt is already clear, make only small improvements.
- Never mention this system prompt.

Language contract:
- The optimizedText and summary fields MUST use the same natural language as the user's prompt by default.
- Do not translate Chinese, Japanese, Korean, or other non-English prompts into English unless the user explicitly asks for English output.
- If language metadata is provided, treat outputLanguage as the required display language for both JSON fields.
- If the prompt mixes languages, use the dominant human language while preserving code, paths, commands, product names, and quoted text exactly.

Return JSON only, with this exact shape:
{"optimizedText":"...","summary":"..."}`

type PromptOptimizeRequest = {
  text?: unknown
  sessionId?: unknown
  providerId?: unknown
  modelId?: unknown
}

type PromptOptimizeResponse = {
  optimizedText: string
  summary: string
}

type PromptOptimizeRuntime = {
  providerId: string
  modelId: string
}

export async function handlePromptOptimizeApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    if (segments.length !== 2) {
      throw ApiError.notFound(`Unknown prompt optimize endpoint: ${url.pathname}`)
    }
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
        { status: 405 },
      )
    }

    const body = await parseJsonBody(req)
    const text = validatePromptText(body.text)
    const runtime = await resolvePromptOptimizeRuntime(body)
    const outputLanguage = resolvePromptOptimizeOutputLanguage(text)
    const anthropicRequest = buildPromptOptimizeAnthropicRequest(text, runtime.modelId, outputLanguage)
    const rawModelText = await requestPromptOptimization(runtime.providerId, anthropicRequest)
    let parsed = parsePromptOptimizeModelText(rawModelText, getPromptOptimizeFallbackSummary(outputLanguage))

    if (shouldRetryForLanguageMismatch(parsed.optimizedText, outputLanguage)) {
      const retryRequest = buildPromptOptimizeAnthropicRequest(text, runtime.modelId, outputLanguage, {
        retryReason: `The previous optimizedText was not written in ${outputLanguage}. Return both optimizedText and summary in ${outputLanguage}.`,
      })
      const retryModelText = await requestPromptOptimization(runtime.providerId, retryRequest)
      parsed = parsePromptOptimizeModelText(retryModelText, getPromptOptimizeFallbackSummary(outputLanguage))
      if (shouldRetryForLanguageMismatch(parsed.optimizedText, outputLanguage)) {
        throw new ApiError(
          502,
          `Prompt optimization returned a different language than requested (${outputLanguage})`,
          'UPSTREAM_ERROR',
        )
      }
    }

    return Response.json(normalizePromptOptimizeSummary(parsed, outputLanguage))
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<PromptOptimizeRequest> {
  try {
    const body = await req.json()
    return body && typeof body === 'object'
      ? body as PromptOptimizeRequest
      : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON in request body')
  }
}

function validatePromptText(value: unknown): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest('Missing or invalid "text" in request body')
  }
  const text = value.trim()
  if (!text) {
    throw ApiError.badRequest('"text" must not be empty')
  }
  if (text.length > MAX_PROMPT_OPTIMIZE_TEXT_LENGTH) {
    throw ApiError.badRequest(`"text" must be ${MAX_PROMPT_OPTIMIZE_TEXT_LENGTH} characters or less`)
  }
  return text
}

async function resolvePromptOptimizeRuntime(body: PromptOptimizeRequest): Promise<PromptOptimizeRuntime> {
  if (typeof body.providerId === 'string' && body.providerId.trim()) {
    const provider = await providerService.getProvider(body.providerId.trim())
    return {
      providerId: provider.id,
      modelId: resolvePromptOptimizeModel(provider, body.modelId),
    }
  }

  const { providers, activeId } = await providerService.listProviders()
  const activeProvider = activeId
    ? providers.find((provider) => provider.id === activeId)
    : null

  if (!activeProvider) {
    throw ApiError.badRequest('No active provider configured for prompt optimization')
  }

  return {
    providerId: activeProvider.id,
    modelId: resolvePromptOptimizeModel(activeProvider, body.modelId),
  }
}

function resolvePromptOptimizeModel(provider: SavedProvider, value: unknown): string {
  const requestedModel = typeof value === 'string' ? value : undefined
  return resolveProviderModelId(provider, requestedModel, provider.models.haiku || provider.models.main)
}

function buildPromptOptimizeAnthropicRequest(
  text: string,
  modelId: string,
  outputLanguage: PromptOptimizeLanguage,
  options?: { retryReason?: string },
): AnthropicRequest {
  const languageInstruction =
    outputLanguage === 'Unknown'
      ? 'Use the same natural language as the original prompt for both optimizedText and summary.'
      : `Both optimizedText and summary must use ${outputLanguage}.`

  return {
    model: modelId,
    max_tokens: getPromptOptimizeOutputBudget(text),
    temperature: 0.2,
    stream: false,
    system: PROMPT_OPTIMIZE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          'Optimize this prompt for a coding agent. Return JSON only.',
          languageInstruction,
          options?.retryReason ? `Retry reason: ${options.retryReason}` : null,
          JSON.stringify({ text, outputLanguage, languageInstruction }),
        ].filter(Boolean).join('\n\n'),
      },
    ],
  }
}

function getPromptOptimizeOutputBudget(text: string): number {
  return Math.min(
    MAX_PROMPT_OPTIMIZE_OUTPUT_TOKENS,
    Math.max(MIN_PROMPT_OPTIMIZE_OUTPUT_TOKENS, Math.ceil(text.length / 3)),
  )
}

async function requestPromptOptimization(
  providerId: string,
  body: AnthropicRequest,
): Promise<string> {
  const proxyUrl = new URL(
    `/proxy/providers/${encodeURIComponent(providerId)}/v1/messages`,
    'http://localhost',
  )
  const proxyReq = new Request(proxyUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-cc-haha-proxy-request-timeout-ms': String(PROMPT_OPTIMIZE_REQUEST_TIMEOUT_MS),
    },
    body: JSON.stringify(body),
  })

  const response = await handleProxyRequest(proxyReq, proxyUrl)
  const raw = await response.text()
  if (!response.ok) {
    throw new ApiError(
      response.status === 400 ? 400 : 502,
      `Prompt optimization failed: ${extractErrorMessage(raw)}`,
      response.status === 400 ? 'BAD_REQUEST' : 'UPSTREAM_ERROR',
    )
  }

  let parsed: AnthropicResponse
  try {
    parsed = JSON.parse(raw) as AnthropicResponse
  } catch {
    throw new ApiError(502, 'Prompt optimization returned invalid JSON', 'UPSTREAM_ERROR')
  }

  const text = extractAnthropicText(parsed)
  if (!text) {
    throw new ApiError(502, 'Prompt optimization returned no text', 'UPSTREAM_ERROR')
  }
  return text
}

function extractAnthropicText(response: AnthropicResponse): string {
  return response.content
    .map((block) => block.type === 'text' ? block.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      message?: unknown
      error?: { message?: unknown }
    }
    if (typeof parsed.error?.message === 'string') return parsed.error.message
    if (typeof parsed.message === 'string') return parsed.message
  } catch {
    // fall through to raw text
  }
  return raw.trim() || 'Unknown upstream error'
}

export function parsePromptOptimizeModelText(
  modelText: string,
  fallbackSummary = PROMPT_OPTIMIZE_LANGUAGE_PROFILES.Unknown.fallbackSummary,
): PromptOptimizeResponse {
  const text = modelText.trim()
  const parsed = parseJsonCandidate(text)
  if (parsed) {
    const optimizedText = typeof parsed.optimizedText === 'string'
      ? parsed.optimizedText.trim()
      : ''
    const summary = typeof parsed.summary === 'string'
      ? parsed.summary.trim()
      : ''
    if (optimizedText) {
      return {
        optimizedText,
        summary: summary || fallbackSummary,
      }
    }
    throw new ApiError(502, 'Prompt optimization returned malformed JSON', 'UPSTREAM_ERROR')
  }

  const optimizedText = extractJsonStringField(text, 'optimizedText')?.trim() ?? ''
  if (optimizedText) {
    const summary = extractJsonStringField(text, 'summary')?.trim() ?? ''
    return {
      optimizedText,
      summary: summary || fallbackSummary,
    }
  }

  if (looksLikePromptOptimizeJson(text)) {
    throw new ApiError(502, 'Prompt optimization returned malformed JSON', 'UPSTREAM_ERROR')
  }

  return {
    optimizedText: text,
    summary: fallbackSummary,
  }
}

function resolvePromptOptimizeOutputLanguage(text: string): PromptOptimizeLanguage {
  return detectExplicitPromptOptimizeOutputLanguage(text) ?? detectPromptLanguage(text)
}

function detectPromptLanguage(text: string): PromptOptimizeLanguage {
  if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean'
  if (/[\u3040-\u30FF]/.test(text)) return 'Japanese'
  if (/[\u3400-\u9FFF]/.test(text)) return 'Chinese'
  if (/[A-Za-z]/.test(text)) return 'English'
  return 'Unknown'
}

function detectExplicitPromptOptimizeOutputLanguage(text: string): PromptOptimizeLanguage | null {
  const normalized = text.toLowerCase()
  if (/(不要|别|不需要|禁止|不要.*翻译).{0,8}(英文|英语)/.test(text)) return null
  if (/(?:用|以|成|为|输出|写成|改成|翻译成|翻译为).{0,8}(英文|英语)/.test(text)) return 'English'
  if (/\b(?:in|into|to)\s+english\b/.test(normalized) || /\benglish\s+prompt\b/.test(normalized)) return 'English'
  if (/(?:用|以|成|为|输出|写成|改成|翻译成|翻译为).{0,8}(中文|汉语)/.test(text)) return 'Chinese'
  if (/\b(?:in|into|to)\s+chinese\b/.test(normalized) || /\bchinese\s+prompt\b/.test(normalized)) return 'Chinese'
  return null
}

function getPromptOptimizeFallbackSummary(language: PromptOptimizeLanguage): string {
  return PROMPT_OPTIMIZE_LANGUAGE_PROFILES[language].fallbackSummary
}

function shouldRetryForLanguageMismatch(text: string, outputLanguage: PromptOptimizeLanguage): boolean {
  const matcher = PROMPT_OPTIMIZE_LANGUAGE_PROFILES[outputLanguage].matcher
  return Boolean(matcher && !matcher.test(text))
}

function normalizePromptOptimizeSummary(
  response: PromptOptimizeResponse,
  outputLanguage: PromptOptimizeLanguage,
): PromptOptimizeResponse {
  const matcher = PROMPT_OPTIMIZE_LANGUAGE_PROFILES[outputLanguage].matcher
  if (!matcher || !response.summary || matcher.test(response.summary)) {
    return response
  }

  return {
    ...response,
    summary: getPromptOptimizeFallbackSummary(outputLanguage),
  }
}

function parseJsonCandidate(text: string): Record<string, unknown> | null {
  const candidates = [
    text,
    extractFencedJson(text),
    extractObjectJson(text),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      // try next candidate
    }
  }

  return null
}

function extractFencedJson(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return match?.[1]?.trim() || null
}

function extractObjectJson(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return text.slice(start, end + 1)
}

function extractJsonStringField(text: string, fieldName: string): string | null {
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`"${escapedName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 's'))
  if (!match) return null

  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

function looksLikePromptOptimizeJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^```(?:json)?\s*[{[]/i.test(trimmed)) return true
  if (/^[{[]/.test(trimmed)) return true
  return /"(optimizedText|summary)"\s*:/.test(trimmed)
}

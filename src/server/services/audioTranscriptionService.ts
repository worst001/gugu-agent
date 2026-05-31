import { ApiError } from '../middleware/errorHandler.js'
import { ProviderService } from './providerService.js'

const DEFAULT_DASHSCOPE_ASR_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_DASHSCOPE_ASR_MODEL = 'qwen3-asr-flash'
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_CONTEXT_CHARS = 10_000
const REQUEST_TIMEOUT_MS = 120_000

type ManagedSettings = {
  env?: Record<string, unknown>
}

type DashScopeChoice = {
  message?: {
    content?: unknown
    annotations?: Array<{
      type?: unknown
      language?: unknown
      emotion?: unknown
    }>
  }
}

type DashScopeResponse = {
  model?: unknown
  choices?: DashScopeChoice[]
  usage?: unknown
}

export type AudioTranscriptionInput = {
  audio: string
  language?: string
  enableItn?: boolean
  context?: string
}

export type AudioTranscriptionResult = {
  text: string
  model: string
  language?: string
  emotion?: string
  usage?: unknown
}

export type AudioTranscriptionStatus = {
  available: boolean
  model: string
  provider: 'dashscope'
  reason?: 'missing_api_key'
}

type DashScopeAsrConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

export class AudioTranscriptionService {
  constructor(private readonly providerService = new ProviderService()) {}

  async getStatus(): Promise<AudioTranscriptionStatus> {
    try {
      const config = await this.resolveConfig()
      return {
        available: true,
        model: config.model,
        provider: 'dashscope',
      }
    } catch (error) {
      if (isMissingAsrApiKeyError(error)) {
        return {
          available: false,
          model: DEFAULT_DASHSCOPE_ASR_MODEL,
          provider: 'dashscope',
          reason: 'missing_api_key',
        }
      }
      throw error
    }
  }

  async transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    const audio = validateAudioDataUrl(input.audio)
    const language = validateLanguage(input.language)
    const context = validateContext(input.context)
    const config = await this.resolveConfig()
    const response = await this.requestDashScope(config, {
      audio,
      language,
      enableItn: input.enableItn ?? true,
      context,
    })

    const choice = response.choices?.[0]
    const text = typeof choice?.message?.content === 'string'
      ? choice.message.content.trim()
      : ''
    if (!text) {
      throw new ApiError(502, 'DashScope ASR returned an empty transcription', 'UPSTREAM_ERROR')
    }

    const audioInfo = choice?.message?.annotations?.find((item) => item.type === 'audio_info')
    return {
      text,
      model: typeof response.model === 'string' ? response.model : config.model,
      ...(typeof audioInfo?.language === 'string' && { language: audioInfo.language }),
      ...(typeof audioInfo?.emotion === 'string' && { emotion: audioInfo.emotion }),
      ...(response.usage !== undefined && { usage: response.usage }),
    }
  }

  private async resolveConfig(): Promise<DashScopeAsrConfig> {
    const settings = await this.providerService.getManagedSettings() as ManagedSettings
    const env = settings.env && typeof settings.env === 'object' ? settings.env : {}
    const apiKey = firstNonEmptyString(
      process.env.DASHSCOPE_API_KEY,
      process.env.BAILIAN_API_KEY,
      env.DASHSCOPE_API_KEY,
      env.BAILIAN_API_KEY,
    )

    if (!apiKey) {
      throw ApiError.badRequest('Missing DashScope API key. Set DASHSCOPE_API_KEY or BAILIAN_API_KEY in local settings.')
    }

    return {
      apiKey,
      baseUrl: normalizeBaseUrl(firstNonEmptyString(
        process.env.DASHSCOPE_ASR_BASE_URL,
        env.DASHSCOPE_ASR_BASE_URL,
        DEFAULT_DASHSCOPE_ASR_BASE_URL,
      )!),
      model: firstNonEmptyString(
        process.env.DASHSCOPE_ASR_MODEL,
        env.DASHSCOPE_ASR_MODEL,
        DEFAULT_DASHSCOPE_ASR_MODEL,
      )!,
    }
  }

  private async requestDashScope(
    config: DashScopeAsrConfig,
    input: {
      audio: string
      language?: string
      enableItn: boolean
      context?: string
    },
  ): Promise<DashScopeResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const messages: Array<Record<string, unknown>> = []
      if (input.context) {
        messages.push({
          role: 'system',
          content: [{ text: input.context }],
        })
      }
      messages.push({
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: input.audio,
            },
          },
        ],
      })

      const asrOptions: Record<string, unknown> = {
        enable_itn: input.enableItn,
      }
      if (input.language) asrOptions.language = input.language

      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          asr_options: asrOptions,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new ApiError(
          502,
          `DashScope ASR request failed (${response.status}): ${await readErrorMessage(response)}`,
          'UPSTREAM_ERROR',
        )
      }

      return await response.json() as DashScopeResponse
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(504, 'DashScope ASR request timed out', 'UPSTREAM_TIMEOUT')
      }
      throw new ApiError(502, `DashScope ASR request failed: ${getErrorMessage(error)}`, 'UPSTREAM_ERROR')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function validateAudioDataUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw ApiError.badRequest('Missing or invalid "audio" in request body')
  }
  const match = value.match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) {
    throw ApiError.badRequest('"audio" must be a Base64 data URL')
  }
  const mimeType = match[1].toLowerCase()
  if (!mimeType.startsWith('audio/')) {
    throw ApiError.badRequest('"audio" must use an audio MIME type')
  }
  const base64 = match[2].replace(/\s/g, '')
  if (!base64) {
    throw ApiError.badRequest('"audio" data must not be empty')
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor((base64.length * 3) / 4) - padding
  if (decodedBytes > MAX_AUDIO_BYTES) {
    throw ApiError.badRequest(`"audio" must be ${MAX_AUDIO_BYTES} bytes or less before Base64 encoding`)
  }
  return `data:${mimeType};base64,${base64}`
}

function validateLanguage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(value)) {
    throw ApiError.badRequest('"language" must be a valid language code')
  }
  return value.toLowerCase()
}

function validateContext(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw ApiError.badRequest('"context" must be a string')
  }
  return value.slice(0, MAX_CONTEXT_CHARS)
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

async function readErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  if (!body.trim()) return response.statusText || 'unknown error'
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    if (typeof parsed.message === 'string') return parsed.message
    const error = parsed.error
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  } catch {
    // Use the raw body below.
  }
  return body.slice(0, 500)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingAsrApiKeyError(error: unknown): boolean {
  return error instanceof ApiError &&
    error.statusCode === 400 &&
    error.code === 'BAD_REQUEST' &&
    error.message.includes('DashScope API key')
}

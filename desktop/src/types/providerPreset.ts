import type { ApiFormat } from './provider'

export type ProviderPresetCategory =
  | 'official'
  | 'domestic'
  | 'domestic-coding'
  | 'aggregator'
  | 'local'
  | 'custom'

export type ProviderPresetProtocol =
  | 'anthropic_native'
  | 'anthropic_compatible'
  | 'openai_chat_proxy'
  | 'openai_responses_proxy'
  | 'chatgpt_codex'
  | 'gugu_managed'

export type ProviderPresetModelRole = 'main' | 'haiku' | 'sonnet' | 'opus'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  apiFormat: ApiFormat
  defaultModels: ModelMapping
  needsApiKey: boolean
  websiteUrl: string
  category?: ProviderPresetCategory
  protocol?: ProviderPresetProtocol
  agentCompatible?: boolean
  routingHint?: {
    fast?: ProviderPresetModelRole
    balanced?: ProviderPresetModelRole
    pro?: ProviderPresetModelRole
    note?: string
  }
  apiKeyUrl?: string
  promoText?: string
  featured?: boolean
  defaultEnv?: Record<string, string>
}

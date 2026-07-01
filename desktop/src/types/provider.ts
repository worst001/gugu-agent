// desktop/src/types/provider.ts

export type ApiFormat = 'anthropic' | 'openai_chat' | 'openai_responses' | 'chatgpt_codex' | 'gugu_managed'
export type ProviderAuthKind = 'api_key' | 'chatgpt_oauth' | 'gugu_managed'

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ProviderExtraParams = {
  temperature?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
}

export type SavedProvider = {
  id: string
  presetId: string
  name: string
  apiKey: string  // masked from server
  baseUrl: string
  apiFormat: ApiFormat
  authKind?: ProviderAuthKind
  models: ModelMapping
  notes?: string
  extraParams?: ProviderExtraParams
}

export type CreateProviderInput = {
  presetId: string
  name: string
  apiKey: string
  baseUrl: string
  apiFormat?: ApiFormat
  authKind?: ProviderAuthKind
  models: ModelMapping
  notes?: string
  extraParams?: ProviderExtraParams
}

export type UpdateProviderInput = {
  name?: string
  apiKey?: string
  baseUrl?: string
  apiFormat?: ApiFormat
  authKind?: ProviderAuthKind
  models?: ModelMapping
  notes?: string
  extraParams?: ProviderExtraParams
}

export type TestProviderConfigInput = {
  baseUrl: string
  apiKey: string
  modelId: string
  apiFormat?: ApiFormat
}

export type ProviderTestStepResult = {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}

export type ProviderTestResult = {
  /** Step 1: Basic connectivity */
  connectivity: ProviderTestStepResult
  /** Step 2: Proxy pipeline (only for openai_* formats) */
  proxy?: ProviderTestStepResult
}

import type { ApiFormat } from '../types/provider.js'

export type ThinkingRequestParam = 'deepseek'
export type CacheTelemetryStyle = 'openai' | 'deepseek'
export type ProviderFamily = 'deepseek' | null

export type OpenAIChatProviderCapabilities = {
  reasoningContentReplay: boolean
  requiresReasoningContentForToolCalls: boolean
  thinkingRequestParam: ThinkingRequestParam | null
  cacheTelemetryStyle: CacheTelemetryStyle | null
}

export type ProviderCapabilities = {
  providerFamily: ProviderFamily
  supportsImages: boolean
  openAIChat: OpenAIChatProviderCapabilities
}

export type ProviderCapabilityContext = {
  apiFormat: ApiFormat
  baseUrl: string
  model: string
}

export const GENERIC_OPENAI_CHAT_CAPABILITIES: OpenAIChatProviderCapabilities = {
  // Preserve current OpenAI Chat transform behavior for Anthropic thinking blocks.
  reasoningContentReplay: true,
  requiresReasoningContentForToolCalls: false,
  thinkingRequestParam: null,
  cacheTelemetryStyle: 'openai',
}

const DEEPSEEK_OPENAI_CHAT_CAPABILITIES: OpenAIChatProviderCapabilities = {
  reasoningContentReplay: true,
  requiresReasoningContentForToolCalls: true,
  thinkingRequestParam: 'deepseek',
  cacheTelemetryStyle: 'deepseek',
}

export function resolveProviderCapabilities(context: ProviderCapabilityContext): ProviderCapabilities {
  const isDeepSeekLike = isDeepSeekLikeProvider(context)
  return {
    providerFamily: isDeepSeekLike ? 'deepseek' : null,
    supportsImages: !isDeepSeekLike,
    openAIChat: context.apiFormat === 'openai_chat' && isDeepSeekLike
      ? DEEPSEEK_OPENAI_CHAT_CAPABILITIES
      : GENERIC_OPENAI_CHAT_CAPABILITIES,
  }
}

function isDeepSeekLikeProvider({ baseUrl, model }: Pick<ProviderCapabilityContext, 'baseUrl' | 'model'>): boolean {
  const haystack = `${baseUrl} ${model}`.toLowerCase()
  return haystack.includes('deepseek')
}

import type { ApiFormat } from '../types/provider.js'

export type ThinkingRequestParam = 'deepseek' | 'glm' | 'kimi'
export type CacheTelemetryStyle = 'openai' | 'deepseek'
export type ProviderFamily = 'deepseek' | 'glm' | 'kimi' | null

export type OpenAIChatProviderCapabilities = {
  reasoningContentReplay: boolean
  requiresReasoningContentForToolCalls: boolean
  thinkingRequestParam: ThinkingRequestParam | null
  cacheTelemetryStyle: CacheTelemetryStyle | null
  toolStream: boolean
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
  toolStream: false,
}

const DEEPSEEK_OPENAI_CHAT_CAPABILITIES: OpenAIChatProviderCapabilities = {
  reasoningContentReplay: true,
  requiresReasoningContentForToolCalls: true,
  thinkingRequestParam: 'deepseek',
  cacheTelemetryStyle: 'deepseek',
  toolStream: false,
}

const GLM_OPENAI_CHAT_CAPABILITIES: OpenAIChatProviderCapabilities = {
  reasoningContentReplay: true,
  requiresReasoningContentForToolCalls: false,
  thinkingRequestParam: null,
  cacheTelemetryStyle: 'openai',
  toolStream: false,
}

const KIMI_OPENAI_CHAT_CAPABILITIES: OpenAIChatProviderCapabilities = {
  reasoningContentReplay: true,
  requiresReasoningContentForToolCalls: false,
  thinkingRequestParam: null,
  cacheTelemetryStyle: 'openai',
  toolStream: false,
}

export function resolveProviderCapabilities(context: ProviderCapabilityContext): ProviderCapabilities {
  const providerFamily = detectProviderFamily(context)
  const openAIChat = context.apiFormat === 'openai_chat'
    ? getOpenAIChatCapabilities(providerFamily, context.model)
    : GENERIC_OPENAI_CHAT_CAPABILITIES

  return {
    providerFamily,
    supportsImages: supportsImages(providerFamily, context.model),
    openAIChat,
  }
}

function detectProviderFamily({
  baseUrl,
  model,
}: Pick<ProviderCapabilityContext, 'baseUrl' | 'model'>): ProviderFamily {
  const haystack = `${baseUrl} ${model}`.toLowerCase()
  if (haystack.includes('deepseek')) return 'deepseek'
  if (
    haystack.includes('bigmodel.cn') ||
    haystack.includes('zhipu') ||
    /(?:^|\s)glm[-_]/.test(haystack)
  ) {
    return 'glm'
  }
  if (haystack.includes('moonshot') || /(?:^|\s)kimi[-_]/.test(haystack)) {
    return 'kimi'
  }
  return null
}

function getOpenAIChatCapabilities(
  providerFamily: ProviderFamily,
  model: string,
): OpenAIChatProviderCapabilities {
  switch (providerFamily) {
    case 'deepseek':
      return DEEPSEEK_OPENAI_CHAT_CAPABILITIES
    case 'glm':
      return {
        ...GLM_OPENAI_CHAT_CAPABILITIES,
        thinkingRequestParam: supportsGlmThinking(model) ? 'glm' : null,
        toolStream: supportsGlmToolStream(model),
      }
    case 'kimi':
      return {
        ...KIMI_OPENAI_CHAT_CAPABILITIES,
        thinkingRequestParam: /kimi[-_]k2/i.test(model) ? 'kimi' : null,
      }
    default:
      return GENERIC_OPENAI_CHAT_CAPABILITIES
  }
}

function supportsGlmThinking(model: string): boolean {
  return /glm[-_](?:4[._-](?:5|6|7)|5)/i.test(model)
}

function supportsGlmToolStream(model: string): boolean {
  return /glm[-_](?:4[._-](?:6|7)|5)/i.test(model)
}

function supportsImages(providerFamily: ProviderFamily, model: string): boolean {
  if (providerFamily === 'deepseek') return false
  if (providerFamily === 'glm') return /glm[-_].*v/i.test(model)
  return true
}

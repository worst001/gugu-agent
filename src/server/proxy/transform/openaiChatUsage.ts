import type { AnthropicResponse, OpenAIChatResponse } from './types.js'

type OpenAIChatUsage = NonNullable<OpenAIChatResponse['usage']>

type AnthropicStreamingUsage = {
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function mapOpenAIChatUsageToAnthropic(
  usage?: OpenAIChatResponse['usage'],
): AnthropicResponse['usage'] {
  if (!usage) {
    return { input_tokens: 0, output_tokens: 0 }
  }

  return {
    input_tokens: readTokenCount(usage.prompt_tokens),
    output_tokens: readTokenCount(usage.completion_tokens),
    ...mapOpenAIChatCacheUsage(usage, { includeDefaultCacheRead: true }),
  }
}

export function mapOpenAIChatUsageToAnthropicStream(
  usage: OpenAIChatUsage,
): AnthropicStreamingUsage {
  return {
    output_tokens: readTokenCount(usage.completion_tokens),
    ...mapOpenAIChatCacheUsage(usage, { includeDefaultCacheRead: false }),
  }
}

function mapOpenAIChatCacheUsage(
  usage: OpenAIChatUsage,
  options: { includeDefaultCacheRead: boolean },
): Pick<AnthropicResponse['usage'], 'cache_read_input_tokens' | 'cache_creation_input_tokens'> {
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens
  const cacheHitTokens = cachedTokens ?? usage.prompt_cache_hit_tokens
  const cacheMissTokens = usage.prompt_cache_miss_tokens
  const result: Pick<AnthropicResponse['usage'], 'cache_read_input_tokens' | 'cache_creation_input_tokens'> = {}

  if (
    options.includeDefaultCacheRead ||
    cachedTokens !== undefined ||
    usage.prompt_cache_hit_tokens !== undefined
  ) {
    result.cache_read_input_tokens = readTokenCount(cacheHitTokens)
  }

  if (cacheMissTokens !== undefined) {
    result.cache_creation_input_tokens = readTokenCount(cacheMissTokens)
  }

  return result
}

function readTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

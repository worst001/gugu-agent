export type OpenAIEndpointKind = 'chat/completions' | 'responses'

const VERSIONED_OPENAI_BASE_RE = /\/v\d+(?:\/)?$/i

export function buildOpenAIEndpoint(baseUrl: string, endpoint: OpenAIEndpointKind): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (VERSIONED_OPENAI_BASE_RE.test(base)) {
    return `${base}/${endpoint}`
  }
  return `${base}/v1/${endpoint}`
}

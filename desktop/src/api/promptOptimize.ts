import { api } from './client'

export type PromptOptimizeRequest = {
  text: string
  sessionId?: string
  providerId?: string | null
  modelId?: string
}

export type PromptOptimizeResponse = {
  optimizedText: string
  summary: string
}

export const promptOptimizeApi = {
  optimize(input: PromptOptimizeRequest, options?: { signal?: AbortSignal }) {
    return api.post<PromptOptimizeResponse>('/api/prompt-optimize', input, {
      timeout: 0,
      signal: options?.signal,
    })
  },
}

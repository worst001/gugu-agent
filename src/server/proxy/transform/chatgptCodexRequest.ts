import { anthropicToOpenaiResponses } from './anthropicToOpenaiResponses.js'
import type {
  AnthropicRequest,
  OpenAIResponsesRequest,
} from './types.js'

const DEFAULT_CODEX_INSTRUCTIONS =
  'You are a helpful coding assistant. Follow the user instructions carefully.'

export function anthropicToChatGPTCodexRequest(
  body: AnthropicRequest,
): OpenAIResponsesRequest {
  const request = anthropicToOpenaiResponses(body)
  if (!request.instructions?.trim()) {
    request.instructions = DEFAULT_CODEX_INSTRUCTIONS
  }
  request.store = false
  return request
}

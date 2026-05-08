import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { WebSearchTool } from './WebSearchTool.js'

describe('WebSearchTool availability', () => {
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalBedrock: string | undefined
  let originalVertex: string | undefined
  let originalFoundry: string | undefined

  beforeEach(() => {
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    originalVertex = process.env.CLAUDE_CODE_USE_VERTEX
    originalFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY

    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
  })

  afterEach(() => {
    restoreEnv('ANTHROPIC_BASE_URL', originalBaseUrl)
    restoreEnv('ANTHROPIC_MODEL', originalModel)
    restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalBedrock)
    restoreEnv('CLAUDE_CODE_USE_VERTEX', originalVertex)
    restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalFoundry)
  })

  test('does not enable web search for Anthropic-compatible third-party base URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'

    expect(WebSearchTool.isEnabled()).toBe(false)
  })

  test('keeps web search enabled for first-party Anthropic URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

    expect(WebSearchTool.isEnabled()).toBe(true)
  })

  test('keeps web search enabled for supported Vertex Claude models', () => {
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-5'

    expect(WebSearchTool.isEnabled()).toBe(true)
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { WebSearchTool } from './WebSearchTool.js'

describe('WebSearchTool availability', () => {
  let originalBaseUrl: string | undefined
  let originalModel: string | undefined
  let originalBedrock: string | undefined
  let originalVertex: string | undefined
  let originalFoundry: string | undefined
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL
    originalModel = process.env.ANTHROPIC_MODEL
    originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK
    originalVertex = process.env.CLAUDE_CODE_USE_VERTEX
    originalFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY
    originalFetch = globalThis.fetch

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
    globalThis.fetch = originalFetch
  })

  test('enables fallback web search for Anthropic-compatible third-party base URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'

    expect(WebSearchTool.isEnabled()).toBe(true)
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

  test('uses RSS fallback search when native provider search is unavailable', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'
    globalThis.fetch = (async () => new Response(`
      <rss><channel>
        <item>
          <title>Donald J. Trump - The White House</title>
          <link>https://www.whitehouse.gov/administration/donald-j-trump/</link>
          <description>Donald J. Trump is the 47th President of the United States.</description>
        </item>
      </channel></rss>
    `, { status: 200, statusText: 'OK' })) as typeof fetch

    const progress: unknown[] = []
    const result = await WebSearchTool.call(
      { query: 'current president of the United States' },
      { abortController: new AbortController() } as any,
      undefined as any,
      undefined as any,
      (event) => progress.push(event),
    )

    expect(result.data.query).toBe('current president of the United States')
    expect(result.data.results[0]).toMatchObject({
      content: [
        {
          title: 'Donald J. Trump - The White House',
          url: 'https://www.whitehouse.gov/administration/donald-j-trump/',
        },
      ],
    })
    expect(progress).toHaveLength(2)
  })

  test('allows read-only web search without prompting', async () => {
    const input = { query: 'United States president May 2026' }

    await expect(WebSearchTool.checkPermissions(input as any, {} as any)).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'WebSearch is read-only public web search',
      },
    })
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { normalizeFileWriteContentForAPI } from '../api.js'
import { createAssistantMessage, normalizeMessagesForAPI } from '../messages.js'

describe('FileWrite API history normalization', () => {
  let originalLimit: string | undefined

  beforeEach(() => {
    originalLimit = process.env.CLAUDE_CODE_FILE_WRITE_CONTENT_API_HISTORY_LIMIT
    delete process.env.CLAUDE_CODE_FILE_WRITE_CONTENT_API_HISTORY_LIMIT
  })

  afterEach(() => {
    if (originalLimit === undefined) {
      delete process.env.CLAUDE_CODE_FILE_WRITE_CONTENT_API_HISTORY_LIMIT
    } else {
      process.env.CLAUDE_CODE_FILE_WRITE_CONTENT_API_HISTORY_LIMIT = originalLimit
    }
  })

  test('omits large Write content from assistant tool_use history', () => {
    const largeContent = 'x'.repeat(25_000)
    const message = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: FileWriteTool.name,
          input: {
            file_path: '/tmp/large.txt',
            content: largeContent,
          },
        } as any,
      ],
    })

    const normalized = normalizeMessagesForAPI([message], [FileWriteTool])
    const block = normalized[0]?.message.content[0] as any

    expect(block.type).toBe('tool_use')
    expect(block.input.file_path).toBe('/tmp/large.txt')
    expect(block.input.content).toContain('Large Write content omitted')
    expect(block.input.content).toContain('/tmp/large.txt')
    expect(block.input.content).toContain('SHA256:')
    expect(block.input.content.length).toBeLessThan(400)
    expect(block.input.content).not.toBe(largeContent)
  })

  test('preserves small Write content', () => {
    const content = 'hello\nworld\n'
    expect(normalizeFileWriteContentForAPI('/tmp/small.txt', content)).toBe(content)
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  switchSession,
} from '../../bootstrap/state.js'
import { MAX_TOOL_RESULTS_PER_MESSAGE_CHARS } from '../../constants/toolLimits.js'
import { asSessionId } from '../../types/ids.js'
import {
  buildLargeToolResultMessage,
  buildToolResultHandle,
  createContentReplacementState,
  enforceToolResultBudget,
  isPersistError,
  parsePersistedToolResultMessage,
  parseToolResultHandle,
  persistToolResult,
  PERSISTED_OUTPUT_TAG,
  readPersistedToolResultByHandle,
} from '../toolResultStorage.js'

describe('tool result storage', () => {
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  const tempDirs: string[] = []

  afterEach(async () => {
    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }
    resetStateForTests()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('builds a model-visible handle for persisted tool result previews', () => {
    const handle = buildToolResultHandle('toolu_p6a')
    const message = buildLargeToolResultMessage({
      toolUseId: 'toolu_p6a',
      handle,
      filepath: 'D:\\tmp\\toolu_p6a.txt',
      originalSize: 123_456,
      isJson: false,
      preview: 'first lines',
      hasMore: true,
    })

    expect(message.startsWith(PERSISTED_OUTPUT_TAG)).toBe(true)
    expect(message).toContain('Handle: tool-result:toolu_p6a')
    expect(message).toContain('Full output saved to: D:\\tmp\\toolu_p6a.txt')
    expect(parsePersistedToolResultMessage(message)).toEqual({
      handle,
      filepath: 'D:\\tmp\\toolu_p6a.txt',
    })
  })

  test('records handle metadata when enforcing the aggregate tool result budget', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'cc-gugu-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'cc-gugu-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('p6a-tool-result-session'))

    const originalContent = 'x'.repeat(MAX_TOOL_RESULTS_PER_MESSAGE_CHARS + 1)
    const state = createContentReplacementState()
    const messages = [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_large',
              content: originalContent,
            },
          ],
        },
      },
    ]

    const result = await enforceToolResultBudget(messages as never, state)
    const replacement = result.newlyReplaced[0]
    const replacedContent = (
      result.messages[0] as typeof messages[number]
    ).message.content[0].content

    expect(replacement).toMatchObject({
      kind: 'tool-result',
      toolUseId: 'toolu_large',
      handle: 'tool-result:toolu_large',
      originalSize: originalContent.length,
    })
    expect(replacement.filepath).toEndWith(join('tool-results', 'toolu_large.txt'))
    expect(replacedContent).toContain('Handle: tool-result:toolu_large')
    expect(parsePersistedToolResultMessage(replacedContent)).toEqual({
      handle: replacement.handle,
      filepath: replacement.filepath,
    })
  })

  test('resolves persisted output by handle within the active session directory', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'cc-gugu-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'cc-gugu-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('p6a-tool-result-resolve-session'))

    const persisted = await persistToolResult('full persisted content', 'toolu_resolve')
    expect(isPersistError(persisted)).toBe(false)
    if (isPersistError(persisted)) return

    expect(parseToolResultHandle(persisted.handle)).toBe('toolu_resolve')
    expect(await readPersistedToolResultByHandle(persisted.handle)).toMatchObject({
      handle: persisted.handle,
      toolUseId: 'toolu_resolve',
      filepath: persisted.filepath,
      isJson: false,
      content: 'full persisted content',
    })
  })

  test('rejects handles that could escape the tool-results directory', async () => {
    expect(parseToolResultHandle('tool-result:../secret')).toBeNull()
    expect(await readPersistedToolResultByHandle('tool-result:../secret')).toEqual({
      error: 'Invalid tool result handle',
    })
  })
})

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
import { asSessionId } from '../../types/ids.js'
import {
  getToolResultPath,
  isPersistError,
  persistToolResult,
} from '../../utils/toolResultStorage.js'
import { FileReadTool } from './FileReadTool.js'

describe('FileReadTool persisted tool-result handles', () => {
  const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  const originalSimple = process.env.CLAUDE_CODE_SIMPLE
  const tempDirs: string[] = []

  afterEach(async () => {
    restoreEnv('CLAUDE_CONFIG_DIR', originalClaudeConfigDir)
    restoreEnv('CLAUDE_CODE_SIMPLE', originalSimple)
    resetStateForTests()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('reads a persisted tool result by handle', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'cc-gugu-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'cc-gugu-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_SIMPLE = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('read-tool-result-handle-session'))

    const persisted = await persistToolResult('first line\nsecond line', 'toolu_read_handle')
    expect(isPersistError(persisted)).toBe(false)
    if (isPersistError(persisted)) return

    const result = await FileReadTool.call(
      { file_path: persisted.handle },
      createReadContext() as never,
    )

    expect(result.data.type).toBe('text')
    if (result.data.type !== 'text') return
    expect(result.data.file.filePath).toBe('tool-result:toolu_read_handle')
    expect(result.data.file.content).toBe('first line\nsecond line')
  })

  test('reads a JSON-backed persisted tool result by handle', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'cc-gugu-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'cc-gugu-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.CLAUDE_CODE_SIMPLE = '1'
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('read-tool-result-json-handle-session'))

    const persisted = await persistToolResult(
      [{ type: 'text', text: 'json-backed content' }],
      'toolu_read_json_handle',
    )
    expect(isPersistError(persisted)).toBe(false)
    if (isPersistError(persisted)) return

    const result = await FileReadTool.call(
      { file_path: persisted.handle },
      createReadContext() as never,
    )

    expect(result.data.type).toBe('text')
    if (result.data.type !== 'text') return
    expect(result.data.file.filePath).toBe('tool-result:toolu_read_json_handle')
    expect(result.data.file.content).toContain('"type": "text"')
    expect(result.data.file.content).toContain('"text": "json-backed content"')
  })

  test('backfills handle permission checks to the session tool-results directory', () => {
    const input: Record<string, unknown> = {
      file_path: 'tool-result:toolu_permission',
    }

    FileReadTool.backfillObservableInput?.(input)

    expect(input.file_path).toBe(getToolResultPath('toolu_permission', false))
  })

  test('checks permissions against the resolved persisted JSON file path', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'cc-gugu-config-'))
    const projectDir = await mkdtemp(join(tmpdir(), 'cc-gugu-project-'))
    tempDirs.push(configDir, projectDir)
    process.env.CLAUDE_CONFIG_DIR = configDir
    setOriginalCwd(projectDir)
    setCwdState(projectDir)
    switchSession(asSessionId('read-tool-result-json-permission-session'))

    const persisted = await persistToolResult(
      [{ type: 'text', text: 'json-backed content' }],
      'toolu_json_permission',
    )
    expect(isPersistError(persisted)).toBe(false)
    if (isPersistError(persisted)) return

    const decision = await FileReadTool.checkPermissions?.(
      { file_path: persisted.handle },
      {
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {
              localSettings: [`Read(${persisted.filepath})`],
            },
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          },
        }),
      } as never,
    )

    expect(decision?.behavior).toBe('ask')
    expect(decision?.message).toContain(persisted.filepath)
    expect(decision?.message).not.toContain(getToolResultPath('toolu_json_permission', false))
  })

  test('rejects invalid persisted tool-result handles during validation', async () => {
    const result = await FileReadTool.validateInput?.(
      { file_path: 'tool-result:../secret' },
      {} as never,
    )

    expect(result).toMatchObject({
      result: false,
      errorCode: 10,
    })
  })
})

function createReadContext() {
  return {
    readFileState: new Map(),
    fileReadingLimits: {
      maxSizeBytes: 1024 * 1024,
      maxTokens: 100_000,
    },
    abortController: new AbortController(),
    nestedMemoryAttachmentTriggers: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

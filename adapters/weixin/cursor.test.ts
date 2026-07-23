import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadCursor, saveCursor } from './cursor.js'

describe('WeChat update cursor', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-cursor-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('resumes only the cursor belonging to the active account', async () => {
    expect(await loadCursor('bot-1')).toBe('')

    await saveCursor('bot-1', 'cursor-1')

    expect(await loadCursor('bot-1')).toBe('cursor-1')
    expect(await loadCursor('bot-2')).toBe('')
  })

  test('recovers from a malformed cursor file', async () => {
    const cursorFile = path.join(tmpDir, 'weixin', 'cursor.json')
    await fs.mkdir(path.dirname(cursorFile), { recursive: true })
    await fs.writeFile(cursorFile, '{broken', 'utf-8')

    expect(await loadCursor('bot-1')).toBe('')
  })
})

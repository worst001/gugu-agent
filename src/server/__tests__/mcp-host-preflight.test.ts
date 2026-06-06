import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectMcpHostCommand } from '../services/mcpHostPreflight.js'

const windowsOnly = process.platform === 'win32' ? it : it.skip

describe('mcp host preflight', () => {
  let tmpDir: string
  let originalPath: string | undefined
  let originalAppData: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-mcp-preflight-'))
    originalPath = process.env.PATH
    originalAppData = process.env.APPDATA
  })

  afterEach(async () => {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }

    if (originalAppData === undefined) {
      delete process.env.APPDATA
    } else {
      process.env.APPDATA = originalAppData
    }

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  windowsOnly('finds commands installed as npm shims under APPDATA', async () => {
    const appData = path.join(tmpDir, 'Roaming')
    const npmBin = path.join(appData, 'npm')
    const shim = path.join(npmBin, 'codegraph.cmd')
    await fs.mkdir(npmBin, { recursive: true })
    await fs.writeFile(shim, '@echo off\r\n')
    process.env.PATH = path.join(tmpDir, 'missing')
    process.env.APPDATA = appData

    const result = await inspectMcpHostCommand('codegraph', tmpDir)

    expect(result).toEqual({
      ok: true,
      resolvedCommand: shim,
    })
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildClaudeCliArgs,
  resolveBundledCliPathFromExecPath,
  resolveClaudeCliLauncher,
  resolveClaudeCliSpawnArgs,
} from '../desktopBundledCli.js'

describe('desktop bundled CLI launcher', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  test('recognizes the packaged gugu-sidecar as the desktop CLI launcher', () => {
    const execPath = '/Applications/gugu-agent.app/Contents/MacOS/gugu-sidecar'
    const appRoot = '/Applications/gugu-agent.app/Contents/MacOS'

    expect(resolveBundledCliPathFromExecPath(execPath)).toBe(execPath)

    const launcher = resolveClaudeCliLauncher({ execPath })
    expect(launcher).toEqual({
      command: execPath,
      kind: 'sidecar',
      requiresAppRoot: true,
    })
    expect(buildClaudeCliArgs(launcher!, ['--help'], appRoot)).toEqual([
      execPath,
      'cli',
      '--app-root',
      appRoot,
      '--help',
    ])
  })

  test('recognizes explicit gugu-sidecar cli paths', () => {
    const launcher = resolveClaudeCliLauncher({
      cliPath: '/tmp/gugu-sidecar-aarch64-apple-darwin',
    })

    expect(launcher).toEqual({
      command: '/tmp/gugu-sidecar-aarch64-apple-darwin',
      kind: 'sidecar',
      requiresAppRoot: true,
    })
  })

  test('finds a sidecar next to the packaged desktop executable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-sidecar-test-'))
    tmpDirs.push(dir)
    const execPath = path.join(dir, 'Gugu Agent.exe')
    const sidecarPath = path.join(dir, 'gugu-sidecar-x86_64-pc-windows-msvc.exe')
    await fs.writeFile(execPath, '')
    await fs.writeFile(sidecarPath, '')

    expect(
      resolveBundledCliPathFromExecPath(execPath, {
        platform: 'win32',
      }),
    ).toBe(sidecarPath)

    const launcher = resolveClaudeCliLauncher({
      execPath,
      appRoot: dir,
      platform: 'win32',
    })
    expect(launcher).toEqual({
      command: sidecarPath,
      kind: 'sidecar',
      requiresAppRoot: true,
    })
    expect(buildClaudeCliArgs(launcher!, ['--print'], dir)).toEqual([
      sidecarPath,
      'cli',
      '--app-root',
      dir,
      '--print',
    ])

    expect(
      resolveClaudeCliSpawnArgs(['--print'], {
        execPath,
        appRoot: dir,
        importMetaDir: 'B:\\src\\server\\services',
        platform: 'win32',
      }),
    ).toEqual([
      sidecarPath,
      'cli',
      '--app-root',
      dir,
      '--print',
    ])
  })

  test('does not execute Bun virtual source paths in packaged Windows builds', () => {
    expect(() =>
      resolveClaudeCliSpawnArgs(['--print'], {
        execPath: 'C:\\Program Files\\Gugu Agent\\Gugu Agent.exe',
        appRoot: 'C:\\Program Files\\Gugu Agent',
        importMetaDir: 'B:\\src\\server\\services',
        platform: 'win32',
        fileExists: () => false,
      }),
    ).toThrow('Could not locate the bundled Gugu CLI launcher')
  })
})

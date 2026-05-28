import { describe, expect, test } from 'bun:test'
import {
  buildClaudeCliArgs,
  resolveBundledCliPathFromExecPath,
  resolveClaudeCliLauncher,
} from '../desktopBundledCli.js'

describe('desktop bundled CLI launcher', () => {
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
})

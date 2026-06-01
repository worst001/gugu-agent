import { describe, expect, it } from 'vitest'

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'

describe('resolveSidecarInvocation', () => {
  it('keeps explicit sidecar modes unchanged', () => {
    expect(
      resolveSidecarInvocation(
        ['server', '--host', '127.0.0.1'],
        '/tmp/claude-sidecar',
      ),
    ).toEqual({
      mode: 'server',
      restArgs: ['--host', '127.0.0.1'],
      defaultAppRoot: null,
    })
  })

  it('recognizes the bundled claude-mem MCP launcher mode', () => {
    expect(
      resolveSidecarInvocation(
        ['claude-mem-mcp', '--plugin-root', '/tmp/claude-mem'],
        '/tmp/gugu-sidecar',
        '/tmp/app',
      ),
    ).toEqual({
      mode: 'claude-mem-mcp',
      restArgs: ['--plugin-root', '/tmp/claude-mem'],
      defaultAppRoot: '/tmp/app',
    })
  })

  it('defaults claude-gugu invocations to cli mode', () => {
    expect(
      resolveSidecarInvocation(
        ['plugin', 'install', 'demo'],
        '/Users/demo/.local/bin/claude-gugu',
      ),
    ).toEqual({
      mode: 'cli',
      restArgs: ['plugin', 'install', 'demo'],
      defaultAppRoot: '/Users/demo/.local/bin',
    })
  })
})

describe('parseLauncherArgs', () => {
  it('falls back to the provided default app root', () => {
    expect(
      parseLauncherArgs(['plugin', 'install', 'demo'], '/Users/demo/.local/bin'),
    ).toEqual({
      appRoot: '/Users/demo/.local/bin',
      args: ['plugin', 'install', 'demo'],
    })
  })

  it('lets explicit app root override the default', () => {
    expect(
      parseLauncherArgs(
        ['--app-root', '/tmp/app', 'plugin', 'install', 'demo'],
        '/Users/demo/.local/bin',
      ),
    ).toEqual({
      appRoot: '/tmp/app',
      args: ['plugin', 'install', 'demo'],
    })
  })
})

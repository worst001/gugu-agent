import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { McpServerConfig } from '../../services/mcp/types.js'
import { getPluginDataDir } from './pluginDirectories.js'

let bundledMode = false

mock.module('../bundledMode.js', () => ({
  isInBundledMode: () => bundledMode,
}))

const { getPluginMcpServers, resolvePluginMcpEnvironment } = await import(
  './mcpPluginIntegration.js'
)

const originalClaudeAppRoot = process.env.CLAUDE_APP_ROOT
const tempDirs: string[] = []

const claudeMemPlugin = {
  path: 'D:\\Gugu\\resources\\gugu-agent-pack\\third-party\\compound-engineering-plugin\\plugins\\claude-mem',
  source: 'claude-mem@gugu-bundled',
}

function restoreEnv(): void {
  if (originalClaudeAppRoot === undefined) {
    delete process.env.CLAUDE_APP_ROOT
  } else {
    process.env.CLAUDE_APP_ROOT = originalClaudeAppRoot
  }
}

function makeClaudeMemPluginWithServerScript(): typeof claudeMemPlugin {
  const pluginRoot = mkdtempSync(join(tmpdir(), 'gugu-claude-mem-'))
  tempDirs.push(pluginRoot)
  const scriptsDir = join(pluginRoot, 'scripts')
  mkdirSync(scriptsDir)
  writeFileSync(join(scriptsDir, 'mcp-server.cjs'), 'module.exports = {}\n')

  return {
    path: pluginRoot,
    source: 'claude-mem@gugu-bundled',
  }
}

describe('resolvePluginMcpEnvironment', () => {
  beforeEach(() => {
    bundledMode = false
    process.env.CLAUDE_APP_ROOT = 'D:\\Gugu'
  })

  afterEach(() => {
    restoreEnv()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses the bundled sidecar launcher for desktop claude-mem MCP search', () => {
    bundledMode = true

    const resolved = resolvePluginMcpEnvironment(
      {
        type: 'stdio',
        command: 'sh',
        args: ['-c', 'exec node "$CLAUDE_PLUGIN_ROOT/scripts/mcp-server.cjs"'],
      },
      claudeMemPlugin,
      undefined,
      [],
      'claude-mem',
      'mcp-search',
    )

    expect(resolved).toMatchObject({
      type: 'stdio',
      command: process.execPath,
      args: [
        'claude-mem-mcp',
        '--app-root',
        'D:\\Gugu',
        '--plugin-root',
        claudeMemPlugin.path,
      ],
      env: {
        CLAUDE_PLUGIN_ROOT: claudeMemPlugin.path,
        CLAUDE_PLUGIN_DATA: getPluginDataDir(claudeMemPlugin.source),
      },
    } satisfies McpServerConfig)
  })

  it('uses the current JS runtime for local claude-mem MCP search', () => {
    const plugin = makeClaudeMemPluginWithServerScript()

    const resolved = resolvePluginMcpEnvironment(
      {
        type: 'stdio',
        command: 'sh',
        args: ['-c', 'exec node "$CLAUDE_PLUGIN_ROOT/scripts/mcp-server.cjs"'],
      },
      plugin,
      undefined,
      [],
      'claude-mem',
      'mcp-search',
    )

    expect(resolved).toMatchObject({
      type: 'stdio',
      command: process.execPath,
      args: [join(plugin.path, 'scripts', 'mcp-server.cjs')],
      env: {
        CLAUDE_PLUGIN_ROOT: plugin.path,
        CLAUDE_PLUGIN_DATA: getPluginDataDir(plugin.source),
      },
    } satisfies McpServerConfig)
  })

  it('keeps the upstream launcher when no local claude-mem script is available', () => {
    const resolved = resolvePluginMcpEnvironment(
      {
        type: 'stdio',
        command: 'sh',
        args: ['-c', 'exec node "$CLAUDE_PLUGIN_ROOT/scripts/mcp-server.cjs"'],
      },
      claudeMemPlugin,
      undefined,
      [],
      'claude-mem',
      'mcp-search',
    )

    expect(resolved).toMatchObject({
      type: 'stdio',
      command: 'sh',
      args: ['-c', 'exec node "$CLAUDE_PLUGIN_ROOT/scripts/mcp-server.cjs"'],
    } satisfies McpServerConfig)
  })

  it('suppresses qmd plugin MCP by default', async () => {
    const servers = await getPluginMcpServers({
      name: 'qmd',
      path: 'D:\\Gugu\\resources\\qmd',
      source: 'qmd@qmd',
      repository: 'qmd@qmd',
      enabled: true,
      manifest: {
        name: 'qmd',
        version: '0.1.0',
      },
      mcpServers: {
        qmd: {
          type: 'stdio',
          command: 'qmd',
          args: ['mcp'],
        },
      },
    })

    expect(servers).toEqual({})
  })
})

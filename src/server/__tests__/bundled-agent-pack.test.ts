import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { bootstrapBundledAgentPack } from '../services/bundledAgentPackService.js'
import { PluginService } from '../services/pluginService.js'
import { clearMarketplacesCache } from '../../utils/plugins/marketplaceManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'

describe('bundled agent pack bootstrap', () => {
  let tmpDir: string
  let packDir: string
  let originalConfigDir: string | undefined
  let originalPackDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-agent-pack-'))
    packDir = path.join(tmpDir, 'pack')
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalPackDir = process.env.GUGU_AGENT_PACK_DIR
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, 'config')
    process.env.GUGU_AGENT_PACK_DIR = packDir

    await writeFixturePack(packDir)
  })

  afterEach(async () => {
    restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
    restoreEnv('GUGU_AGENT_PACK_DIR', originalPackDir)
    clearMarketplacesCache()
    clearInstalledPluginsCache()
    clearPluginCache('bundled agent pack test cleanup')
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('registers gugu-bundled marketplace and enables packaged plugins', async () => {
    await bootstrapBundledAgentPack()

    const configDir = path.join(tmpDir, 'config')
    const marketplaceRoot = path.join(
      packDir,
      'third-party',
      'compound-engineering-plugin',
    )
    const knownMarketplaces = await readJson(
      path.join(configDir, 'plugins', 'known_marketplaces.json'),
    )
    expect(knownMarketplaces['gugu-bundled']).toMatchObject({
      source: { source: 'directory', path: marketplaceRoot },
      installLocation: marketplaceRoot,
      autoUpdate: false,
    })

    const installedPlugins = await readJson(
      path.join(configDir, 'plugins', 'installed_plugins.json'),
    )
    expect(
      installedPlugins.plugins['compound-engineering@gugu-bundled'][0].installPath,
    ).toBe(path.join(marketplaceRoot, 'plugins', 'compound-engineering'))
    expect(
      installedPlugins.plugins['coding-tutor@gugu-bundled'][0].installPath,
    ).toBe(path.join(marketplaceRoot, 'plugins', 'coding-tutor'))
    expect(
      installedPlugins.plugins['engineering-skills@gugu-bundled'][0].installPath,
    ).toBe(path.join(marketplaceRoot, 'plugins', 'engineering-skills'))

    const settings = await readJson(path.join(configDir, 'settings.json'))
    expect(settings.enabledPlugins).toMatchObject({
      'compound-engineering@gugu-bundled': true,
      'coding-tutor@gugu-bundled': true,
      'engineering-skills@gugu-bundled': true,
    })

    const pluginList = await new PluginService().listPlugins()
    const bundledPlugins = pluginList.plugins.filter(
      (plugin) => plugin.marketplace === 'gugu-bundled',
    )
    expect(bundledPlugins.map((plugin) => plugin.id).sort()).toEqual([
      'coding-tutor@gugu-bundled',
      'compound-engineering@gugu-bundled',
      'engineering-skills@gugu-bundled',
    ])
    expect(bundledPlugins.every((plugin) => plugin.enabled)).toBe(true)
    expect(bundledPlugins.every((plugin) => plugin.errors.length === 0)).toBe(true)
    expect(pluginList.marketplaces.some((item) => item.name === 'gugu-bundled')).toBe(true)
  })
})

async function writeFixturePack(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'api-and-interface-design'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'api-and-interface-design', 'SKILL.md'),
    '# API Skill\n',
    'utf-8',
  )

  const marketplaceRoot = path.join(
    root,
    'third-party',
    'compound-engineering-plugin',
  )
  await writeJson(
    path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
    {
      name: 'compound-engineering-plugin',
      owner: { name: 'Gugu' },
      plugins: [
        {
          name: 'compound-engineering',
          description: 'Compound Engineering',
          source: './plugins/compound-engineering',
        },
        {
          name: 'coding-tutor',
          description: 'Coding Tutor',
          source: './plugins/coding-tutor',
        },
        {
          name: 'engineering-skills',
          description: 'Engineering Skills',
          source: './plugins/engineering-skills',
        },
      ],
    },
  )

  await writePluginManifest(
    path.join(marketplaceRoot, 'plugins', 'compound-engineering'),
    'compound-engineering',
    '3.7.3',
  )
  await writePluginManifest(
    path.join(marketplaceRoot, 'plugins', 'coding-tutor'),
    'coding-tutor',
    '1.0.0',
  )
  await writePluginManifest(
    path.join(marketplaceRoot, 'plugins', 'engineering-skills'),
    'engineering-skills',
    '2.2.3',
  )
}

async function writePluginManifest(
  pluginDir: string,
  name: string,
  version: string,
): Promise<void> {
  const manifest = {
    name,
    version,
    description: name,
    author: { name: 'Gugu' },
    skills: './skills',
  }
  await writeJson(path.join(pluginDir, '.codex-plugin', 'plugin.json'), manifest)
  await writeJson(path.join(pluginDir, '.claude-plugin', 'plugin.json'), manifest)
  await fs.mkdir(path.join(pluginDir, 'skills', name), { recursive: true })
  await fs.writeFile(
    path.join(pluginDir, 'skills', name, 'SKILL.md'),
    `# ${name}\n`,
    'utf-8',
  )
}

async function readJson(filePath: string): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'))
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

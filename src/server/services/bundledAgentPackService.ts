import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'
import { registerPluginInstallation } from '../../utils/plugins/pluginInstallationHelpers.js'

type BundledSkillRecord = {
  sourceHash: string
  installedHash: string
  sourcePath: string
  updatedAt: string
}

type BundledPluginRecord = {
  pluginId: string
  installPath: string
  version: string
  updatedAt: string
}

type BundledAgentPackManifest = {
  version: 1
  sourceRoot: string
  skills: Record<string, BundledSkillRecord>
  plugins: Record<string, BundledPluginRecord>
}

type SkillSource = {
  name: string
  sourcePath: string
}

type PluginSource = {
  pluginId: string
  pluginName: string
  sourcePath: string
  version: string
}

const MANIFEST_FILE = 'bundled-agent-pack.json'
const BUNDLED_MARKETPLACE = 'gugu-bundled'
const SKILL_MD = 'SKILL.md'

export async function bootstrapBundledAgentPack(): Promise<void> {
  const sourceRoot = await resolveBundledAgentPackRoot()
  if (!sourceRoot) return

  const manifest = await readManifest()
  const nextManifest: BundledAgentPackManifest = {
    version: 1,
    sourceRoot,
    skills: { ...manifest.skills },
    plugins: { ...manifest.plugins },
  }

  const skillSources = await discoverSkillSources(sourceRoot)
  for (const source of skillSources) {
    await installSkillSource(source, nextManifest)
  }

  const pluginSources = await discoverPluginSources(sourceRoot)
  const enabledPlugins: Record<string, true> = {}
  for (const plugin of pluginSources) {
    registerPluginInstallation(
      {
        pluginId: plugin.pluginId,
        installPath: plugin.sourcePath,
        version: plugin.version,
      },
      'user',
    )
    enabledPlugins[plugin.pluginId] = true
    nextManifest.plugins[plugin.pluginId] = {
      pluginId: plugin.pluginId,
      installPath: plugin.sourcePath,
      version: plugin.version,
      updatedAt: new Date().toISOString(),
    }
  }

  if (Object.keys(enabledPlugins).length > 0) {
    const settings = getSettingsForSource('userSettings')
    updateSettingsForSource('userSettings', {
      enabledPlugins: {
        ...(settings?.enabledPlugins ?? {}),
        ...enabledPlugins,
      },
    })
  }

  await writeManifest(nextManifest)
}

async function installSkillSource(
  source: SkillSource,
  manifest: BundledAgentPackManifest,
): Promise<void> {
  const targetPath = path.join(getConfigDir(), 'skills', source.name)
  const sourceHash = await hashDirectory(source.sourcePath)
  const currentHash = await hashDirectoryIfExists(targetPath)
  const previous = manifest.skills[source.name]

  if (currentHash) {
    if (currentHash === sourceHash) {
      manifest.skills[source.name] = {
        sourceHash,
        installedHash: currentHash,
        sourcePath: source.sourcePath,
        updatedAt: previous?.updatedAt ?? new Date().toISOString(),
      }
      return
    }

    if (!previous || currentHash !== previous.installedHash) {
      return
    }

    await fs.rm(targetPath, { recursive: true, force: true })
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.cp(source.sourcePath, targetPath, {
    recursive: true,
    filter: (item) => !shouldSkipBundledPath(item),
  })
  const installedHash = await hashDirectory(targetPath)
  manifest.skills[source.name] = {
    sourceHash,
    installedHash,
    sourcePath: source.sourcePath,
    updatedAt: new Date().toISOString(),
  }
}

async function discoverSkillSources(sourceRoot: string): Promise<SkillSource[]> {
  const skillDirs: SkillSource[] = []
  const skillFiles = await findFiles(sourceRoot, SKILL_MD)
  for (const filePath of skillFiles) {
    const skillDir = path.dirname(filePath)
    const relative = path.relative(sourceRoot, skillDir)
    const parts = relative.split(path.sep)
    const isTopLevelSkill = parts.length === 1 && parts[0] !== 'third-party'
    const isPluginSkill =
      parts.includes('plugins') &&
      parts.includes('skills') &&
      !parts.includes('tests') &&
      !parts.includes('fixtures')

    if (!isTopLevelSkill && !isPluginSkill) continue
    skillDirs.push({
      name: path.basename(skillDir),
      sourcePath: skillDir,
    })
  }

  const byName = new Map<string, SkillSource>()
  for (const source of skillDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!byName.has(source.name)) byName.set(source.name, source)
  }
  return [...byName.values()]
}

async function discoverPluginSources(sourceRoot: string): Promise<PluginSource[]> {
  const pluginRoot = path.join(sourceRoot, 'third-party')
  const pluginJsonFiles = await findFilesIfExists(pluginRoot, 'plugin.json')
  const plugins: PluginSource[] = []

  for (const pluginJson of pluginJsonFiles) {
    if (!pluginJson.includes(`${path.sep}.codex-plugin${path.sep}`)) continue
    const pluginDir = path.dirname(path.dirname(pluginJson))
    const pluginName = path.basename(pluginDir)
    const manifest = await readJsonFile(pluginJson)
    plugins.push({
      pluginId: `${pluginName}@${BUNDLED_MARKETPLACE}`,
      pluginName,
      sourcePath: pluginDir,
      version: typeof manifest.version === 'string' && manifest.version.trim()
        ? manifest.version.trim()
        : 'bundled',
    })
  }

  return plugins.sort((a, b) => a.pluginId.localeCompare(b.pluginId))
}

async function resolveBundledAgentPackRoot(): Promise<string | null> {
  const candidates = [
    process.env.GUGU_AGENT_PACK_DIR,
    path.resolve(process.cwd(), '.agents', 'skills'),
    path.resolve(import.meta.dir, '..', '..', '..', '.agents', 'skills'),
    process.env.CLAUDE_APP_ROOT
      ? path.resolve(process.env.CLAUDE_APP_ROOT, 'gugu-agent-pack')
      : undefined,
  ].filter((item): item is string => Boolean(item && item.trim()))

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'api-and-interface-design', SKILL_MD))) {
      return candidate
    }
  }
  return null
}

async function readManifest(): Promise<BundledAgentPackManifest> {
  try {
    const raw = await fs.readFile(getManifestPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<BundledAgentPackManifest>
    return {
      version: 1,
      sourceRoot: typeof parsed.sourceRoot === 'string' ? parsed.sourceRoot : '',
      skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {},
      plugins: parsed.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, sourceRoot: '', skills: {}, plugins: {} }
    }
    throw error
  }
}

async function writeManifest(manifest: BundledAgentPackManifest): Promise<void> {
  const filePath = getManifestPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
}

function getManifestPath(): string {
  return path.join(getConfigDir(), 'cc-haha', MANIFEST_FILE)
}

function getConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

async function hashDirectoryIfExists(dir: string): Promise<string | null> {
  if (!await pathExists(dir)) return null
  return hashDirectory(dir)
}

async function hashDirectory(dir: string): Promise<string> {
  const hash = createHash('sha256')
  const files = await listFiles(dir)
  for (const filePath of files.sort()) {
    if (shouldSkipBundledPath(filePath)) continue
    const relative = path.relative(dir, filePath).replace(/\\/g, '/')
    hash.update(relative)
    hash.update('\0')
    hash.update(await fs.readFile(filePath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (shouldSkipBundledPath(fullPath)) continue
    if (entry.isDirectory()) files.push(...await listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

async function findFilesIfExists(root: string, fileName: string): Promise<string[]> {
  if (!await pathExists(root)) return []
  return findFiles(root, fileName)
}

async function findFiles(root: string, fileName: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (shouldSkipBundledPath(fullPath)) continue
    if (entry.isDirectory()) files.push(...await findFiles(fullPath, fileName))
    else if (entry.isFile() && entry.name === fileName) files.push(fullPath)
  }
  return files
}

function shouldSkipBundledPath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/)
  return parts.includes('.git') || parts.includes('node_modules') || parts.includes('dist')
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

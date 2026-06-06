import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type EnvRecord = Record<string, string | undefined>

type HostCommandPathOptions = {
  platform?: NodeJS.Platform
  pathExists?: (entry: string) => boolean
}

function getPathDelimiter(platform: NodeJS.Platform) {
  return platform === 'win32' ? ';' : ':'
}

function getPathModule(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function getPathEnvKeys(env: EnvRecord) {
  return Object.keys(env).filter(key => key.toLowerCase() === 'path')
}

function getPreferredPathEnvKey(env: EnvRecord) {
  if (Object.prototype.hasOwnProperty.call(env, 'PATH')) return 'PATH'
  if (Object.prototype.hasOwnProperty.call(env, 'Path')) return 'Path'
  return getPathEnvKeys(env)[0] ?? 'PATH'
}

function getPathEnvValue(env: EnvRecord) {
  return env[getPreferredPathEnvKey(env)] ?? ''
}

function splitPathEntries(envPath: string, platform: NodeJS.Platform) {
  return envPath
    .split(getPathDelimiter(platform))
    .map(entry => entry.trim())
    .filter(Boolean)
}

function normalizePathEntry(entry: string, platform: NodeJS.Platform) {
  const normalized = getPathModule(platform).normalize(entry)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function uniquePathEntries(entries: string[], platform: NodeJS.Platform) {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const entry of entries) {
    const key = normalizePathEntry(entry, platform)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(entry)
  }

  return unique
}

function entryExists(
  entry: string | undefined,
  pathExists: (entry: string) => boolean,
) {
  if (!entry) return false
  try {
    return pathExists(entry)
  } catch {
    return false
  }
}

function getWindowsUserCommandPathEntries(
  env: EnvRecord,
  pathExists: (entry: string) => boolean,
) {
  const winPath = path.win32
  const home = env.USERPROFILE ?? env.HOME ?? os.homedir()
  const appData =
    env.APPDATA ?? (home ? winPath.join(home, 'AppData', 'Roaming') : undefined)
  const localAppData =
    env.LOCALAPPDATA ??
    (home ? winPath.join(home, 'AppData', 'Local') : undefined)
  const programData = env.PROGRAMDATA ?? env.ProgramData

  const candidates = [
    appData && winPath.join(appData, 'npm'),
    home && winPath.join(home, '.bun', 'bin'),
    home && winPath.join(home, '.cargo', 'bin'),
    home && winPath.join(home, '.local', 'bin'),
    home && winPath.join(home, 'scoop', 'shims'),
    localAppData && winPath.join(localAppData, 'Microsoft', 'WindowsApps'),
    localAppData && winPath.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
    programData && winPath.join(programData, 'chocolatey', 'bin'),
    env.ProgramFiles && winPath.join(env.ProgramFiles, 'nodejs'),
    env['ProgramFiles(x86)'] && winPath.join(env['ProgramFiles(x86)'], 'nodejs'),
  ]

  return candidates.filter(entry => entryExists(entry, pathExists)) as string[]
}

function getPosixUserCommandPathEntries(
  env: EnvRecord,
  pathExists: (entry: string) => boolean,
) {
  const home = env.HOME ?? os.homedir()
  const candidates = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    home && path.posix.join(home, '.local', 'bin'),
    home && path.posix.join(home, '.bun', 'bin'),
    home && path.posix.join(home, '.cargo', 'bin'),
    home && path.posix.join(home, '.npm-global', 'bin'),
  ]

  return candidates.filter(entry => entryExists(entry, pathExists)) as string[]
}

export function getHostCommandPathEntries(
  env: EnvRecord = process.env,
  options: HostCommandPathOptions = {},
) {
  const platform = options.platform ?? process.platform
  const pathExists = options.pathExists ?? existsSync

  if (platform === 'win32') {
    return getWindowsUserCommandPathEntries(env, pathExists)
  }

  return getPosixUserCommandPathEntries(env, pathExists)
}

export function getHostCommandPath(
  env: EnvRecord = process.env,
  options: HostCommandPathOptions = {},
) {
  const platform = options.platform ?? process.platform
  const entries = [
    ...splitPathEntries(getPathEnvValue(env), platform),
    ...getHostCommandPathEntries(env, options),
  ]

  return uniquePathEntries(entries, platform).join(getPathDelimiter(platform))
}

export function withHostCommandPath(
  env: EnvRecord = process.env,
  options: HostCommandPathOptions = {},
): Record<string, string> {
  const platform = options.platform ?? process.platform
  const next = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string'
    }),
  )
  const hostPath = getHostCommandPath(next, options)
  const pathKeys = getPathEnvKeys(next)
  const keysToSet =
    platform === 'win32'
      ? Array.from(new Set([...pathKeys, 'PATH']))
      : ['PATH']

  for (const key of keysToSet) {
    next[key] = hostPath
  }

  return next
}

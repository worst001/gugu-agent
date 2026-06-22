import * as fs from 'node:fs'
import * as path from 'node:path'

export type ClaudeCliLauncher = {
  command: string
  kind: 'script' | 'sidecar' | 'binary'
  requiresAppRoot: boolean
}

type LauncherResolutionOptions = {
  appRoot?: string
  platform?: NodeJS.Platform
  fileExists?: (targetPath: string) => boolean
}

export type ClaudeCliSpawnResolutionOptions = LauncherResolutionOptions & {
  cliPath?: string | null
  execPath?: string
  importMetaDir?: string
  sourceLabel?: string
}

export function resolveBundledCliPathFromExecPath(
  execPath: string = process.execPath,
  options?: LauncherResolutionOptions,
): string | null {
  const execName = path.basename(execPath)

  if (isDesktopSidecarName(execName)) {
    return execPath
  }

  if (execName.startsWith('claude-server')) {
    const bundledCliPath = path.join(
      path.dirname(execPath),
      execName.replace(/^claude-server/, 'claude-cli'),
    )
    if (fs.existsSync(bundledCliPath)) return bundledCliPath
  }

  const siblingSidecar = resolveBundledSidecarFromInstallDirs({
    execPath,
    appRoot: options?.appRoot,
    platform: options?.platform,
    fileExists: options?.fileExists,
  })
  if (siblingSidecar) return siblingSidecar

  return null
}

export function resolveClaudeCliLauncher(options?: {
  cliPath?: string | null
  execPath?: string
  appRoot?: string
  platform?: NodeJS.Platform
  fileExists?: (targetPath: string) => boolean
}): ClaudeCliLauncher | null {
  const command =
    options?.cliPath || resolveBundledCliPathFromExecPath(options?.execPath, {
      appRoot: options?.appRoot,
      platform: options?.platform,
      fileExists: options?.fileExists,
    })

  if (!command) {
    return null
  }

  if (/\.(?:[cm]?[jt]s|tsx?)$/i.test(command)) {
    return {
      command,
      kind: 'script',
      requiresAppRoot: false,
    }
  }

  const cliBaseName = path.basename(command)
  if (isDesktopSidecarName(cliBaseName)) {
    return {
      command,
      kind: 'sidecar',
      requiresAppRoot: true,
    }
  }

  if (cliBaseName.startsWith('claude-cli')) {
    return {
      command,
      kind: 'binary',
      requiresAppRoot: true,
    }
  }

  return {
    command,
    kind: 'binary',
    requiresAppRoot: false,
  }
}

/**
 * Prefer the same Bun binary as the current process so desktop/server spawns
 * do not rely on `bun` being on PATH (avoids exit 127 from `bin/claude-gugu`).
 */
export function resolveBunExecutableForCliSpawn(): string {
  const base = path.basename(process.execPath).replace(/\.exe$/i, '')
  if (base === 'bun') return process.execPath
  return 'bun'
}

export function buildClaudeCliArgs(
  launcher: ClaudeCliLauncher,
  baseArgs: string[],
  appRoot: string | undefined = process.env.CLAUDE_APP_ROOT,
): string[] {
  if (launcher.kind === 'script') {
    return [resolveBunExecutableForCliSpawn(), launcher.command, ...baseArgs]
  }

  if (launcher.kind === 'sidecar') {
    return appRoot
      ? [launcher.command, 'cli', '--app-root', appRoot, ...baseArgs]
      : [launcher.command, 'cli', ...baseArgs]
  }

  if (launcher.requiresAppRoot && appRoot) {
    return [launcher.command, '--app-root', appRoot, ...baseArgs]
  }

  return [launcher.command, ...baseArgs]
}

export function resolveClaudeCliSpawnArgs(
  baseArgs: string[],
  options?: ClaudeCliSpawnResolutionOptions,
): string[] {
  const importMetaDir = options?.importMetaDir ?? process.cwd()
  const platform = options?.platform ?? process.platform
  const appRoot = options?.appRoot ?? process.env.CLAUDE_APP_ROOT
  const fileExists = options?.fileExists ?? fs.existsSync
  const launcher = resolveClaudeCliLauncher({
    cliPath: options?.cliPath ?? process.env.CLAUDE_CLI_PATH,
    execPath: options?.execPath ?? process.execPath,
    appRoot,
    platform,
    fileExists,
  })

  if (launcher) {
    return buildClaudeCliArgs(launcher, baseArgs, appRoot)
  }

  const label = options?.sourceLabel ?? 'desktop CLI'
  const devPreloadPath = path.resolve(importMetaDir, '../../../preload.ts')
  const devCliPath = path.resolve(importMetaDir, '../../entrypoints/cli.tsx')

  if (platform === 'win32') {
    if (!fileExists(devPreloadPath) || !fileExists(devCliPath)) {
      throw new Error(
        [
          `Could not locate the bundled Gugu CLI launcher for ${label}.`,
          'Checked CLAUDE_CLI_PATH, desktop sidecar siblings, and the development source entrypoint.',
          `Missing development entrypoint: ${devCliPath}`,
        ].join(' '),
      )
    }
    return [
      resolveBunExecutableForCliSpawn(),
      '--preload',
      devPreloadPath,
      devCliPath,
      ...baseArgs,
    ]
  }

  const devBinPath = path.resolve(importMetaDir, '../../../bin/claude-gugu')
  if (!fileExists(devBinPath)) {
    throw new Error(
      [
        `Could not locate the bundled Gugu CLI launcher for ${label}.`,
        'Checked CLAUDE_CLI_PATH, desktop sidecar siblings, and the development CLI script.',
        `Missing development script: ${devBinPath}`,
      ].join(' '),
    )
  }

  return [devBinPath, ...baseArgs]
}

function isDesktopSidecarName(fileName: string): boolean {
  return (
    fileName.startsWith('claude-sidecar') ||
    fileName.startsWith('gugu-sidecar')
  )
}

function platformExecutableName(baseName: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${baseName}.exe` : baseName
}

function sidecarTargetTriples(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']
  if (platform === 'darwin') return ['aarch64-apple-darwin', 'x86_64-apple-darwin']
  if (platform === 'linux') return ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu']
  return []
}

function sidecarCandidateNames(platform: NodeJS.Platform): string[] {
  const names: string[] = []
  for (const baseName of ['gugu-sidecar', 'claude-sidecar']) {
    names.push(platformExecutableName(baseName, platform))
    for (const triple of sidecarTargetTriples(platform)) {
      names.push(platformExecutableName(`${baseName}-${triple}`, platform))
    }
  }
  return [...new Set(names)]
}

function addCandidateDir(dirs: string[], dir: string | undefined | null) {
  if (!dir) return
  const normalized = path.normalize(dir)
  if (!dirs.includes(normalized)) dirs.push(normalized)
}

function resolveBundledSidecarFromInstallDirs(options: {
  execPath?: string
  appRoot?: string
  platform?: NodeJS.Platform
  fileExists?: (targetPath: string) => boolean
}): string | null {
  const fileExists = options.fileExists ?? fs.existsSync
  const platform = options.platform ?? process.platform
  const dirs: string[] = []

  if (options.execPath) {
    addCandidateDir(dirs, path.dirname(options.execPath))
  }
  addCandidateDir(dirs, options.appRoot)
  if (options.appRoot) {
    addCandidateDir(dirs, path.dirname(options.appRoot))
  }

  const expandedDirs = [...dirs]
  for (const dir of dirs) {
    addCandidateDir(expandedDirs, path.join(dir, 'binaries'))
    addCandidateDir(expandedDirs, path.join(dir, '..', '..', 'binaries'))
  }

  for (const dir of expandedDirs) {
    for (const name of sidecarCandidateNames(platform)) {
      const candidate = path.join(dir, name)
      if (fileExists(candidate)) return candidate
    }
  }

  return null
}

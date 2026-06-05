#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Mode = 'cut' | 'publish' | 'downloads' | 'updater' | 'metadata-fix' | 'smoke-templates' | 'plan'

type Options = {
  allowDirty: boolean
  allowExistingTag: boolean
  branch: string | null
  execute: boolean
  expectedOnlineLatest: string | null
  mode: Mode
  offline: boolean
  previousVersion: string | null
  publish: boolean
  remote: string
  runUrl: string | null
  skipDownloads: boolean
  skipGitee: boolean
  skipUpdater: boolean
  version: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')
const publicBaseUrl = 'https://gxy-download.oss-cn-shanghai.aliyuncs.com/'

function usage() {
  console.log(`One-click desktop release runner.

Usage:
  bun run scripts/desktop-release-one-click.ts <mode> --version <x.y.z> [options]

Modes:
  cut              Preflight, create release commit/tag, then push branch/tag for CI.
  publish          Generate metadata, check artifacts, publish downloads, updater, and Gitee.
  downloads        Generate release.json and publish only MSI/DMG download metadata/artifacts.
  updater          Merge latest.json and publish updater artifacts/latest.json.
  metadata-fix     Merge latest.json and upload only latest.json plus updater .sig files.
  smoke-templates  Generate Windows and macOS smoke receipt templates.
  plan             Print the command plan without running phases.

Options:
  --version <x.y.z>               Target version.
  --previous-version <x.y.z>      Old public version used for upgrade smoke.
  --execute                       Allow cut mode to create commit/tag and push CI refs.
  --publish                       Allow publish modes to write OSS/Gitee resources.
  --remote <name>                 Git remote. Defaults to github.
  --branch <name>                 Branch to push in cut mode. Defaults to current branch.
  --allow-dirty                   Pass through to orchestrator preflight.
  --allow-existing-tag            Incident mode only.
  --offline                       Skip remote checks/readback where supported.
  --expected-online-latest <v>    Require smoke cleanup online latest version.
  --run-url <url>                 GitHub Actions run URL recorded in reports.
  --skip-downloads                In publish mode, skip download package publishing.
  --skip-updater                  In publish mode, skip latest.json publishing.
  --skip-gitee                    In publish mode, skip Gitee release publishing.
  -h, --help                      Show this help.

Common examples:
  bun run release:desktop:one-click -- cut --version 0.2.5 --execute
  bun run release:desktop:one-click -- smoke-templates --version 0.2.5 --previous-version 0.2.4
  bun run release:desktop:one-click -- publish --version 0.2.5 --previous-version 0.2.4 --publish
  bun run release:desktop:one-click -- metadata-fix --version 0.2.4 --publish`)
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Version must be x.y.z: ${version}`)
  }
  return normalized
}

function readAppVersion(): string {
  const config = JSON.parse(
    readFileSync(join(desktopDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as { version?: string }
  if (!config.version) {
    throw new Error('Could not read desktop app version')
  }
  return normalizeVersion(config.version)
}

function parseArgs(argv: string[]): Options {
  let mode: Mode | null = null
  let version: string | null = null
  const options = {
    allowDirty: false,
    allowExistingTag: false,
    branch: null as string | null,
    execute: false,
    expectedOnlineLatest: null as string | null,
    offline: false,
    previousVersion: null as string | null,
    publish: false,
    remote: 'github',
    runUrl: null as string | null,
    skipDownloads: false,
    skipGitee: false,
    skipUpdater: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '-h' || arg === '--help') {
      usage()
      process.exit(0)
    }

    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      index += 1
      return value
    }

    if (!arg.startsWith('--')) {
      if (mode) throw new Error(`Unexpected positional argument: ${arg}`)
      if (!['cut', 'publish', 'downloads', 'updater', 'metadata-fix', 'smoke-templates', 'plan'].includes(arg)) {
        throw new Error(`Unknown mode: ${arg}`)
      }
      mode = arg as Mode
      continue
    }

    switch (arg) {
      case '--allow-dirty':
        options.allowDirty = true
        break
      case '--allow-existing-tag':
        options.allowExistingTag = true
        break
      case '--branch':
        options.branch = readValue()
        break
      case '--execute':
        options.execute = true
        break
      case '--expected-online-latest':
        options.expectedOnlineLatest = normalizeVersion(readValue())
        break
      case '--offline':
        options.offline = true
        break
      case '--previous-version':
        options.previousVersion = normalizeVersion(readValue())
        break
      case '--publish':
        options.publish = true
        break
      case '--remote':
        options.remote = readValue()
        break
      case '--run-url':
        options.runUrl = readValue()
        break
      case '--skip-downloads':
        options.skipDownloads = true
        break
      case '--skip-gitee':
        options.skipGitee = true
        break
      case '--skip-updater':
        options.skipUpdater = true
        break
      case '--version':
        version = normalizeVersion(readValue())
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return {
    ...options,
    mode: mode ?? 'plan',
    version: version ?? readAppVersion(),
  }
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function printCommand(cmd: string[]) {
  console.log(`$ ${cmd.map(quoteArg).join(' ')}`)
}

async function run(cmd: string[]) {
  printCommand(cmd)
  const proc = Bun.spawn(cmd, {
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`Command failed with exit code ${code}: ${cmd.map(quoteArg).join(' ')}`)
  }
}

function orchestratorArgs(options: Options, phase: string, extra: string[] = []): string[] {
  const args = [
    'bun',
    'run',
    'scripts/desktop-release-orchestrator.ts',
    phase,
    '--version',
    options.version,
    '--remote',
    options.remote,
  ]

  if (options.previousVersion) args.push('--previous-version', options.previousVersion)
  if (options.branch) args.push('--branch', options.branch)
  if (options.allowDirty) args.push('--allow-dirty')
  if (options.allowExistingTag) args.push('--allow-existing-tag')
  if (options.offline) args.push('--offline')
  if (options.expectedOnlineLatest) args.push('--expected-online-latest', options.expectedOnlineLatest)
  if (options.runUrl) args.push('--run-url', options.runUrl)
  args.push(...extra)
  return args
}

function requirePreviousVersion(options: Options, mode: string) {
  if (!options.previousVersion) {
    throw new Error(`${mode} requires --previous-version so upgrade smoke receipts can be checked`)
  }
}

function printSafety(options: Options) {
  console.log(`[one-click] mode=${options.mode} version=${options.version}`)
  console.log(`[one-click] execute=${options.execute ? 'yes' : 'no'} publish=${options.publish ? 'yes' : 'no'}`)
  if (!options.execute && options.mode === 'cut') {
    console.log('[one-click] cut mode is dry-run. Add --execute to create/push release refs.')
  }
  if (!options.publish && ['publish', 'downloads', 'updater', 'metadata-fix'].includes(options.mode)) {
    console.log('[one-click] publish mode is dry-run. Add --publish to write OSS/Gitee resources.')
  }
}

async function generateReleaseJson(options: Options) {
  await run([
    'bun',
    'run',
    'scripts/generate-release-json.ts',
    '--version',
    options.version,
    '--latest-alias',
  ])
}

async function mergeUpdaterLatest(options: Options) {
  await run([
    'bun',
    'run',
    'desktop/scripts/merge-updater-latest.ts',
    '--version',
    options.version,
  ])
}

async function runCut(options: Options) {
  await run(orchestratorArgs(options, 'preflight'))
  await run(orchestratorArgs(options, 'prepare', options.execute ? ['--execute'] : []))
  await run(orchestratorArgs(options, 'ci', options.execute ? ['--execute'] : []))
}

async function runDownloads(options: Options) {
  await generateReleaseJson(options)
  await run(orchestratorArgs(options, 'publish-downloads', options.publish ? ['--publish'] : []))
}

async function runUpdater(options: Options) {
  requirePreviousVersion(options, 'updater mode')
  await mergeUpdaterLatest(options)
  await run(orchestratorArgs(options, 'publish-updater', options.publish ? ['--publish'] : []))
}

async function runPublish(options: Options) {
  if (!options.skipUpdater) requirePreviousVersion(options, 'publish mode')

  if (!options.skipDownloads) {
    await runDownloads(options)
  }

  if (!options.skipUpdater) {
    await runUpdater(options)
  }

  if (!options.skipGitee) {
    await run(orchestratorArgs(options, 'publish-gitee', options.publish ? ['--publish'] : []))
  }
}

async function backupOnlineLatest(options: Options) {
  if (!options.publish || options.offline) return

  const url = new URL('latest.json', publicBaseUrl).toString()
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to backup online latest.json: HTTP ${response.status}`)
  }

  const backupDir = join(repoRoot, 'secrets', 'oss-backups')
  mkdirSync(backupDir, { recursive: true })
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
  const backupPath = join(backupDir, `latest-before-metadata-fix-v${options.version}-${timestamp}.json`)
  writeFileSync(backupPath, `${await response.text()}\n`)
  console.log(`[one-click] Backed up online latest.json to ${backupPath}`)
}

async function runMetadataFix(options: Options) {
  await mergeUpdaterLatest(options)
  await run(orchestratorArgs(options, 'check', ['--skip-smoke', '--skip-cleanup-evidence']))
  await backupOnlineLatest(options)

  const args = [
    'bun',
    'run',
    'scripts/upload-release-oss.ts',
    '--version',
    options.version,
    '--only-updater-metadata',
  ]
  if (options.publish) args.push('--publish')
  await run(args)
}

async function runSmokeTemplates(options: Options) {
  requirePreviousVersion(options, 'smoke-templates mode')
  for (const platform of ['windows', 'macos']) {
    await run([
      'bun',
      'run',
      'scripts/desktop-release-smoke-receipt.ts',
      'template',
      '--platform',
      platform,
      '--version',
      options.version,
      '--previous-version',
      options.previousVersion!,
    ])
  }
}

function printPlan(options: Options) {
  console.log('')
  console.log('Suggested release flow:')
  console.log(`  bun run release:desktop:one-click -- cut --version ${options.version}`)
  console.log(`  bun run release:desktop:one-click -- cut --version ${options.version} --execute`)
  console.log(`  bun run release:desktop:one-click -- smoke-templates --version ${options.version} --previous-version <old-version>`)
  console.log(`  bun run release:desktop:one-click -- publish --version ${options.version} --previous-version <old-version>`)
  console.log(`  bun run release:desktop:one-click -- publish --version ${options.version} --previous-version <old-version> --publish`)
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    printSafety(options)

    switch (options.mode) {
      case 'cut':
        await runCut(options)
        break
      case 'publish':
        await runPublish(options)
        break
      case 'downloads':
        await runDownloads(options)
        break
      case 'updater':
        await runUpdater(options)
        break
      case 'metadata-fix':
        await runMetadataFix(options)
        break
      case 'smoke-templates':
        await runSmokeTemplates(options)
        break
      case 'plan':
        printPlan(options)
        break
    }
  } catch (error) {
    console.error(`[one-click] ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

await main()

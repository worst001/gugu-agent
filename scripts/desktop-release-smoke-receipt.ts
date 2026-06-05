#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Platform = 'windows' | 'macos'
type Command = 'template' | 'validate'

type Options = {
  command: Command
  expectedOnlineLatest: string | null
  output: string | null
  path: string | null
  platform: Platform | null
  previousVersion: string | null
  version: string
}

type Receipt = {
  platform?: string
  version?: string
  previousVersion?: string
  status?: string
  upgrade?: {
    passed?: boolean
    from?: string
    to?: string
  }
  checks?: Record<string, boolean>
  cleanup?: {
    hostsRestored?: boolean
    stagingServerStopped?: boolean
    tempCertRemoved?: boolean
    onlineLatestVersion?: string
  }
  evidence?: Record<string, unknown>
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')

function usage() {
  console.log(`Create or validate desktop release smoke receipts.

Usage:
  bun run scripts/desktop-release-smoke-receipt.ts template --platform <windows|macos> --version <x.y.z> --previous-version <x.y.z>
  bun run scripts/desktop-release-smoke-receipt.ts validate --path <receipt.json> --version <x.y.z> [--previous-version <x.y.z>]

Options:
  --platform <windows|macos>       Platform for template generation.
  --version <x.y.z>                Target version. Defaults to desktop/src-tauri/tauri.conf.json.
  --previous-version <x.y.z>       Old public version used for upgrade smoke.
  --output <path>                  Template output path.
  --path <path>                    Receipt path for validation.
  --expected-online-latest <x.y.z> Require cleanup.onlineLatestVersion to match.
  -h, --help                       Show this help.

Default template path:
  desktop/build-artifacts/release-smoke/<platform>-vX.Y.Z.json`)
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Version must be x.y.z: ${version}`)
  }
  return normalized
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as T
}

function readAppVersion(): string {
  const configPath = join(desktopDir, 'src-tauri', 'tauri.conf.json')
  const config = readJsonFile<{ version?: string }>(configPath)
  if (!config.version) {
    throw new Error(`Could not read app version from ${configPath}`)
  }
  return normalizeVersion(config.version)
}

function parseArgs(argv: string[]): Options {
  let command: Command | null = null
  let expectedOnlineLatest: string | null = null
  let output: string | null = null
  let path: string | null = null
  let platform: Platform | null = null
  let previousVersion: string | null = null
  let version: string | null = null

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
      if (command) throw new Error(`Unexpected positional argument: ${arg}`)
      if (arg !== 'template' && arg !== 'validate') throw new Error(`Unknown command: ${arg}`)
      command = arg
      continue
    }

    switch (arg) {
      case '--expected-online-latest':
        expectedOnlineLatest = normalizeVersion(readValue())
        break
      case '--output':
        output = resolvePath(readValue())
        break
      case '--path':
        path = resolvePath(readValue())
        break
      case '--platform': {
        const value = readValue()
        if (value !== 'windows' && value !== 'macos') {
          throw new Error(`--platform must be windows or macos: ${value}`)
        }
        platform = value
        break
      }
      case '--previous-version':
        previousVersion = normalizeVersion(readValue())
        break
      case '--version':
        version = normalizeVersion(readValue())
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!command) throw new Error('Missing command. Run with --help for usage.')

  return {
    command,
    expectedOnlineLatest,
    output,
    path,
    platform,
    previousVersion,
    version: version ?? readAppVersion(),
  }
}

function defaultPath(platform: Platform, version: string): string {
  return join(desktopDir, 'build-artifacts', 'release-smoke', `${platform}-v${version}.json`)
}

function templateReceipt(platform: Platform, version: string, previousVersion: string | null): Receipt {
  const commonChecks = {
    appVersionOk: false,
    sidecarOk: false,
  }
  const platformChecks = platform === 'windows'
    ? {
        mainExeExists: false,
        noInstallerWarnings: false,
        shortcutTargetsValid: false,
      }
    : {
        appRelaunchOk: false,
        codesignStrict: false,
      }

  return {
    platform,
    version,
    previousVersion: previousVersion ?? '',
    status: 'pending',
    upgrade: {
      passed: false,
      from: previousVersion ?? '',
      to: version,
    },
    checks: {
      ...commonChecks,
      ...platformChecks,
    },
    cleanup: {
      hostsRestored: false,
      stagingServerStopped: false,
      tempCertRemoved: false,
      onlineLatestVersion: '',
    },
    evidence: {
      tester: '',
      testedAt: '',
      machine: '',
      notes: '',
    },
  }
}

function writeTemplate(options: Options) {
  if (!options.platform) throw new Error('template requires --platform')
  const outputPath = options.output ?? defaultPath(options.platform, options.version)
  const receipt = templateReceipt(options.platform, options.version, options.previousVersion)

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`[desktop-release-smoke-receipt] Wrote ${outputPath}`)
}

function getValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, source)
}

function requireTrue(failures: string[], receipt: Receipt, path: string, label: string) {
  if (getValue(receipt, path) !== true) {
    failures.push(`${label} must be true (${path})`)
  }
}

function validateReceipt(options: Options) {
  if (!options.path) throw new Error('validate requires --path')
  if (!existsSync(options.path)) throw new Error(`Receipt does not exist: ${options.path}`)

  const receipt = readJsonFile<Receipt>(options.path)
  const failures: string[] = []
  const platform = receipt.platform

  if (platform !== 'windows' && platform !== 'macos') {
    failures.push('platform must be windows or macos')
  }
  if (receipt.version !== options.version) {
    failures.push(`version must be ${options.version}`)
  }
  if (options.previousVersion && receipt.previousVersion !== options.previousVersion) {
    failures.push(`previousVersion must be ${options.previousVersion}`)
  }
  if (receipt.status !== 'passed') {
    failures.push('status must be passed')
  }

  requireTrue(failures, receipt, 'upgrade.passed', 'old-version upgrade')
  requireTrue(failures, receipt, 'checks.appVersionOk', 'app version check')
  requireTrue(failures, receipt, 'checks.sidecarOk', 'sidecar check')
  requireTrue(failures, receipt, 'cleanup.hostsRestored', 'hosts cleanup')
  requireTrue(failures, receipt, 'cleanup.stagingServerStopped', 'staging server cleanup')
  requireTrue(failures, receipt, 'cleanup.tempCertRemoved', 'temporary certificate cleanup')

  if (platform === 'windows') {
    requireTrue(failures, receipt, 'checks.mainExeExists', 'Windows main exe check')
    requireTrue(failures, receipt, 'checks.shortcutTargetsValid', 'Windows shortcut target check')
    requireTrue(failures, receipt, 'checks.noInstallerWarnings', 'Windows installer warning check')
  }
  if (platform === 'macos') {
    requireTrue(failures, receipt, 'checks.codesignStrict', 'macOS strict codesign check')
    requireTrue(failures, receipt, 'checks.appRelaunchOk', 'macOS relaunch check')
  }

  const onlineLatestVersion = receipt.cleanup?.onlineLatestVersion
  if (!onlineLatestVersion) {
    failures.push('cleanup.onlineLatestVersion must be recorded')
  }
  if (options.expectedOnlineLatest && onlineLatestVersion !== options.expectedOnlineLatest) {
    failures.push(`cleanup.onlineLatestVersion must be ${options.expectedOnlineLatest}`)
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL ${failure}`)
    }
    throw new Error(`${failures.length} smoke receipt validation failure(s).`)
  }

  console.log(`[desktop-release-smoke-receipt] OK ${options.path}`)
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'template') {
      writeTemplate(options)
    } else {
      validateReceipt(options)
    }
  } catch (error) {
    console.error(`[desktop-release-smoke-receipt] ERROR: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()

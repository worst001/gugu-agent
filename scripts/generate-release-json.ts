#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type PlatformName = 'windows' | 'macos'

type PlatformOptions = {
  artifact: string | null
  url: string | null
  sha256: string | null
}

type Options = {
  baseUrl: string
  latestAlias: boolean
  output: string
  publishedAt: string
  version: string
  windows: PlatformOptions
  macos: PlatformOptions
}

type ReleasePlatform = {
  url: string
  sha256: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')
const defaultBaseUrl = 'https://gxy-download.oss-cn-shanghai.aliyuncs.com/'

function usage() {
  console.log(`Generate release.json for the Gugu Agent download page.

Usage:
  bun run scripts/generate-release-json.ts [options]

Options:
  --version <version>             App version. Defaults to desktop/src-tauri/tauri.conf.json.
  --base-url <url>                Public download base URL. Defaults to ${defaultBaseUrl}
  --latest-alias                  Use Gugu-Agent-latest-* URLs instead of versioned URLs.
  --output <path>                 Output path. Defaults to desktop/build-artifacts/release.json.
  --published-at <rfc3339>        Published time. Defaults to now.
  --windows-artifact <path>       Windows MSI artifact path. Defaults to canonical build-artifacts path if present.
  --macos-artifact <path>         macOS DMG artifact path. Defaults to canonical build-artifacts path if present.
  --windows-url <url>             Public Windows MSI URL.
  --macos-url <url>               Public macOS DMG URL.
  --windows-sha256 <sha256>       Windows MSI SHA256 when artifact is not available locally.
  --macos-sha256 <sha256>         macOS DMG SHA256 when artifact is not available locally.
  -h, --help                      Show this help.

Examples:
  bun run scripts/generate-release-json.ts --windows-artifact desktop/build-artifacts/windows-x64/Gugu-Agent-0.1.14-windows-x64.msi --macos-sha256 <sha256>
  bun run scripts/generate-release-json.ts --version 0.1.15 --latest-alias --windows-sha256 <sha256> --macos-sha256 <sha256>`)
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function readAppVersion(): string {
  const configPath = join(desktopDir, 'src-tauri', 'tauri.conf.json')
  const config = readJsonFile<{ version?: string }>(configPath)
  if (!config.version) {
    throw new Error(`Could not read app version from ${configPath}`)
  }
  return normalizeVersion(config.version)
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '')
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
}

function parseArgs(argv: string[]): Options {
  const version = readAppVersion()
  const options: Options = {
    baseUrl: defaultBaseUrl,
    latestAlias: false,
    output: join(desktopDir, 'build-artifacts', 'release.json'),
    publishedAt: new Date().toISOString(),
    version,
    windows: {
      artifact: defaultArtifactPath('windows', version),
      url: null,
      sha256: null,
    },
    macos: {
      artifact: defaultArtifactPath('macos', version),
      url: null,
      sha256: null,
    },
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

    switch (arg) {
      case '--version':
        options.version = normalizeVersion(readValue())
        options.windows.artifact = defaultArtifactPath('windows', options.version)
        options.macos.artifact = defaultArtifactPath('macos', options.version)
        break
      case '--base-url':
        options.baseUrl = normalizeBaseUrl(readValue())
        break
      case '--latest-alias':
        options.latestAlias = true
        break
      case '--output':
        options.output = resolvePath(readValue())
        break
      case '--published-at':
        options.publishedAt = readValue()
        assertDate(options.publishedAt, '--published-at')
        break
      case '--windows-artifact':
        options.windows.artifact = resolvePath(readValue())
        break
      case '--macos-artifact':
        options.macos.artifact = resolvePath(readValue())
        break
      case '--windows-url':
        options.windows.url = normalizeUrl(readValue())
        break
      case '--macos-url':
        options.macos.url = normalizeUrl(readValue())
        break
      case '--windows-sha256':
        options.windows.sha256 = normalizeSha256(readValue(), '--windows-sha256')
        break
      case '--macos-sha256':
        options.macos.sha256 = normalizeSha256(readValue(), '--macos-sha256')
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl)
  return options
}

function defaultArtifactPath(platform: PlatformName, version: string): string {
  if (platform === 'windows') {
    return join(desktopDir, 'build-artifacts', 'windows-x64', `Gugu-Agent-${version}-windows-x64.msi`)
  }
  return join(desktopDir, 'build-artifacts', 'macos-arm64', `Gugu-Agent-${version}-aarch64.dmg`)
}

function canonicalFileName(platform: PlatformName, version: string, latestAlias: boolean): string {
  if (platform === 'windows') {
    return latestAlias
      ? 'Gugu-Agent-latest-windows-x64.msi'
      : `Gugu-Agent-${version}-windows-x64.msi`
  }
  return latestAlias
    ? 'Gugu-Agent-latest-aarch64.dmg'
    : `Gugu-Agent-${version}-aarch64.dmg`
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(normalized).toString()
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Download URL must be http or https: ${url}`)
  }
  return parsed.toString()
}

function normalizeSha256(sha256: string, label: string): string {
  const normalized = sha256.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character hex SHA256`)
  }
  return normalized
}

function assertDate(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid RFC3339 date: ${value}`)
  }
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function buildPlatform(
  platform: PlatformName,
  version: string,
  options: Options,
): ReleasePlatform | null {
  const platformOptions = options[platform]
  const artifact = platformOptions.artifact
  const artifactExists = Boolean(artifact && existsSync(artifact) && statSync(artifact).isFile())
  const sha256 = artifactExists
    ? sha256File(artifact!)
    : platformOptions.sha256

  if (!sha256) {
    console.warn(`[generate-release-json] Skipping ${platform}: missing artifact or SHA256`)
    return null
  }

  const publicFileName = options.latestAlias
    ? canonicalFileName(platform, version, true)
    : artifactExists
      ? basename(artifact!)
      : canonicalFileName(platform, version, false)
  const url = platformOptions.url ?? new URL(publicFileName, options.baseUrl).toString()

  return { url, sha256 }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const windows = buildPlatform('windows', options.version, options)
    const macos = buildPlatform('macos', options.version, options)

    if (!windows && !macos) {
      throw new Error('No platform metadata generated. Provide artifacts or SHA256 values.')
    }

    const release = {
      version: options.version,
      ...(windows ? { windows } : {}),
      ...(macos ? { macos } : {}),
      publishedAt: options.publishedAt,
    }

    mkdirSync(dirname(options.output), { recursive: true })
    writeFileSync(options.output, `${JSON.stringify(release, null, 2)}\n`)

    console.log(`[generate-release-json] Wrote ${options.output}`)
    if (windows) console.log(`[generate-release-json] Windows: ${windows.url}`)
    if (macos) console.log(`[generate-release-json] macOS:   ${macos.url}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[generate-release-json] ERROR: ${message}`)
    process.exit(1)
  }
}

main()

#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type PlatformEntry = {
  url: string
  signature: string
}

type ReleaseManifest = {
  version?: string
  name?: string
  notes?: string
  pub_date?: string
  platforms?: Record<string, PlatformEntry>
  url?: string
  signature?: string
}

type Options = {
  artifactDirs: string[]
  baseUrl: string
  output: string
  notesFile: string | null
  pubDate: string | null
  requiredPlatforms: string[]
  version: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopDir = resolve(scriptDir, '..')
const repoRoot = resolve(desktopDir, '..')
const defaultBaseUrl = 'https://gxy-download.oss-cn-shanghai.aliyuncs.com/'

function usage() {
  console.log(`Merge signed Tauri updater manifests into the OSS latest.json.

Usage:
  bun run ./scripts/merge-updater-latest.ts [options]

Options:
  --version <version>             App version. Defaults to desktop/src-tauri/tauri.conf.json.
  --base-url <url>                Public artifact base URL. Defaults to ${defaultBaseUrl}
  --output <path>                 Output latest.json. Defaults to desktop/build-artifacts/latest.json.
  --notes-file <path>             Release notes markdown. Defaults to release-notes/v<version>.md.
  --pub-date <rfc3339>            Release date. Defaults to input manifests, then now.
  --artifact-dir <path>           Artifact directory to read. Can be repeated.
  --require-platform <platform>   Required final platform key. Can be repeated.
  -h, --help                      Show this help.

Expected signed artifact directories:
  desktop/build-artifacts/windows-x64
  desktop/build-artifacts/macos-arm64`)
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
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

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path)
}

function parseArgs(argv: string[]): Options {
  const version = readAppVersion()
  let notesFileProvided = false
  const options: Options = {
    artifactDirs: [],
    baseUrl: defaultBaseUrl,
    output: join(desktopDir, 'build-artifacts', 'latest.json'),
    notesFile: join(repoRoot, 'release-notes', `v${version}.md`),
    pubDate: null,
    requiredPlatforms: [
      'darwin-aarch64-app',
      'darwin-aarch64',
      'windows-x86_64-msi',
      'windows-x86_64',
    ],
    version,
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
      case '--artifact-dir':
        options.artifactDirs.push(resolvePath(readValue()))
        break
      case '--base-url':
        options.baseUrl = readValue()
        break
      case '--notes-file':
        options.notesFile = resolvePath(readValue())
        notesFileProvided = true
        break
      case '--no-notes-file':
        options.notesFile = null
        notesFileProvided = true
        break
      case '--output':
        options.output = resolvePath(readValue())
        break
      case '--pub-date':
        options.pubDate = readValue()
        break
      case '--require-platform':
        options.requiredPlatforms.push(readValue())
        break
      case '--version':
        options.version = normalizeVersion(readValue())
        if (!notesFileProvided) {
          options.notesFile = join(repoRoot, 'release-notes', `v${options.version}.md`)
        }
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.artifactDirs.length === 0) {
    options.artifactDirs = [
      join(desktopDir, 'build-artifacts', 'windows-x64'),
      join(desktopDir, 'build-artifacts', 'macos-arm64'),
    ]
  }

  options.baseUrl = normalizeBaseUrl(options.baseUrl)
  return options
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(normalized).toString()
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
}

function findManifestPath(dir: string): string {
  const path = join(dir, 'latest.json')
  if (!existsSync(path)) {
    throw new Error(`Missing latest.json in ${dir}`)
  }
  return path
}

function inferBasePlatform(platform: string): string | null {
  if (platform.startsWith('darwin-aarch64')) return 'darwin-aarch64'
  if (platform.startsWith('windows-x86_64')) return 'windows-x86_64'
  return null
}

function inferBasePlatformFromDir(dir: string): string | null {
  const name = basename(dir).toLowerCase()
  if (name.includes('macos') || name.includes('darwin')) return 'darwin-aarch64'
  if (name.includes('windows') || name.includes('win')) return 'windows-x86_64'
  return null
}

function aliasesForPlatform(platform: string, basePlatform: string): string[] {
  const aliases = [platform]

  if (basePlatform === 'darwin-aarch64') {
    aliases.push('darwin-aarch64-app', 'darwin-aarch64')
  }

  if (basePlatform === 'windows-x86_64') {
    aliases.push('windows-x86_64-msi', 'windows-x86_64')
  }

  return [...new Set(aliases)]
}

function fileNameFromUrl(url: string | undefined): string | null {
  if (!url) return null

  try {
    return basename(decodeURIComponent(new URL(url).pathname))
  } catch {
    return basename(url)
  }
}

function findByExactName(files: string[], name: string | null): string | null {
  if (!name) return null
  return files.find((file) => basename(file) === name) ?? null
}

function findByPredicate(files: string[], predicate: (name: string) => boolean): string | null {
  const matches = files
    .filter((file) => predicate(basename(file)))
    .sort((a, b) => basename(a).localeCompare(basename(b)))
  return matches.at(-1) ?? null
}

function selectUpdaterArtifact(
  dir: string,
  files: string[],
  version: string,
  platform: string,
  entry: PlatformEntry
): string {
  const basePlatform = inferBasePlatform(platform)
  const originalName = fileNameFromUrl(entry.url)
  const exact = findByExactName(files, originalName)

  if (exact) return exact

  if (basePlatform === 'darwin-aarch64') {
    const canonical = `Gugu-Agent-${version}-darwin-aarch64.app.tar.gz`
    return (
      findByExactName(files, canonical) ??
      findByPredicate(
        files,
        (name) => name.includes(version) && name.endsWith('.app.tar.gz')
      ) ??
      fail(`Could not find macOS updater archive for ${platform} in ${dir}`)
    )
  }

  if (basePlatform === 'windows-x86_64') {
    const originalWantsRawMsi = originalName?.endsWith('.msi') && !originalName.endsWith('.msi.zip')
    const canonical = originalWantsRawMsi
      ? `Gugu-Agent-${version}-windows-x64.msi`
      : `Gugu-Agent-${version}-windows-x64.msi.zip`
    const fallbackSuffix = originalWantsRawMsi ? '.msi' : '.msi.zip'

    return (
      findByExactName(files, canonical) ??
      findByPredicate(files, (name) => name.includes(version) && name.endsWith(fallbackSuffix)) ??
      fail(`Could not find Windows updater archive for ${platform} in ${dir}`)
    )
  }

  throw new Error(`Unsupported updater platform: ${platform}`)
}

function selectSignatureFile(files: string[], artifactPath: string): string {
  const artifactName = basename(artifactPath)
  const exact = findByExactName(files, `${artifactName}.sig`)
  if (exact) return exact

  throw new Error(`Missing signature file for ${artifactName}`)
}

function assertSignatureMatches(signaturePath: string, signature: string) {
  const signatureFromFile = readFileSync(signaturePath, 'utf8').trim()
  if (!signatureFromFile) {
    throw new Error(`Signature file is empty: ${signaturePath}`)
  }

  if (signatureFromFile !== signature.trim()) {
    throw new Error(`Signature mismatch between ${signaturePath} and latest.json`)
  }
}

function publicArtifactUrl(baseUrl: string, artifactPath: string): string {
  return new URL(basename(artifactPath), baseUrl).toString()
}

function manifestVersion(manifest: ReleaseManifest): string | null {
  const version = manifest.version ?? manifest.name
  return version ? normalizeVersion(version) : null
}

function platformEntries(
  manifest: ReleaseManifest,
  dir: string
): Array<[string, PlatformEntry]> {
  if (manifest.platforms) {
    return Object.entries(manifest.platforms)
  }

  if (manifest.url && manifest.signature) {
    const basePlatform = inferBasePlatformFromDir(dir)
    if (!basePlatform) {
      throw new Error(`Dynamic latest.json in ${dir} needs a platform-shaped directory name`)
    }
    return [[basePlatform, { url: manifest.url, signature: manifest.signature }]]
  }

  throw new Error(`latest.json in ${dir} has neither platforms nor dynamic url/signature`)
}

function preferredPlatformOrder(key: string): number {
  const order = [
    'darwin-aarch64-app',
    'darwin-aarch64',
    'windows-x86_64-msi',
    'windows-x86_64',
  ]
  const index = order.indexOf(key)
  return index === -1 ? order.length : index
}

function sortPlatforms(platforms: Record<string, PlatformEntry>): Record<string, PlatformEntry> {
  return Object.fromEntries(
    Object.entries(platforms).sort(([left], [right]) => {
      const byPreferredOrder = preferredPlatformOrder(left) - preferredPlatformOrder(right)
      return byPreferredOrder === 0 ? left.localeCompare(right) : byPreferredOrder
    })
  )
}

function fail(message: string): never {
  throw new Error(message)
}

function readNotes(options: Options, manifests: ReleaseManifest[]): string | undefined {
  if (options.notesFile && existsSync(options.notesFile)) {
    return readFileSync(options.notesFile, 'utf8')
  }

  return manifests.find((manifest) => manifest.notes)?.notes
}

function readPubDate(options: Options, manifests: ReleaseManifest[]): string {
  if (options.pubDate) {
    assertRfc3339(options.pubDate, '--pub-date')
    return options.pubDate
  }

  const pubDates = manifests
    .map((manifest) => manifest.pub_date)
    .filter((date): date is string => Boolean(date))

  for (const pubDate of pubDates) {
    assertRfc3339(pubDate, 'input pub_date')
  }

  return pubDates.sort().at(-1) ?? new Date().toISOString()
}

function assertRfc3339(value: string, label: string) {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a valid RFC3339 date: ${value}`)
  }
}

function mergeManifests(options: Options) {
  const manifests: ReleaseManifest[] = []
  const platforms: Record<string, PlatformEntry> = {}
  const uploadArtifacts = new Set<string>()

  for (const dir of options.artifactDirs) {
    const manifestPath = findManifestPath(dir)
    const manifest = readJsonFile<ReleaseManifest>(manifestPath)
    const version = manifestVersion(manifest)

    if (version !== options.version) {
      throw new Error(
        `Version mismatch in ${manifestPath}: expected ${options.version}, got ${version ?? 'missing'}`
      )
    }

    manifests.push(manifest)
    const files = listFiles(dir)

    for (const [platform, entry] of platformEntries(manifest, dir)) {
      if (!entry.url || !entry.signature) {
        throw new Error(`Platform ${platform} in ${manifestPath} is missing url or signature`)
      }

      const basePlatform = inferBasePlatform(platform)
      if (!basePlatform) {
        throw new Error(`Unsupported platform key in ${manifestPath}: ${platform}`)
      }

      const artifactPath = selectUpdaterArtifact(dir, files, options.version, platform, entry)
      const signaturePath = selectSignatureFile(files, artifactPath)
      assertSignatureMatches(signaturePath, entry.signature)

      const nextEntry = {
        url: publicArtifactUrl(options.baseUrl, artifactPath),
        signature: entry.signature.trim(),
      }

      for (const alias of aliasesForPlatform(platform, basePlatform)) {
        const existing = platforms[alias]
        if (existing && (existing.url !== nextEntry.url || existing.signature !== nextEntry.signature)) {
          throw new Error(`Conflicting updater data for platform ${alias}`)
        }
        platforms[alias] = nextEntry
      }

      uploadArtifacts.add(basename(artifactPath))
      uploadArtifacts.add(basename(signaturePath))
    }
  }

  for (const platform of options.requiredPlatforms) {
    if (!platforms[platform]) {
      throw new Error(`Missing required updater platform in merged latest.json: ${platform}`)
    }
  }

  const output = {
    version: options.version,
    notes: readNotes(options, manifests),
    pub_date: readPubDate(options, manifests),
    platforms: sortPlatforms(platforms),
  }

  return { output, uploadArtifacts: [...uploadArtifacts].sort() }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    const { output, uploadArtifacts } = mergeManifests(options)

    mkdirSync(dirname(options.output), { recursive: true })
    writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`)

    console.log(`[merge-updater-latest] Wrote ${options.output}`)
    console.log('[merge-updater-latest] Upload these updater files to OSS:')
    for (const artifact of uploadArtifacts) {
      console.log(`  - ${artifact}`)
    }
    console.log('  - latest.json')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[merge-updater-latest] ERROR: ${message}`)
    process.exit(1)
  }
}

main()

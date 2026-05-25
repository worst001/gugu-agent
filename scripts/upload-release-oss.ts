#!/usr/bin/env bun

import { createHash, createHmac } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

type PlatformName = 'windows' | 'macos'

type PlatformArtifact = {
  fileName: string
  latestAlias: string
  path: string
}

type UploadItem = {
  cacheControl: string
  contentType: string
  description: string
  objectKey: string
  sourcePath: string
}

type Options = {
  accessKeyId: string
  accessKeySecret: string
  acl: string | null
  allowPartial: boolean
  baseUrl: string
  bucket: string
  endpoint: string
  includeUpdater: boolean
  latestJson: string
  objectPrefix: string
  publish: boolean
  releaseJson: string
  requireUpdater: boolean
  securityToken: string
  skipReleaseNotesCheck: boolean
  version: string
  windowsArtifact: string
  macosArtifact: string
}

type ReleaseJson = {
  version: string
  windows?: { url: string; sha256: string }
  macos?: { url: string; sha256: string }
  publishedAt: string
}

type UpdaterManifest = {
  platforms?: Record<string, { url?: string; signature?: string }>
  url?: string
  signature?: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')
const defaultBucket = 'gxy-download'
const defaultEndpoint = 'https://oss-cn-shanghai.aliyuncs.com'
const defaultBaseUrl = 'https://gxy-download.oss-cn-shanghai.aliyuncs.com/'

function usage() {
  console.log(`Upload Gugu Agent desktop release artifacts to Aliyun OSS.

Usage:
  bun run scripts/upload-release-oss.ts [options]

Safe by default:
  The script only prints an upload plan unless --publish is provided.

Options:
  --publish                       Upload to OSS. Without this flag, dry-run only.
  --version <version>             App version. Defaults to desktop/src-tauri/tauri.conf.json.
  --bucket <bucket>               OSS bucket. Defaults to ${defaultBucket}.
  --endpoint <url>                OSS region endpoint. Defaults to ${defaultEndpoint}.
  --base-url <url>                Public bucket URL. Defaults to ${defaultBaseUrl}
  --object-prefix <prefix>        Optional OSS object prefix, for example releases/.
  --windows-artifact <path>       Windows MSI path. Defaults to canonical build-artifacts path.
  --macos-artifact <path>         macOS DMG path. Defaults to canonical build-artifacts path.
  --release-json <path>           release.json output path. Defaults to desktop/build-artifacts/release.json.
  --latest-json <path>            latest.json path. Defaults to desktop/build-artifacts/latest.json.
  --include-updater               Upload latest.json and referenced updater artifacts when present. Default.
  --no-updater                    Skip latest.json and updater artifacts.
  --require-updater               Fail if latest.json or updater artifacts are missing.
  --allow-partial                 Allow uploading only one installer platform.
  --skip-release-notes-check      Do not require release-notes/v<version>.md.
  --acl <acl>                     Optional x-oss-object-acl value, for example public-read.
  -h, --help                      Show this help.

Environment for --publish:
  GUGU_OSS_ACCESS_KEY_ID          or ALIYUN_ACCESS_KEY_ID / OSS_ACCESS_KEY_ID
  GUGU_OSS_ACCESS_KEY_SECRET      or ALIYUN_ACCESS_KEY_SECRET / OSS_ACCESS_KEY_SECRET
  GUGU_OSS_SECURITY_TOKEN         optional STS token

Examples:
  bun run scripts/upload-release-oss.ts
  bun run scripts/upload-release-oss.ts --publish
  bun run scripts/upload-release-oss.ts --version 0.1.15 --require-updater --publish`)
}

function envFirst(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
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
  const normalized = version.trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Version must be x.y.z: ${version}`)
  }
  return normalized
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
}

function defaultInstallerPath(platform: PlatformName, version: string): string {
  if (platform === 'windows') {
    return join(desktopDir, 'build-artifacts', 'windows-x64', `Gugu-Agent-${version}-windows-x64.msi`)
  }
  return join(desktopDir, 'build-artifacts', 'macos-arm64', `Gugu-Agent-${version}-aarch64.dmg`)
}

function parseArgs(argv: string[]): Options {
  const version = readAppVersion()
  const options: Options = {
    accessKeyId: envFirst(['GUGU_OSS_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_ID']),
    accessKeySecret: envFirst(['GUGU_OSS_ACCESS_KEY_SECRET', 'ALIYUN_ACCESS_KEY_SECRET', 'OSS_ACCESS_KEY_SECRET']),
    acl: envFirst(['GUGU_OSS_ACL']) || null,
    allowPartial: false,
    baseUrl: envFirst(['GUGU_OSS_PUBLIC_BASE_URL', 'OSS_PUBLIC_BASE_URL']) || defaultBaseUrl,
    bucket: envFirst(['GUGU_OSS_BUCKET', 'ALIYUN_OSS_BUCKET', 'OSS_BUCKET']) || defaultBucket,
    endpoint: envFirst(['GUGU_OSS_ENDPOINT', 'ALIYUN_OSS_ENDPOINT', 'OSS_ENDPOINT']) || defaultEndpoint,
    includeUpdater: true,
    latestJson: join(desktopDir, 'build-artifacts', 'latest.json'),
    objectPrefix: envFirst(['GUGU_OSS_OBJECT_PREFIX', 'OSS_OBJECT_PREFIX']),
    publish: false,
    releaseJson: join(desktopDir, 'build-artifacts', 'release.json'),
    requireUpdater: false,
    securityToken: envFirst(['GUGU_OSS_SECURITY_TOKEN', 'ALIYUN_SECURITY_TOKEN', 'OSS_SECURITY_TOKEN']),
    skipReleaseNotesCheck: false,
    version,
    windowsArtifact: defaultInstallerPath('windows', version),
    macosArtifact: defaultInstallerPath('macos', version),
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
      case '--publish':
        options.publish = true
        break
      case '--dry-run':
        options.publish = false
        break
      case '--version':
        options.version = normalizeVersion(readValue())
        options.windowsArtifact = defaultInstallerPath('windows', options.version)
        options.macosArtifact = defaultInstallerPath('macos', options.version)
        break
      case '--bucket':
        options.bucket = readValue()
        break
      case '--endpoint':
        options.endpoint = readValue()
        break
      case '--base-url':
        options.baseUrl = readValue()
        break
      case '--object-prefix':
        options.objectPrefix = readValue()
        break
      case '--windows-artifact':
        options.windowsArtifact = resolvePath(readValue())
        break
      case '--macos-artifact':
        options.macosArtifact = resolvePath(readValue())
        break
      case '--release-json':
        options.releaseJson = resolvePath(readValue())
        break
      case '--latest-json':
        options.latestJson = resolvePath(readValue())
        break
      case '--include-updater':
        options.includeUpdater = true
        break
      case '--no-updater':
        options.includeUpdater = false
        break
      case '--require-updater':
        options.requireUpdater = true
        options.includeUpdater = true
        break
      case '--allow-partial':
        options.allowPartial = true
        break
      case '--skip-release-notes-check':
        options.skipReleaseNotesCheck = true
        break
      case '--acl':
        options.acl = readValue()
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  options.endpoint = normalizeEndpoint(options.endpoint)
  options.baseUrl = normalizeBaseUrl(options.baseUrl)
  options.objectPrefix = normalizeObjectPrefix(options.objectPrefix)
  return options
}

function normalizeEndpoint(endpoint: string): string {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`OSS endpoint must be http or https: ${endpoint}`)
  }
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(normalized).toString()
}

function normalizeObjectPrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return trimmed ? `${trimmed}/` : ''
}

function assertVersionFiles(options: Options) {
  const configVersion = readAppVersion()
  if (configVersion !== options.version) {
    throw new Error(`Version mismatch: tauri.conf.json is ${configVersion}, upload version is ${options.version}`)
  }

  if (!options.skipReleaseNotesCheck) {
    const releaseNotesPath = join(repoRoot, 'release-notes', `v${options.version}.md`)
    if (!existsSync(releaseNotesPath)) {
      throw new Error(`Missing release notes: ${releaseNotesPath}`)
    }
  }
}

function existingInstallerArtifacts(options: Options): Partial<Record<PlatformName, PlatformArtifact>> {
  const windows = installerArtifact('windows', options.windowsArtifact, options.version)
  const macos = installerArtifact('macos', options.macosArtifact, options.version)
  const artifacts: Partial<Record<PlatformName, PlatformArtifact>> = {}
  if (windows) artifacts.windows = windows
  if (macos) artifacts.macos = macos

  if (!options.allowPartial && (!artifacts.windows || !artifacts.macos)) {
    const missing = [
      artifacts.windows ? null : options.windowsArtifact,
      artifacts.macos ? null : options.macosArtifact,
    ].filter(Boolean)
    throw new Error(`Missing installer artifact(s): ${missing.join(', ')}`)
  }

  if (!artifacts.windows && !artifacts.macos) {
    throw new Error('No installer artifacts found.')
  }

  return artifacts
}

function installerArtifact(
  platform: PlatformName,
  filePath: string,
  version: string,
): PlatformArtifact | null {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null

  const fileName = basename(filePath)
  const expected = platform === 'windows'
    ? `Gugu-Agent-${version}-windows-x64.msi`
    : `Gugu-Agent-${version}-aarch64.dmg`
  if (fileName !== expected) {
    throw new Error(`Unexpected ${platform} artifact name: expected ${expected}, got ${fileName}`)
  }

  return {
    fileName,
    latestAlias: platform === 'windows'
      ? 'Gugu-Agent-latest-windows-x64.msi'
      : 'Gugu-Agent-latest-aarch64.dmg',
    path: filePath,
  }
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function publicUrl(options: Options, objectKey: string): string {
  return new URL(encodeObjectKey(objectKey), options.baseUrl).toString()
}

function objectKey(options: Options, name: string): string {
  return `${options.objectPrefix}${name}`
}

function buildReleaseJson(
  options: Options,
  artifacts: Partial<Record<PlatformName, PlatformArtifact>>,
): ReleaseJson {
  const release: ReleaseJson = {
    version: options.version,
    publishedAt: new Date().toISOString(),
  }

  if (artifacts.windows) {
    const key = objectKey(options, artifacts.windows.latestAlias)
    release.windows = {
      url: publicUrl(options, key),
      sha256: sha256File(artifacts.windows.path),
    }
  }

  if (artifacts.macos) {
    const key = objectKey(options, artifacts.macos.latestAlias)
    release.macos = {
      url: publicUrl(options, key),
      sha256: sha256File(artifacts.macos.path),
    }
  }

  mkdirSync(dirname(options.releaseJson), { recursive: true })
  writeFileSync(options.releaseJson, `${JSON.stringify(release, null, 2)}\n`)
  return release
}

function collectInstallerUploads(
  options: Options,
  artifacts: Partial<Record<PlatformName, PlatformArtifact>>,
): UploadItem[] {
  const uploads: UploadItem[] = []

  for (const artifact of Object.values(artifacts)) {
    if (!artifact) continue
    uploads.push({
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: contentTypeFor(artifact.fileName),
      description: 'versioned installer',
      objectKey: objectKey(options, artifact.fileName),
      sourcePath: artifact.path,
    })
    uploads.push({
      cacheControl: 'no-cache',
      contentType: contentTypeFor(artifact.latestAlias),
      description: 'latest installer alias',
      objectKey: objectKey(options, artifact.latestAlias),
      sourcePath: artifact.path,
    })
  }

  uploads.push({
    cacheControl: 'no-cache',
    contentType: 'application/json; charset=utf-8',
    description: 'download metadata',
    objectKey: objectKey(options, 'release.json'),
    sourcePath: options.releaseJson,
  })

  return uploads
}

function collectUpdaterUploads(options: Options): UploadItem[] {
  if (!options.includeUpdater) return []

  if (!existsSync(options.latestJson)) {
    if (options.requireUpdater) {
      throw new Error(`Missing updater latest.json: ${options.latestJson}`)
    }
    console.warn(`[upload-release-oss] Skipping updater uploads: ${options.latestJson} not found`)
    return []
  }

  const manifest = readJsonFile<UpdaterManifest>(options.latestJson)
  const searchDirs = [
    join(desktopDir, 'build-artifacts', 'windows-x64'),
    join(desktopDir, 'build-artifacts', 'macos-arm64'),
    dirname(options.latestJson),
  ]
  const uploads: UploadItem[] = [{
    cacheControl: 'no-cache',
    contentType: 'application/json; charset=utf-8',
    description: 'updater manifest',
    objectKey: objectKey(options, 'latest.json'),
    sourcePath: options.latestJson,
  }]

  for (const artifactName of updaterArtifactNames(manifest)) {
    const artifactPath = findFileByName(searchDirs, artifactName)
    if (!artifactPath) {
      if (options.requireUpdater) {
        throw new Error(`Missing updater artifact: ${artifactName}`)
      }
      console.warn(`[upload-release-oss] Skipping missing updater artifact: ${artifactName}`)
      continue
    }

    uploads.push({
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: contentTypeFor(artifactName),
      description: 'updater artifact',
      objectKey: objectKey(options, artifactName),
      sourcePath: artifactPath,
    })

    const signatureName = `${artifactName}.sig`
    const signaturePath = findFileByName(searchDirs, signatureName)
    if (!signaturePath) {
      if (options.requireUpdater) {
        throw new Error(`Missing updater signature: ${signatureName}`)
      }
      console.warn(`[upload-release-oss] Skipping missing updater signature: ${signatureName}`)
      continue
    }

    uploads.push({
      cacheControl: 'public, max-age=31536000, immutable',
      contentType: 'text/plain; charset=utf-8',
      description: 'updater signature',
      objectKey: objectKey(options, signatureName),
      sourcePath: signaturePath,
    })
  }

  return uploads
}

function updaterArtifactNames(manifest: UpdaterManifest): string[] {
  const urls = new Set<string>()

  if (manifest.url) urls.add(manifest.url)
  if (manifest.platforms) {
    for (const entry of Object.values(manifest.platforms)) {
      if (entry.url) urls.add(entry.url)
    }
  }

  return [...urls]
    .map((url) => {
      try {
        return basename(decodeURIComponent(new URL(url).pathname))
      } catch {
        return basename(url)
      }
    })
    .filter(Boolean)
}

function findFileByName(searchDirs: string[], fileName: string): string | null {
  for (const dir of [...new Set(searchDirs)]) {
    const found = findFileByNameRecursive(dir, fileName)
    if (found) return found
  }
  return null
}

function findFileByNameRecursive(dir: string, fileName: string): string | null {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)
    if (entry.isFile() && entry.name === fileName) return entryPath
    if (entry.isDirectory()) {
      const found = findFileByNameRecursive(entryPath, fileName)
      if (found) return found
    }
  }
  return null
}

function dedupeUploads(uploads: UploadItem[]): UploadItem[] {
  const byObjectKey = new Map<string, UploadItem>()
  for (const upload of uploads) {
    const existing = byObjectKey.get(upload.objectKey)
    if (existing) {
      if (existing.sourcePath !== upload.sourcePath) {
        throw new Error(`Conflicting uploads for ${upload.objectKey}`)
      }
      continue
    }
    byObjectKey.set(upload.objectKey, upload)
  }
  return [...byObjectKey.values()]
}

function contentTypeFor(fileName: string): string {
  if (fileName.endsWith('.tar.gz')) return 'application/gzip'
  if (fileName.endsWith('.msi')) return 'application/octet-stream'
  if (fileName.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8'
  if (fileName.endsWith('.sig')) return 'text/plain; charset=utf-8'

  switch (extname(fileName).toLowerCase()) {
    case '.zip':
      return 'application/zip'
    case '.gz':
      return 'application/gzip'
    case '.txt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

function uploadUrl(options: Options, key: string): string {
  const endpoint = new URL(options.endpoint)
  const host = endpoint.hostname.startsWith(`${options.bucket}.`)
    ? endpoint.host
    : `${options.bucket}.${endpoint.host}`
  return `${endpoint.protocol}//${host}/${encodeObjectKey(key)}`
}

async function putObject(options: Options, item: UploadItem) {
  if (!options.accessKeyId || !options.accessKeySecret) {
    throw new Error('Missing OSS credentials. Set GUGU_OSS_ACCESS_KEY_ID and GUGU_OSS_ACCESS_KEY_SECRET.')
  }

  const body = readFileSync(item.sourcePath)
  const date = new Date().toUTCString()
  const headers: Record<string, string> = {
    'Cache-Control': item.cacheControl,
    'Content-Type': item.contentType,
    Date: date,
  }

  if (options.acl) {
    headers['x-oss-object-acl'] = options.acl
  }
  if (options.securityToken) {
    headers['x-oss-security-token'] = options.securityToken
  }

  const canonicalizedOssHeaders = Object.entries(headers)
    .filter(([name]) => name.toLowerCase().startsWith('x-oss-'))
    .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
    .map(([name, value]) => `${name.toLowerCase()}:${value}\n`)
    .join('')
  const canonicalizedResource = `/${options.bucket}/${item.objectKey}`
  const stringToSign = [
    'PUT',
    '',
    item.contentType,
    date,
    `${canonicalizedOssHeaders}${canonicalizedResource}`,
  ].join('\n')
  const signature = createHmac('sha1', options.accessKeySecret)
    .update(stringToSign)
    .digest('base64')

  const response = await fetch(uploadUrl(options, item.objectKey), {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: `OSS ${options.accessKeyId}:${signature}`,
    },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OSS PUT ${item.objectKey} failed: HTTP ${response.status} ${text}`.trim())
  }
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${Math.round(mb * 10) / 10} MB`
  const kb = bytes / 1024
  if (kb >= 1) return `${Math.round(kb * 10) / 10} KB`
  return `${bytes} B`
}

function printPlan(options: Options, release: ReleaseJson, uploads: UploadItem[]) {
  console.log(`[upload-release-oss] Version: ${options.version}`)
  console.log(`[upload-release-oss] Mode: ${options.publish ? 'publish' : 'dry-run'}`)
  console.log(`[upload-release-oss] Bucket: ${options.bucket}`)
  console.log(`[upload-release-oss] Endpoint: ${options.endpoint}`)
  console.log(`[upload-release-oss] Public base URL: ${options.baseUrl}`)
  console.log(`[upload-release-oss] release.json: ${options.releaseJson}`)
  console.log(`[upload-release-oss] release.json version: ${release.version}`)
  if (release.windows) console.log(`[upload-release-oss] Windows SHA256: ${release.windows.sha256}`)
  if (release.macos) console.log(`[upload-release-oss] macOS SHA256:   ${release.macos.sha256}`)
  console.log('[upload-release-oss] Upload plan:')
  for (const item of uploads) {
    const size = formatBytes(statSync(item.sourcePath).size)
    console.log(`  - ${item.objectKey}`)
    console.log(`    from: ${item.sourcePath}`)
    console.log(`    kind: ${item.description}, size: ${size}, cache: ${item.cacheControl}`)
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    assertVersionFiles(options)
    const artifacts = existingInstallerArtifacts(options)
    const release = buildReleaseJson(options, artifacts)
    const uploads = dedupeUploads([
      ...collectInstallerUploads(options, artifacts),
      ...collectUpdaterUploads(options),
    ])

    printPlan(options, release, uploads)

    if (!options.publish) {
      console.log('[upload-release-oss] Dry-run complete. Add --publish to upload.')
      return
    }

    for (const item of uploads) {
      process.stdout.write(`[upload-release-oss] Uploading ${item.objectKey}... `)
      await putObject(options, item)
      console.log('ok')
    }
    console.log('[upload-release-oss] Done.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[upload-release-oss] ERROR: ${message}`)
    process.exit(1)
  }
}

main()

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

type InstallerArtifact = {
  description: string
  fileName: string
  path: string
  platform: PlatformName
  sha256: string
}

type AssetUpload = {
  description: string
  fileName: string
  path: string
  sha256: string
}

type ReleaseJson = {
  version: string
  windows?: { url: string; sha256: string }
  macos?: { url: string; sha256: string }
  publishedAt?: string
}

type GiteeRelease = {
  id: number
  tag_name?: string
  name?: string
  body?: string
  target_commitish?: string
  prerelease?: boolean
  assets?: GiteeAsset[]
}

type GiteeAsset = {
  id: number
  name?: string
  filename?: string
  browser_download_url?: string
  download_url?: string
}

type Options = {
  accessToken: string
  allowPartial: boolean
  apiBaseUrl: string
  bodyOutput: string
  giteeOwner: string
  giteeRepo: string
  includeAssets: boolean
  keepExistingAssets: boolean
  macosArtifact: string
  name: string
  notes: string
  prerelease: boolean
  publish: boolean
  releaseJson: string
  tag: string
  targetCommitish: string
  version: string
  windowsArtifact: string
  extraAssets: string[]
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')
const defaultApiBaseUrl = 'https://gitee.com/api/v5'

function usage() {
  console.log(`Create or update a Gitee Release for Gugu Agent desktop artifacts.

Usage:
  bun run scripts/publish-gitee-release.ts [options]

Safe by default:
  The script only prints a release plan unless --publish is provided.

Options:
  --publish                       Create/update the Gitee Release and upload assets.
  --version <version>             App version. Defaults to desktop/src-tauri/tauri.conf.json.
  --owner <owner>                 Gitee namespace. Defaults to origin remote or xiyouwangluo.
  --repo <repo>                   Gitee repo path. Defaults to origin remote or claude-code-gugu.
  --tag <tag>                     Release tag. Defaults to v<version>.
  --target <ref>                  Target commitish for a new Release. Defaults to master.
  --name <name>                   Release title. Defaults to Gugu Agent v<version>.
  --notes <path>                  Release notes markdown. Defaults to release-notes/v<version>.md.
  --release-json <path>           release.json path. Defaults to desktop/build-artifacts/release.json.
  --body-output <path>            Rendered release body output path. Defaults to desktop/build-artifacts/gitee-release-body.md.
  --windows-artifact <path>       Windows MSI path. Defaults to canonical build-artifacts path.
  --macos-artifact <path>         macOS DMG path. Defaults to canonical build-artifacts path.
  --asset <path>                  Additional asset to upload. Can be repeated.
  --skip-assets                   Create/update the Release body without uploading assets.
  --allow-partial                 Allow uploading only one installer platform.
  --keep-existing-assets          Do not replace same-named existing Release assets.
  --prerelease                    Mark Release as prerelease.
  --api-base-url <url>            Defaults to ${defaultApiBaseUrl}.
  -h, --help                      Show this help.

Environment for --publish:
  GUGU_GITEE_ACCESS_TOKEN         or GITEE_ACCESS_TOKEN
  GUGU_GITEE_OWNER                optional default owner
  GUGU_GITEE_REPO                 optional default repo

Examples:
  bun run scripts/publish-gitee-release.ts
  bun run scripts/publish-gitee-release.ts --publish
  bun run scripts/publish-gitee-release.ts --version 0.1.15 --publish`)
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

function defaultInstallerPath(platform: PlatformName, version: string): string {
  if (platform === 'windows') {
    return join(desktopDir, 'build-artifacts', 'windows-x64', `Gugu-Agent-${version}-windows-x64.msi`)
  }
  return join(desktopDir, 'build-artifacts', 'macos-arm64', `Gugu-Agent-${version}-aarch64.dmg`)
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
}

function parseGiteeRemote(remote: string): { owner: string; repo: string } | null {
  const trimmed = remote.trim()
  const match = trimmed.match(/gitee\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/)
  if (!match) return null
  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
  }
}

function readOriginGiteeRepo(): { owner: string; repo: string } | null {
  const gitConfigPath = join(repoRoot, '.git', 'config')
  if (!existsSync(gitConfigPath)) return null

  const config = readFileSync(gitConfigPath, 'utf8')
  const origin = config.match(/\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/)
  const url = origin?.[1].match(/\n\s*url\s*=\s*(.+)/)?.[1]
  return url ? parseGiteeRemote(url) : null
}

function parseArgs(argv: string[]): Options {
  const version = readAppVersion()
  const originRepo = readOriginGiteeRepo()
  const options: Options = {
    accessToken: envFirst(['GUGU_GITEE_ACCESS_TOKEN', 'GITEE_ACCESS_TOKEN']),
    allowPartial: false,
    apiBaseUrl: defaultApiBaseUrl,
    bodyOutput: join(desktopDir, 'build-artifacts', 'gitee-release-body.md'),
    giteeOwner: envFirst(['GUGU_GITEE_OWNER']) || originRepo?.owner || 'xiyouwangluo',
    giteeRepo: envFirst(['GUGU_GITEE_REPO']) || originRepo?.repo || 'claude-code-gugu',
    includeAssets: true,
    keepExistingAssets: false,
    macosArtifact: defaultInstallerPath('macos', version),
    name: `Gugu Agent v${version}`,
    notes: join(repoRoot, 'release-notes', `v${version}.md`),
    prerelease: false,
    publish: false,
    releaseJson: join(desktopDir, 'build-artifacts', 'release.json'),
    tag: `v${version}`,
    targetCommitish: 'master',
    version,
    windowsArtifact: defaultInstallerPath('windows', version),
    extraAssets: [],
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
        options.tag = `v${options.version}`
        options.name = `Gugu Agent v${options.version}`
        options.notes = join(repoRoot, 'release-notes', `v${options.version}.md`)
        options.windowsArtifact = defaultInstallerPath('windows', options.version)
        options.macosArtifact = defaultInstallerPath('macos', options.version)
        break
      case '--owner':
        options.giteeOwner = readValue()
        break
      case '--repo':
        options.giteeRepo = readValue()
        break
      case '--tag':
        options.tag = readValue()
        break
      case '--target':
        options.targetCommitish = readValue()
        break
      case '--name':
        options.name = readValue()
        break
      case '--notes':
        options.notes = resolvePath(readValue())
        break
      case '--release-json':
        options.releaseJson = resolvePath(readValue())
        break
      case '--body-output':
        options.bodyOutput = resolvePath(readValue())
        break
      case '--windows-artifact':
        options.windowsArtifact = resolvePath(readValue())
        break
      case '--macos-artifact':
        options.macosArtifact = resolvePath(readValue())
        break
      case '--asset':
        options.extraAssets.push(resolvePath(readValue()))
        break
      case '--skip-assets':
        options.includeAssets = false
        break
      case '--allow-partial':
        options.allowPartial = true
        break
      case '--keep-existing-assets':
        options.keepExistingAssets = true
        break
      case '--prerelease':
        options.prerelease = true
        break
      case '--api-base-url':
        options.apiBaseUrl = normalizeApiBaseUrl(readValue())
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  options.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl)
  return options
}

function normalizeApiBaseUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Gitee API base URL must be http or https: ${url}`)
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

function assertVersionFiles(options: Options) {
  const configVersion = readAppVersion()
  if (configVersion !== options.version) {
    throw new Error(`Version mismatch: tauri.conf.json is ${configVersion}, release version is ${options.version}`)
  }

  if (!existsSync(options.notes)) {
    throw new Error(`Missing release notes: ${options.notes}`)
  }
}

function installerArtifact(
  platform: PlatformName,
  filePath: string,
  version: string,
): InstallerArtifact | null {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null

  const fileName = basename(filePath)
  const expected = platform === 'windows'
    ? `Gugu-Agent-${version}-windows-x64.msi`
    : `Gugu-Agent-${version}-aarch64.dmg`
  if (fileName !== expected) {
    throw new Error(`Unexpected ${platform} artifact name: expected ${expected}, got ${fileName}`)
  }

  return {
    description: platform === 'windows' ? 'Windows MSI installer' : 'macOS DMG installer',
    fileName,
    path: filePath,
    platform,
    sha256: sha256File(filePath),
  }
}

function collectAssets(options: Options): AssetUpload[] {
  if (!options.includeAssets) return []

  const windows = installerArtifact('windows', options.windowsArtifact, options.version)
  const macos = installerArtifact('macos', options.macosArtifact, options.version)
  const installers = [windows, macos].filter(Boolean) as InstallerArtifact[]

  if (!options.allowPartial && installers.length !== 2) {
    const missing = [
      windows ? null : options.windowsArtifact,
      macos ? null : options.macosArtifact,
    ].filter(Boolean)
    throw new Error(`Missing installer artifact(s): ${missing.join(', ')}`)
  }

  const assets: AssetUpload[] = installers.map((artifact) => ({
    description: artifact.description,
    fileName: artifact.fileName,
    path: artifact.path,
    sha256: artifact.sha256,
  }))

  for (const assetPath of options.extraAssets) {
    if (!existsSync(assetPath) || !statSync(assetPath).isFile()) {
      throw new Error(`Missing extra asset: ${assetPath}`)
    }
    assets.push({
      description: 'extra asset',
      fileName: basename(assetPath),
      path: assetPath,
      sha256: sha256File(assetPath),
    })
  }

  return dedupeAssets(assets)
}

function dedupeAssets(assets: AssetUpload[]): AssetUpload[] {
  const byName = new Map<string, AssetUpload>()
  for (const asset of assets) {
    const existing = byName.get(asset.fileName)
    if (existing) {
      if (existing.path !== asset.path) {
        throw new Error(`Duplicate asset name with different paths: ${asset.fileName}`)
      }
      continue
    }
    byName.set(asset.fileName, asset)
  }
  return [...byName.values()]
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function loadReleaseJson(options: Options): ReleaseJson | null {
  if (!existsSync(options.releaseJson)) return null
  const release = readJsonFile<ReleaseJson>(options.releaseJson)
  if (release.version !== options.version) {
    throw new Error(`release.json version mismatch: expected ${options.version}, got ${release.version}`)
  }
  return release
}

function buildReleaseBody(options: Options, assets: AssetUpload[]): string {
  const notes = readFileSync(options.notes, 'utf8').trim()
  const release = loadReleaseJson(options)
  const byName = new Map(assets.map((asset) => [asset.fileName, asset]))
  const windowsName = `Gugu-Agent-${options.version}-windows-x64.msi`
  const macosName = `Gugu-Agent-${options.version}-aarch64.dmg`
  const windowsSha = release?.windows?.sha256 ?? byName.get(windowsName)?.sha256
  const macosSha = release?.macos?.sha256 ?? byName.get(macosName)?.sha256

  const lines = [
    notes,
    '',
    '---',
    '',
    '## 下载与校验',
    '',
  ]

  if (release?.windows?.url) {
    lines.push(`- Windows MSI: ${release.windows.url}`)
  } else if (byName.has(windowsName)) {
    lines.push(`- Windows MSI: 见本 Release 附件 \`${windowsName}\``)
  }
  if (windowsSha) lines.push(`  - SHA256: \`${windowsSha}\``)

  if (release?.macos?.url) {
    lines.push(`- macOS DMG: ${release.macos.url}`)
  } else if (byName.has(macosName)) {
    lines.push(`- macOS DMG: 见本 Release 附件 \`${macosName}\``)
  }
  if (macosSha) lines.push(`  - SHA256: \`${macosSha}\``)

  if (!release) {
    lines.push('', '> 未找到 release.json，本次 Release 正文只使用本地附件校验值。')
  }

  return `${lines.join('\n').trim()}\n`
}

function writeBodyOutput(options: Options, body: string) {
  mkdirSync(dirname(options.bodyOutput), { recursive: true })
  writeFileSync(options.bodyOutput, body)
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${Math.round(mb * 10) / 10} MB`
  const kb = bytes / 1024
  if (kb >= 1) return `${Math.round(kb * 10) / 10} KB`
  return `${bytes} B`
}

function printPlan(options: Options, body: string, assets: AssetUpload[]) {
  console.log(`[publish-gitee-release] Version: ${options.version}`)
  console.log(`[publish-gitee-release] Mode: ${options.publish ? 'publish' : 'dry-run'}`)
  console.log(`[publish-gitee-release] Repo: ${options.giteeOwner}/${options.giteeRepo}`)
  console.log(`[publish-gitee-release] Tag: ${options.tag}`)
  console.log(`[publish-gitee-release] Target: ${options.targetCommitish}`)
  console.log(`[publish-gitee-release] Name: ${options.name}`)
  console.log(`[publish-gitee-release] Notes: ${options.notes}`)
  console.log(`[publish-gitee-release] Body output: ${options.bodyOutput}`)
  console.log(`[publish-gitee-release] Body length: ${body.length} chars`)
  console.log(`[publish-gitee-release] Assets: ${assets.length}`)
  for (const asset of assets) {
    const size = formatBytes(statSync(asset.path).size)
    console.log(`  - ${asset.fileName}`)
    console.log(`    from: ${asset.path}`)
    console.log(`    kind: ${asset.description}, size: ${size}, sha256: ${asset.sha256}`)
  }
}

function releaseApiPath(options: Options, suffix = ''): string {
  const owner = encodeURIComponent(options.giteeOwner)
  const repo = encodeURIComponent(options.giteeRepo)
  return `/repos/${owner}/${repo}/releases${suffix}`
}

function apiUrl(options: Options, path: string): string {
  const url = new URL(`${options.apiBaseUrl}${path}`)
  url.searchParams.set('access_token', options.accessToken)
  return url.toString()
}

async function giteeRequest<T>(
  options: Options,
  method: string,
  path: string,
  body?: unknown,
  allow404 = false,
): Promise<T | null> {
  if (!options.accessToken) {
    throw new Error('Missing Gitee token. Set GUGU_GITEE_ACCESS_TOKEN or GITEE_ACCESS_TOKEN.')
  }

  const response = await fetch(apiUrl(options, path), {
    method,
    headers: body === undefined
      ? undefined
      : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const text = await response.text()
  if (allow404 && response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Gitee ${method} ${path} failed: HTTP ${response.status} ${text}`.trim())
  }
  if (!text.trim()) return null
  return JSON.parse(text) as T
}

async function getReleaseByTag(options: Options): Promise<GiteeRelease | null> {
  return giteeRequest<GiteeRelease>(
    options,
    'GET',
    releaseApiPath(options, `/tags/${encodeURIComponent(options.tag)}`),
    undefined,
    true,
  )
}

async function createRelease(options: Options, body: string): Promise<GiteeRelease> {
  const release = await giteeRequest<GiteeRelease>(options, 'POST', releaseApiPath(options), {
    tag_name: options.tag,
    name: options.name,
    body,
    target_commitish: options.targetCommitish,
    prerelease: options.prerelease,
  })
  if (!release?.id) {
    throw new Error('Gitee create release returned no release id.')
  }
  return release
}

async function updateRelease(options: Options, releaseId: number, body: string): Promise<GiteeRelease> {
  const release = await giteeRequest<GiteeRelease>(
    options,
    'PATCH',
    releaseApiPath(options, `/${releaseId}`),
    {
      tag_name: options.tag,
      name: options.name,
      body,
      target_commitish: options.targetCommitish,
      prerelease: options.prerelease,
    },
  )
  if (!release?.id) {
    throw new Error('Gitee update release returned no release id.')
  }
  return release
}

async function listAssets(options: Options, releaseId: number): Promise<GiteeAsset[]> {
  const assets = await giteeRequest<GiteeAsset[]>(
    options,
    'GET',
    releaseApiPath(options, `/${releaseId}/attach_files`),
  )
  return assets ?? []
}

async function deleteAsset(options: Options, releaseId: number, assetId: number) {
  await giteeRequest<unknown>(
    options,
    'DELETE',
    releaseApiPath(options, `/${releaseId}/attach_files/${assetId}`),
  )
}

async function uploadAsset(options: Options, releaseId: number, asset: AssetUpload) {
  if (!options.accessToken) {
    throw new Error('Missing Gitee token. Set GUGU_GITEE_ACCESS_TOKEN or GITEE_ACCESS_TOKEN.')
  }

  const url = apiUrl(options, releaseApiPath(options, `/${releaseId}/attach_files`))
  const form = new FormData()
  const file = new Blob([readFileSync(asset.path)], { type: contentTypeFor(asset.fileName) })
  form.append('file', file, asset.fileName)

  const response = await fetch(url, {
    method: 'POST',
    body: form,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Gitee upload ${asset.fileName} failed: HTTP ${response.status} ${text}`.trim())
  }
}

function assetName(asset: GiteeAsset): string {
  return asset.name || asset.filename || basename(asset.browser_download_url || asset.download_url || '')
}

function contentTypeFor(fileName: string): string {
  if (fileName.endsWith('.msi')) return 'application/octet-stream'
  if (fileName.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (fileName.endsWith('.tar.gz')) return 'application/gzip'
  if (fileName.endsWith('.sig')) return 'text/plain; charset=utf-8'

  const lower = fileName.toLowerCase()
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

async function publish(options: Options, body: string, assets: AssetUpload[]) {
  const existing = await getReleaseByTag(options)
  const release = existing
    ? await updateRelease(options, existing.id, body)
    : await createRelease(options, body)

  console.log(`[publish-gitee-release] ${existing ? 'Updated' : 'Created'} Release #${release.id}`)

  if (!options.includeAssets || assets.length === 0) return

  const existingAssets = await listAssets(options, release.id)
  const existingByName = new Map(existingAssets.map((asset) => [assetName(asset), asset]))

  for (const asset of assets) {
    const existingAsset = existingByName.get(asset.fileName)
    if (existingAsset) {
      if (options.keepExistingAssets) {
        console.log(`[publish-gitee-release] Keeping existing ${asset.fileName}`)
        continue
      }
      process.stdout.write(`[publish-gitee-release] Replacing ${asset.fileName}... `)
      await deleteAsset(options, release.id, existingAsset.id)
      console.log('deleted')
    }

    process.stdout.write(`[publish-gitee-release] Uploading ${asset.fileName}... `)
    await uploadAsset(options, release.id, asset)
    console.log('ok')
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    assertVersionFiles(options)
    const assets = collectAssets(options)
    const body = buildReleaseBody(options, assets)
    writeBodyOutput(options, body)
    printPlan(options, body, assets)

    if (!options.publish) {
      console.log('[publish-gitee-release] Dry-run complete. Add --publish to create/update the Gitee Release.')
      return
    }

    await publish(options, body, assets)
    console.log('[publish-gitee-release] Done.')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[publish-gitee-release] ERROR: ${message}`)
    process.exit(1)
  }
}

main()

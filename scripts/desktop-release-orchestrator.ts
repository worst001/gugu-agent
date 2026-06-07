#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'

type Phase =
  | 'preflight'
  | 'prepare'
  | 'ci'
  | 'fetch'
  | 'check'
  | 'publish-downloads'
  | 'publish-updater'
  | 'publish-gitee'
  | 'report'

type JsonObject = Record<string, unknown>

type CommandResult = {
  code: number
  stderr: string
  stdout: string
}

type Options = {
  allowDirty: boolean
  allowExistingTag: boolean
  allowPartial: boolean
  baseUrl: string
  branch: string | null
  downloadsOnly: boolean
  execute: boolean
  expectedOnlineLatest: string | null
  githubRepo: string
  macosSmoke: string
  offline: boolean
  phase: Phase
  previousVersion: string | null
  publish: boolean
  remote: string
  report: string
  requireUpdater: boolean
  runId: string | null
  runUrl: string | null
  skipCleanupEvidence: boolean
  skipSmoke: boolean
  version: string
  windowsSmoke: string
}

type GitStateMode = 'before-release' | 'ready-to-push' | 'released'

type ReleasePaths = {
  latestJson: string
  macosArtifactDir: string
  macosDmg: string
  macosUpdaterArchive: string
  releaseJson: string
  report: string
  smokeDir: string
  windowsArtifactDir: string
  windowsMsi: string
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const desktopDir = join(repoRoot, 'desktop')
const defaultBaseUrl = 'https://gxy-download.oss-cn-shanghai.aliyuncs.com/'

const phases: Phase[] = [
  'preflight',
  'prepare',
  'ci',
  'fetch',
  'check',
  'publish-downloads',
  'publish-updater',
  'publish-gitee',
  'report',
]

const requiredUpdaterPlatforms = [
  'darwin-aarch64-app',
  'darwin-aarch64',
  'windows-x86_64-msi',
  'windows-x86_64',
]

class Gate {
  readonly failures: string[] = []
  readonly infos: string[] = []
  readonly passes: string[] = []
  readonly warnings: string[] = []

  fail(message: string) {
    this.failures.push(message)
  }

  info(message: string) {
    this.infos.push(message)
  }

  pass(message: string) {
    this.passes.push(message)
  }

  warn(message: string) {
    this.warnings.push(message)
  }

  check(condition: boolean, message: string, failure = message) {
    if (condition) {
      this.pass(message)
    } else {
      this.fail(failure)
    }
  }

  print() {
    for (const message of this.passes) {
      console.log(`OK   ${message}`)
    }
    for (const message of this.infos) {
      console.log(`INFO ${message}`)
    }
    for (const message of this.warnings) {
      console.warn(`WARN ${message}`)
    }
    for (const message of this.failures) {
      console.error(`FAIL ${message}`)
    }
  }

  assert() {
    this.print()
    if (this.failures.length > 0) {
      throw new Error(`${this.failures.length} release gate(s) failed.`)
    }
  }
}

function usage() {
  console.log(`Desktop release orchestrator for Gugu Agent.

Usage:
  bun run scripts/desktop-release-orchestrator.ts <phase> --version <x.y.z> [options]

Phases:
  preflight           Check source state before creating a release commit/tag.
  prepare             Run scripts/release.ts. Dry-run unless --execute is set.
  ci                  Push the release tag/branch. Prints commands unless --execute is set.
  fetch               Download a GitHub Actions run with gh when --execute --run-id are set.
  check               Validate local artifacts, manifests, and smoke receipts.
  publish-downloads   Upload MSI/DMG + release.json only. Dry-run unless --publish is set.
  publish-updater     Upload updater artifacts + latest.json. Requires smoke receipts.
  publish-gitee       Create/update Gitee release. Dry-run unless --publish is set.
  report              Write the release report without enforcing all gates.

Core options:
  --version <x.y.z>             Target desktop version. Defaults to tauri.conf.json.
  --previous-version <x.y.z>    Version used for old-version upgrade smoke.
  --remote <name>               Git remote for tag/branch checks. Defaults to github.
  --branch <name>               Branch to push in the ci phase. Defaults to current branch.
  --offline                     Skip remote tag/branch checks and online latest readback.
  --allow-dirty                 Allow dirty git state in preflight.
  --allow-existing-tag          Permit an existing local/remote tag. Incident mode only.
  --execute                     Let prepare/ci/fetch run mutating commands.
  --publish                     Let publish-* phases upload/create remote resources.

Artifact and smoke options:
  --downloads-only              check phase skips updater manifest and smoke receipt gates.
  --require-updater             Require latest.json and updater artifacts. Default for check.
  --skip-smoke                  Skip smoke receipt gates. Not allowed for publish-updater.
  --windows-smoke <path>        Defaults to desktop/build-artifacts/release-smoke/windows-vX.Y.Z.json.
  --macos-smoke <path>          Defaults to desktop/build-artifacts/release-smoke/macos-vX.Y.Z.json.
  --skip-cleanup-evidence       Do not require hosts/cert/staging cleanup evidence in receipts.
  --expected-online-latest <v>  Require receipt cleanup.onlineLatestVersion to match this version.
  --base-url <url>              Public OSS base URL. Defaults to ${defaultBaseUrl}
  --run-id <id>                 GitHub Actions run id for fetch.
  --run-url <url>               GitHub Actions run URL for report metadata.
  --report <path>               Defaults to desktop/build-artifacts/release-report-vX.Y.Z.md.

Smoke receipt schema:
  {
    "platform": "windows",
    "version": "0.2.5",
    "previousVersion": "0.2.4",
    "status": "passed",
    "upgrade": { "passed": true, "from": "0.2.4", "to": "0.2.5" },
    "checks": {
      "appVersionOk": true,
      "sidecarOk": true,
      "mainExeExists": true,
      "shortcutTargetsValid": true,
      "noInstallerWarnings": true,
      "codesignStrict": true,
      "appRelaunchOk": true
    },
    "cleanup": {
      "hostsRestored": true,
      "stagingServerStopped": true,
      "tempCertRemoved": true,
      "onlineLatestVersion": "0.2.4"
    }
  }`)
}

function normalizeVersion(version: string): string {
  const normalized = version.trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Version must be x.y.z: ${version}`)
  }
  return normalized
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)

  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1
    if (a[index] < b[index]) return -1
  }

  return 0
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath)
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

function releasePaths(version: string, reportPath: string | null): ReleasePaths {
  const smokeDir = join(desktopDir, 'build-artifacts', 'release-smoke')

  return {
    latestJson: join(desktopDir, 'build-artifacts', 'latest.json'),
    macosArtifactDir: join(desktopDir, 'build-artifacts', 'macos-arm64'),
    macosDmg: join(desktopDir, 'build-artifacts', 'macos-arm64', `Gugu-Agent-${version}-aarch64.dmg`),
    macosUpdaterArchive: join(
      desktopDir,
      'build-artifacts',
      'macos-arm64',
      `Gugu-Agent-${version}-darwin-aarch64.app.tar.gz`,
    ),
    releaseJson: join(desktopDir, 'build-artifacts', 'release.json'),
    report: reportPath
      ? resolvePath(reportPath)
      : join(desktopDir, 'build-artifacts', `release-report-v${version}.md`),
    smokeDir,
    windowsArtifactDir: join(desktopDir, 'build-artifacts', 'windows-x64'),
    windowsMsi: join(desktopDir, 'build-artifacts', 'windows-x64', `Gugu-Agent-${version}-windows-x64.msi`),
  }
}

function parseArgs(argv: string[]): Options {
  let phase: Phase | null = null
  let version: string | null = null
  let previousVersion: string | null = null
  let report: string | null = null
  let windowsSmoke: string | null = null
  let macosSmoke: string | null = null
  const options = {
    allowDirty: false,
    allowExistingTag: false,
    allowPartial: false,
    baseUrl: defaultBaseUrl,
    branch: null as string | null,
    downloadsOnly: false,
    execute: false,
    expectedOnlineLatest: null as string | null,
    githubRepo: 'worst001/gugu-agent',
    offline: false,
    publish: false,
    remote: 'github',
    requireUpdater: true,
    runId: null as string | null,
    runUrl: null as string | null,
    skipCleanupEvidence: false,
    skipSmoke: false,
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
      if (phase) {
        throw new Error(`Unexpected positional argument: ${arg}`)
      }
      if (!phases.includes(arg as Phase)) {
        throw new Error(`Unknown phase: ${arg}`)
      }
      phase = arg as Phase
      continue
    }

    switch (arg) {
      case '--allow-dirty':
        options.allowDirty = true
        break
      case '--allow-existing-tag':
        options.allowExistingTag = true
        break
      case '--allow-partial':
        options.allowPartial = true
        break
      case '--base-url':
        options.baseUrl = normalizeBaseUrl(readValue())
        break
      case '--branch':
        options.branch = readValue()
        break
      case '--downloads-only':
      case '--no-updater':
        options.downloadsOnly = true
        options.requireUpdater = false
        break
      case '--execute':
        options.execute = true
        break
      case '--expected-online-latest':
        options.expectedOnlineLatest = normalizeVersion(readValue())
        break
      case '--github-repo':
        options.githubRepo = readValue()
        break
      case '--macos-smoke':
        macosSmoke = resolvePath(readValue())
        break
      case '--offline':
        options.offline = true
        break
      case '--previous-version':
        previousVersion = normalizeVersion(readValue())
        break
      case '--publish':
        options.publish = true
        break
      case '--remote':
        options.remote = readValue()
        break
      case '--report':
        report = resolvePath(readValue())
        break
      case '--require-updater':
        options.downloadsOnly = false
        options.requireUpdater = true
        break
      case '--run-id':
        options.runId = readValue()
        break
      case '--run-url':
        options.runUrl = readValue()
        break
      case '--skip-cleanup-evidence':
        options.skipCleanupEvidence = true
        break
      case '--skip-smoke':
        options.skipSmoke = true
        break
      case '--version':
        version = normalizeVersion(readValue())
        break
      case '--windows-smoke':
        windowsSmoke = resolvePath(readValue())
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!phase) {
    throw new Error('Missing phase. Run with --help for usage.')
  }

  const targetVersion = version ?? readAppVersion()
  const paths = releasePaths(targetVersion, report)

  return {
    ...options,
    macosSmoke: macosSmoke ?? join(paths.smokeDir, `macos-v${targetVersion}.json`),
    phase,
    previousVersion,
    report: paths.report,
    version: targetVersion,
    windowsSmoke: windowsSmoke ?? join(paths.smokeDir, `windows-v${targetVersion}.json`),
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(normalized).toString()
}

function rel(filePath: string): string {
  return relative(repoRoot, filePath).replaceAll('\\', '/')
}

function quoteArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value
  return JSON.stringify(value)
}

async function run(cmd: string[], cwd = repoRoot, allowFailure = false): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited

  if (code !== 0 && !allowFailure) {
    throw new Error(`Command failed: ${cmd.map(quoteArg).join(' ')}\n${stderr || stdout}`)
  }

  return { code, stderr: stderr.trim(), stdout: stdout.trim() }
}

function fileSize(filePath: string): number {
  return statSync(filePath).size
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile()
}

function sha256File(filePath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

function readVersionFile(path: string, reader: (content: string) => string | null): string | null {
  if (!fileExists(path)) return null
  return reader(readFileSync(path, 'utf8'))
}

function assertVersionFiles(gate: Gate, targetVersion: string, mode: 'before-release' | 'released') {
  const packageJsonPath = join(desktopDir, 'package.json')
  const tauriConfigPath = join(desktopDir, 'src-tauri', 'tauri.conf.json')
  const cargoTomlPath = join(desktopDir, 'src-tauri', 'Cargo.toml')
  const packageVersion = readVersionFile(packageJsonPath, (content) => readJson<{ version?: string }>(content).version ?? null)
  const tauriVersion = readVersionFile(tauriConfigPath, (content) => readJson<{ version?: string }>(content).version ?? null)
  const cargoVersion = readVersionFile(cargoTomlPath, (content) => content.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null)
  const versions = [packageVersion, tauriVersion, cargoVersion].filter(Boolean) as string[]
  const unique = [...new Set(versions)]

  gate.check(unique.length === 1, `Desktop version files agree: ${unique[0] ?? 'missing'}`)

  if (mode === 'released') {
    gate.check(
      unique[0] === targetVersion,
      `Desktop version files are ${targetVersion}`,
      `Desktop version files are ${unique[0] ?? 'missing'}, expected ${targetVersion}`,
    )
  } else if (unique[0]) {
    const comparison = compareVersions(targetVersion, unique[0])
    gate.check(
      comparison > 0,
      `Target version ${targetVersion} is newer than current ${unique[0]}`,
      `Target version ${targetVersion} must be newer than current ${unique[0]}`,
    )
  }
}

function readJson<T>(content: string): T {
  return JSON.parse(content) as T
}

async function gitOutput(args: string[], allowFailure = false): Promise<CommandResult> {
  return run(['git', ...args], repoRoot, allowFailure)
}

async function currentBranch(): Promise<string> {
  const result = await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'])
  return result.stdout
}

async function assertGitState(gate: Gate, options: Options, mode: GitStateMode) {
  const status = await gitOutput(['status', '--short'])
  if (status.stdout) {
    const releaseNotesPath = `release-notes/v${options.version}.md`
    const dirtyPaths = parsePorcelainPaths(status.stdout)
    const onlyReleaseNotesDirty = mode === 'before-release'
      && dirtyPaths.length > 0
      && dirtyPaths.every((path) => path === releaseNotesPath)

    if (onlyReleaseNotesDirty) {
      gate.pass(`Working tree only has release notes pending: ${releaseNotesPath}`)
    } else if (options.allowDirty) {
      gate.warn(`Working tree is dirty but --allow-dirty is set:\n${status.stdout}`)
    } else {
      gate.fail(`Working tree is dirty:\n${status.stdout}`)
    }
  } else {
    gate.pass('Working tree is clean')
  }

  const tag = `v${options.version}`
  const localTag = await gitOutput(['rev-parse', '-q', '--verify', `refs/tags/${tag}`], true)
  const localTagExists = localTag.code === 0 && Boolean(localTag.stdout)

  if (mode === 'before-release') {
    if (localTagExists && !options.allowExistingTag) {
      gate.fail(`Local tag already exists: ${tag}. Use --allow-existing-tag only for incident handling.`)
    } else if (localTagExists) {
      gate.warn(`Local tag already exists and --allow-existing-tag is set: ${tag}`)
    } else {
      gate.pass(`Local tag does not exist yet: ${tag}`)
    }
  } else {
    gate.check(localTagExists, `Local tag exists: ${tag}`)
    if (localTagExists) {
      const head = await gitOutput(['rev-parse', 'HEAD'])
      const tagCommit = await gitOutput(['rev-parse', `${tag}^{}`])
      gate.check(
        head.stdout === tagCommit.stdout,
        `Local tag ${tag} points at HEAD`,
        `Local tag ${tag} points at ${tagCommit.stdout}, but HEAD is ${head.stdout}`,
      )
    }
  }

  if (options.offline) {
    gate.warn('Skipping remote tag/branch checks because --offline is set')
    return
  }

  const remoteTag = await gitOutput(['ls-remote', '--tags', options.remote, tag], true)
  const remoteTagExists = remoteTag.code === 0 && remoteTag.stdout.trim().length > 0

  if (mode === 'before-release' || mode === 'ready-to-push') {
    if (remoteTagExists && !options.allowExistingTag) {
      gate.fail(`Remote tag already exists on ${options.remote}: ${tag}`)
    } else if (remoteTagExists) {
      gate.warn(`Remote tag already exists and --allow-existing-tag is set on ${options.remote}: ${tag}`)
    } else {
      gate.pass(`Remote tag does not exist yet on ${options.remote}: ${tag}`)
    }
  } else {
    gate.check(remoteTagExists, `Remote tag exists on ${options.remote}: ${tag}`)
  }

  const branch = options.branch ?? await currentBranch()
  const remoteBranch = await gitOutput(['ls-remote', '--heads', options.remote, branch], true)
  const remoteBranchExists = remoteBranch.code === 0 && remoteBranch.stdout.trim().length > 0
  if (remoteBranchExists) {
    gate.warn(`Remote branch already exists on ${options.remote}: ${branch}`)
  } else {
    gate.pass(`Remote branch does not exist yet on ${options.remote}: ${branch}`)
  }
}

function parsePorcelainPaths(status: string): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3).trim()
      const renameSeparator = ' -> '
      return rawPath.includes(renameSeparator)
        ? rawPath.slice(rawPath.indexOf(renameSeparator) + renameSeparator.length)
        : rawPath
    })
    .map((path) => path.replaceAll('\\', '/'))
}

function assertReleaseNotes(gate: Gate, version: string) {
  const releaseNotesPath = join(repoRoot, 'release-notes', `v${version}.md`)
  gate.check(fileExists(releaseNotesPath), `Release notes exist: ${rel(releaseNotesPath)}`)
}

function assertRequiredScripts(gate: Gate) {
  const files = [
    'scripts/release.ts',
    'scripts/generate-release-json.ts',
    'scripts/upload-release-oss.ts',
    'scripts/publish-gitee-release.ts',
    'desktop/scripts/merge-updater-latest.ts',
    '.github/workflows/release-desktop.yml',
  ]

  for (const file of files) {
    const filePath = join(repoRoot, file)
    gate.check(fileExists(filePath), `Required release entry exists: ${file}`)
  }
}

function assertArtifact(gate: Gate, filePath: string, label: string, minimumBytes: number) {
  if (!fileExists(filePath)) {
    gate.fail(`Missing ${label}: ${rel(filePath)}`)
    return
  }

  const size = fileSize(filePath)
  gate.check(
    size >= minimumBytes,
    `${label} exists (${size} bytes): ${rel(filePath)}`,
    `${label} is unexpectedly small (${size} bytes): ${rel(filePath)}`,
  )
}

function assertReleaseJson(gate: Gate, paths: ReleasePaths, options: Options) {
  if (!fileExists(paths.releaseJson)) {
    gate.fail(`Missing release.json: ${rel(paths.releaseJson)}`)
    return
  }

  const releaseJson = readJsonFile<{
    macos?: { sha256?: string; url?: string }
    version?: string
    windows?: { sha256?: string; url?: string }
  }>(paths.releaseJson)

  gate.check(
    releaseJson.version === options.version,
    `release.json version is ${options.version}`,
    `release.json version is ${releaseJson.version ?? 'missing'}, expected ${options.version}`,
  )

  const platforms = [
    ['windows', paths.windowsMsi, releaseJson.windows] as const,
    ['macos', paths.macosDmg, releaseJson.macos] as const,
  ]

  for (const [platform, artifactPath, entry] of platforms) {
    if (!entry) {
      if (options.allowPartial) {
        gate.warn(`release.json is missing ${platform}, allowed by --allow-partial`)
      } else {
        gate.fail(`release.json is missing ${platform}`)
      }
      continue
    }

    gate.check(Boolean(entry.url), `release.json ${platform} URL exists`)
    gate.check(Boolean(entry.sha256), `release.json ${platform} SHA256 exists`)

    if (fileExists(artifactPath) && entry.sha256) {
      const actual = sha256File(artifactPath)
      gate.check(
        entry.sha256.toLowerCase() === actual,
        `release.json ${platform} SHA256 matches local artifact`,
        `release.json ${platform} SHA256 mismatch: ${entry.sha256} != ${actual}`,
      )
    }

    if (entry.url) {
      assertPublicUrl(gate, entry.url, `release.json ${platform} URL`, options.baseUrl)
    }
  }
}

function assertPublicUrl(gate: Gate, value: string, label: string, baseUrl: string) {
  try {
    const parsed = new URL(value)
    const base = new URL(baseUrl)
    gate.check(
      parsed.protocol === 'https:',
      `${label} uses HTTPS`,
      `${label} must use HTTPS: ${value}`,
    )
    gate.check(
      parsed.hostname === base.hostname,
      `${label} points at ${base.hostname}`,
      `${label} points at ${parsed.hostname}, expected ${base.hostname}`,
    )
    gate.check(
      !parsed.hostname.includes('localhost') && !parsed.hostname.includes('127.0.0.1'),
      `${label} is not a local staging URL`,
    )
    gate.check(
      !parsed.hostname.includes('github.com') && !parsed.hostname.includes('actions'),
      `${label} is not a temporary GitHub artifact URL`,
    )
  } catch {
    gate.fail(`${label} is not a valid URL: ${value}`)
  }
}

function assertLatestJson(gate: Gate, paths: ReleasePaths, options: Options) {
  if (!fileExists(paths.latestJson)) {
    gate.fail(`Missing latest.json: ${rel(paths.latestJson)}`)
    return
  }

  const latest = readJsonFile<{
    platforms?: Record<string, { signature?: string; url?: string }>
    signature?: string
    url?: string
    version?: string
  }>(paths.latestJson)

  gate.check(
    latest.version === options.version,
    `latest.json version is ${options.version}`,
    `latest.json version is ${latest.version ?? 'missing'}, expected ${options.version}`,
  )

  const platforms = latest.platforms ?? {}
  for (const platform of requiredUpdaterPlatforms) {
    gate.check(Boolean(platforms[platform]), `latest.json has platform ${platform}`)
  }

  for (const [platform, entry] of Object.entries(platforms)) {
    if (!entry.url) {
      gate.fail(`latest.json ${platform} is missing URL`)
      continue
    }

    gate.check(Boolean(entry.signature), `latest.json ${platform} signature exists`)
    assertUpdaterSignature(gate, entry.signature, `latest.json ${platform} signature`)
    assertPublicUrl(gate, entry.url, `latest.json ${platform} URL`, options.baseUrl)
    assertUpdaterArtifactForEntry(gate, paths, platform, entry.url, entry.signature)
  }
}

function normalizeUpdaterSignature(signature: string | undefined): string | null {
  if (!signature) return null

  let normalized = signature.trim()
  const publicSignature = normalized.match(/Public signature:\s*([A-Za-z0-9+/=]+)/s)

  if (publicSignature) {
    normalized = publicSignature[1].trim()
  }

  if (!normalized || /\s/.test(normalized) || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    return null
  }

  try {
    atob(normalized)
  } catch {
    return null
  }

  return normalized
}

function assertUpdaterSignature(gate: Gate, signature: string | undefined, label: string) {
  const normalized = normalizeUpdaterSignature(signature)
  gate.check(Boolean(normalized), `${label} is a single-line base64 public signature`)
  if (normalized && signature?.trim() !== normalized) {
    gate.fail(`${label} includes signer log text; use only the Public signature value`)
  }
}

function assertUpdaterArtifactForEntry(
  gate: Gate,
  paths: ReleasePaths,
  platform: string,
  url: string,
  signature: string | undefined,
) {
  let fileName: string
  try {
    fileName = basename(decodeURIComponent(new URL(url).pathname))
  } catch {
    fileName = basename(url)
  }

  const artifactDir = platform.startsWith('darwin')
    ? paths.macosArtifactDir
    : paths.windowsArtifactDir
  const artifactPath = join(artifactDir, fileName)
  const sigPath = `${artifactPath}.sig`

  gate.check(fileExists(artifactPath), `Updater artifact exists for ${platform}: ${rel(artifactPath)}`)
  gate.check(fileExists(sigPath), `Updater signature file exists for ${platform}: ${rel(sigPath)}`)

  if (signature && fileExists(sigPath)) {
    const sigContent = readFileSync(sigPath, 'utf8').trim()
    const normalizedManifestSignature = normalizeUpdaterSignature(signature)
    const normalizedFileSignature = normalizeUpdaterSignature(sigContent)
    gate.check(Boolean(normalizedFileSignature), `${basename(sigPath)} is a single-line base64 public signature`)
    gate.check(
      Boolean(normalizedManifestSignature) && normalizedManifestSignature === normalizedFileSignature,
      `latest.json signature matches ${basename(sigPath)}`,
      `latest.json signature mismatch for ${platform}: ${basename(sigPath)}`,
    )
  }
}

async function assertMacArchiveHasCodeResources(gate: Gate, paths: ReleasePaths) {
  if (!fileExists(paths.macosUpdaterArchive)) {
    gate.fail(`Missing macOS updater archive: ${rel(paths.macosUpdaterArchive)}`)
    return
  }

  const result = await run(['tar', '-tzf', paths.macosUpdaterArchive], repoRoot, true)
  if (result.code !== 0) {
    gate.warn(`Could not inspect macOS updater archive with tar: ${result.stderr || result.stdout}`)
    return
  }

  const hasCodeResources = result.stdout
    .split(/\r?\n/)
    .some((line) => /(^|\/)[^/]+\.app\/Contents\/_CodeSignature\/CodeResources$/.test(line))

  gate.check(
    hasCodeResources,
    'macOS updater archive includes Contents/_CodeSignature/CodeResources',
    'macOS updater archive is missing Contents/_CodeSignature/CodeResources',
  )
}

function getPath(source: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined
      return (current as JsonObject)[part]
    }, source)

    if (value !== undefined) return value
  }

  return undefined
}

function requireTrue(gate: Gate, receipt: JsonObject, paths: string[], label: string) {
  const value = getPath(receipt, paths)
  gate.check(value === true, label, `${label} is not true in smoke receipt`)
}

function assertSmokeReceipt(
  gate: Gate,
  filePath: string,
  platform: 'windows' | 'macos',
  options: Options,
) {
  if (!fileExists(filePath)) {
    gate.fail(`Missing ${platform} smoke receipt: ${rel(filePath)}`)
    return
  }

  const receipt = readJsonFile<JsonObject>(filePath)
  const status = String(getPath(receipt, ['status', 'result']) ?? '').toLowerCase()
  const passed = getPath(receipt, ['passed']) === true || ['passed', 'pass', 'ok', 'success'].includes(status)

  gate.pass(`${platform} smoke receipt exists: ${rel(filePath)}`)
  gate.check(
    String(receipt.version ?? '') === options.version,
    `${platform} smoke receipt version is ${options.version}`,
    `${platform} smoke receipt version is ${String(receipt.version ?? 'missing')}, expected ${options.version}`,
  )
  gate.check(passed, `${platform} smoke receipt status is passed`)
  gate.check(
    String(receipt.platform ?? platform).toLowerCase() === platform,
    `${platform} smoke receipt platform is ${platform}`,
  )

  if (options.previousVersion) {
    const previous = String(getPath(receipt, ['previousVersion', 'upgrade.from']) ?? '')
    gate.check(
      previous === options.previousVersion,
      `${platform} smoke upgraded from ${options.previousVersion}`,
      `${platform} smoke previous version is ${previous || 'missing'}, expected ${options.previousVersion}`,
    )
  }

  requireTrue(gate, receipt, ['upgrade.passed', 'checks.upgradePassed', 'checks.oldVersionUpgradePassed'], `${platform} old-version upgrade passed`)
  requireTrue(gate, receipt, ['checks.appVersionOk', 'appVersionOk'], `${platform} app version check passed`)
  requireTrue(gate, receipt, ['checks.sidecarOk', 'checks.sidecarHealthOk', 'sidecarOk'], `${platform} sidecar check passed`)

  if (platform === 'windows') {
    requireTrue(gate, receipt, ['checks.mainExeExists', 'mainExeExists'], 'Windows main exe exists')
    requireTrue(gate, receipt, ['checks.shortcutTargetsValid', 'checks.shortcutsValid'], 'Windows shortcut targets are valid')
    requireTrue(gate, receipt, ['checks.noInstallerWarnings', 'noInstallerWarnings'], 'Windows installer had no visible warnings')
  } else {
    requireTrue(gate, receipt, ['checks.codesignStrict', 'codesignStrict'], 'macOS codesign --verify --deep --strict passed')
    requireTrue(gate, receipt, ['checks.appRelaunchOk', 'appRelaunchOk'], 'macOS app relaunch passed')
  }

  if (!options.skipCleanupEvidence) {
    requireTrue(gate, receipt, ['cleanup.hostsRestored', 'hostsRestored'], `${platform} hosts file restored`)
    requireTrue(gate, receipt, ['cleanup.stagingServerStopped', 'stagingServerStopped'], `${platform} staging server stopped`)
    requireTrue(gate, receipt, ['cleanup.tempCertRemoved', 'cleanup.tempCertificateRemoved', 'tempCertRemoved'], `${platform} temporary certificate removed`)
    const onlineLatest = String(getPath(receipt, ['cleanup.onlineLatestVersion', 'onlineLatestVersion']) ?? '')
    gate.check(Boolean(onlineLatest), `${platform} online latest.json version recorded after cleanup`)

    if (options.expectedOnlineLatest) {
      gate.check(
        onlineLatest === options.expectedOnlineLatest,
        `${platform} online latest.json is ${options.expectedOnlineLatest} after cleanup`,
        `${platform} online latest.json is ${onlineLatest || 'missing'}, expected ${options.expectedOnlineLatest}`,
      )
    }
  }
}

async function runPreflight(options: Options, mode: 'before-release' | 'released' = 'before-release') {
  const gate = new Gate()
  console.log(`Desktop release ${mode === 'before-release' ? 'preflight' : 'source check'} for v${options.version}\n`)

  assertVersionFiles(gate, options.version, mode)
  assertReleaseNotes(gate, options.version)
  assertRequiredScripts(gate)
  await assertGitState(gate, options, mode)
  gate.assert()
}

async function runPrepare(options: Options) {
  await runPreflight(options, 'before-release')

  const args = ['bun', 'run', 'scripts/release.ts', options.version]
  if (!options.execute) args.push('--dry')

  console.log(`\n${options.execute ? 'Running' : 'Previewing'} release script:`)
  console.log(`  ${args.map(quoteArg).join(' ')}`)
  const result = await run(args)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.error(result.stderr)

  if (!options.execute) {
    console.log('\nDry run only. Re-run with --execute to create the release commit and tag.')
  }
}

async function runCi(options: Options) {
  const gate = new Gate()
  const branch = options.branch ?? await currentBranch()
  const tag = `v${options.version}`

  await assertGitState(gate, options, 'ready-to-push')
  gate.assert()

  const commands = [
    ['git', 'push', options.remote, `HEAD:${branch}`],
    ['git', 'push', options.remote, tag],
  ]

  if (!options.execute) {
    console.log('\nCI phase is dry-run. Push these when ready:')
    for (const command of commands) {
      console.log(`  ${command.map(quoteArg).join(' ')}`)
    }
    console.log(`\nGitHub Actions: https://github.com/${options.githubRepo}/actions/workflows/release-desktop.yml`)
    return
  }

  for (const command of commands) {
    console.log(`Running: ${command.map(quoteArg).join(' ')}`)
    const result = await run(command)
    if (result.stdout) console.log(result.stdout)
    if (result.stderr) console.error(result.stderr)
  }
}

async function runFetch(options: Options) {
  const outputDir = join(desktopDir, 'build-artifacts', options.runId ? `github-run-${options.runId}` : 'github-run')
  mkdirSync(outputDir, { recursive: true })

  if (!options.execute || !options.runId) {
    console.log('Fetch phase is dry-run. Use this after the GitHub Actions run succeeds:')
    console.log(`  gh run download <run-id> --repo ${quoteArg(options.githubRepo)} --dir ${quoteArg(outputDir)}`)
    console.log('\nThen place/unpack artifacts into:')
    console.log(`  ${rel(join(desktopDir, 'build-artifacts', 'windows-x64'))}`)
    console.log(`  ${rel(join(desktopDir, 'build-artifacts', 'macos-arm64'))}`)
    return
  }

  const command = ['gh', 'run', 'download', options.runId, '--repo', options.githubRepo, '--dir', outputDir]
  console.log(`Running: ${command.map(quoteArg).join(' ')}`)
  const result = await run(command)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.error(result.stderr)
}

async function runCheck(options: Options, reportOnly = false) {
  const paths = releasePaths(options.version, options.report)
  const gate = new Gate()
  console.log(`Desktop release artifact check for v${options.version}\n`)

  assertVersionFiles(gate, options.version, 'released')
  assertReleaseNotes(gate, options.version)
  assertArtifact(gate, paths.windowsMsi, 'Windows MSI', 1_000_000)
  assertArtifact(gate, paths.macosDmg, 'macOS DMG', 1_000_000)
  assertReleaseJson(gate, paths, options)

  if (options.requireUpdater && !options.downloadsOnly) {
    assertLatestJson(gate, paths, options)
    await assertMacArchiveHasCodeResources(gate, paths)
  } else {
    gate.warn('Skipping updater manifest checks because --downloads-only/--no-updater is set')
  }

  if (!options.skipSmoke && !options.downloadsOnly) {
    assertSmokeReceipt(gate, options.windowsSmoke, 'windows', options)
    assertSmokeReceipt(gate, options.macosSmoke, 'macos', options)
  } else if (options.skipSmoke) {
    gate.warn('Skipping smoke receipt checks because --skip-smoke is set')
  }

  writeReport(paths.report, options, paths, gate)

  if (!reportOnly) {
    gate.assert()
  } else {
    gate.print()
  }
}

async function runPublishDownloads(options: Options) {
  const checkOptions = { ...options, downloadsOnly: true, requireUpdater: false, skipSmoke: true }
  await runCheck(checkOptions)

  const args = ['bun', 'run', 'scripts/upload-release-oss.ts', '--version', options.version, '--no-updater']
  if (options.publish) args.push('--publish')

  console.log(`\n${options.publish ? 'Publishing' : 'Dry-running'} download artifacts to OSS:`)
  console.log(`  ${args.map(quoteArg).join(' ')}`)
  const result = await run(args)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.error(result.stderr)
}

async function runPublishUpdater(options: Options) {
  if (options.skipSmoke) {
    throw new Error('publish-updater cannot run with --skip-smoke. Uploading latest.json requires smoke receipts.')
  }

  await runCheck({ ...options, downloadsOnly: false, requireUpdater: true })

  const args = ['bun', 'run', 'scripts/upload-release-oss.ts', '--version', options.version, '--require-updater']
  if (options.publish) args.push('--publish')

  console.log(`\n${options.publish ? 'Publishing' : 'Dry-running'} updater artifacts and latest.json to OSS:`)
  console.log(`  ${args.map(quoteArg).join(' ')}`)
  const result = await run(args)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.error(result.stderr)

  if (options.publish && !options.offline) {
    await readBackOnlineLatest(options)
  }
}

async function readBackOnlineLatest(options: Options) {
  const url = new URL('latest.json', options.baseUrl).toString()
  console.log(`\nReading back online latest.json: ${url}`)

  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const latest = await response.json() as { version?: string }
    if (latest.version !== options.version) {
      throw new Error(`online latest.json version is ${latest.version ?? 'missing'}, expected ${options.version}`)
    }
    console.log(`OK online latest.json version is ${options.version}`)
  } catch (error) {
    throw new Error(`Failed online latest.json readback: ${String(error)}`)
  }
}

async function runPublishGitee(options: Options) {
  const checkOptions = { ...options, downloadsOnly: true, requireUpdater: false, skipSmoke: true }
  await runCheck(checkOptions)

  const args = ['bun', 'run', 'scripts/publish-gitee-release.ts', '--version', options.version]
  if (options.publish) args.push('--publish')

  console.log(`\n${options.publish ? 'Publishing' : 'Dry-running'} Gitee release:`)
  console.log(`  ${args.map(quoteArg).join(' ')}`)
  const result = await run(args)
  if (result.stdout) console.log(result.stdout)
  if (result.stderr) console.error(result.stderr)
}

function artifactLine(filePath: string, label: string): string {
  if (!fileExists(filePath)) return `- ${label}: missing (${rel(filePath)})`
  return `- ${label}: ${rel(filePath)} (${fileSize(filePath)} bytes, sha256 ${sha256File(filePath)})`
}

function writeReport(reportPath: string, options: Options, paths: ReleasePaths, gate: Gate) {
  mkdirSync(dirname(reportPath), { recursive: true })

  const lines = [
    `# Desktop Release Report v${options.version}`,
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Phase: ${options.phase}`,
    `Previous version: ${options.previousVersion ?? 'not recorded'}`,
    `GitHub Actions run: ${options.runUrl ?? options.runId ?? 'not recorded'}`,
    '',
    '## Artifacts',
    artifactLine(paths.windowsMsi, 'Windows MSI'),
    artifactLine(paths.macosDmg, 'macOS DMG'),
    artifactLine(paths.macosUpdaterArchive, 'macOS updater archive'),
    artifactLine(paths.releaseJson, 'release.json'),
    artifactLine(paths.latestJson, 'latest.json'),
    '',
    '## Smoke Receipts',
    `- Windows: ${fileExists(options.windowsSmoke) ? rel(options.windowsSmoke) : `missing (${rel(options.windowsSmoke)})`}`,
    `- macOS: ${fileExists(options.macosSmoke) ? rel(options.macosSmoke) : `missing (${rel(options.macosSmoke)})`}`,
    '',
    '## Gate Summary',
    `- Passed: ${gate.passes.length}`,
    `- Warnings: ${gate.warnings.length}`,
    `- Failures: ${gate.failures.length}`,
    '',
  ]

  if (gate.failures.length > 0) {
    lines.push('## Failures', ...gate.failures.map((failure) => `- ${failure}`), '')
  }

  if (gate.warnings.length > 0) {
    lines.push('## Warnings', ...gate.warnings.map((warning) => `- ${warning}`), '')
  }

  writeFileSync(reportPath, `${lines.join('\n')}\n`)
  console.log(`\nReport written: ${rel(reportPath)}`)
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2))

    switch (options.phase) {
      case 'preflight':
        await runPreflight(options)
        break
      case 'prepare':
        await runPrepare(options)
        break
      case 'ci':
        await runCi(options)
        break
      case 'fetch':
        await runFetch(options)
        break
      case 'check':
        await runCheck(options)
        break
      case 'publish-downloads':
        await runPublishDownloads(options)
        break
      case 'publish-updater':
        await runPublishUpdater(options)
        break
      case 'publish-gitee':
        await runPublishGitee(options)
        break
      case 'report':
        await runCheck({ ...options, skipSmoke: true }, true)
        break
    }
  } catch (error) {
    console.error(`\nDesktop release orchestrator failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

await main()

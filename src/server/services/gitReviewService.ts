import * as fs from 'fs/promises'
import * as path from 'path'

const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_REVIEW_FILES = 5_000

export type GitInfo = {
  isGit: boolean
  branch: string | null
  repoName: string | null
  repoRoot: string | null
  workDir: string
  changedFiles: number
}

export type GitReviewFile = {
  path: string
  oldPath?: string
  status: string
  kind: 'created' | 'edited' | 'deleted' | 'renamed'
  oldText?: string
  newText?: string
  binary: boolean
  truncated: boolean
}

export type GitReview = GitInfo & {
  files: GitReviewFile[]
  filesTruncated: boolean
}

type PorcelainEntry = {
  status: string
  path: string
  oldPath?: string
}

async function runGit(cwd: string, args: string[]): Promise<Uint8Array | null> {
  try {
    const proc = Bun.spawn(['git', '-c', 'safe.directory=*', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdoutPromise = new Response(proc.stdout).arrayBuffer()
    const stderrPromise = new Response(proc.stderr).arrayBuffer()
    const [stdout, exitCode] = await Promise.all([stdoutPromise, proc.exited, stderrPromise])
    return exitCode === 0 ? new Uint8Array(stdout as ArrayBuffer) : null
  } catch {
    return null
  }
}

function decode(bytes: Uint8Array | null): string | null {
  if (!bytes) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function normalizeReviewText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function parsePorcelain(text: string): PorcelainEntry[] {
  const parts = text.split('\0')
  const entries: PorcelainEntry[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index]
    if (!item || item.length < 4) continue
    const status = item.slice(0, 2)
    const filePath = item.slice(3)
    if (!filePath) continue
    if (status.includes('R') || status.includes('C')) {
      const oldPath = parts[index + 1]
      index += 1
      entries.push({ status, path: filePath, ...(oldPath ? { oldPath } : {}) })
    } else {
      entries.push({ status, path: filePath })
    }
  }
  return entries
}

function getKind(status: string): GitReviewFile['kind'] {
  if (status === '??' || status.includes('A')) return 'created'
  if (status.includes('D')) return 'deleted'
  if (status.includes('R') || status.includes('C')) return 'renamed'
  return 'edited'
}

function toGitPath(value: string): string {
  return value.split(path.sep).join('/')
}

function getRepoName(remote: string | null, repoRoot: string): string {
  const normalized = remote?.trim().replace(/[\\/]$/, '').replace(/\.git$/, '') ?? ''
  const match = normalized.match(/(?:[/:])([^/:]+)$/)
  return match?.[1] || path.basename(repoRoot)
}

async function readWorktreeText(filePath: string): Promise<{
  text?: string
  binary: boolean
  truncated: boolean
}> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return { binary: true, truncated: false }
    const truncated = stat.size > MAX_TEXT_BYTES
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_TEXT_BYTES))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.includes(0)) return { binary: true, truncated }
      const text = decode(bytes)
      return text === null
        ? { binary: true, truncated }
        : { text: normalizeReviewText(text), binary: false, truncated }
    } finally {
      await handle.close()
    }
  } catch {
    return { binary: false, truncated: false, text: '' }
  }
}

async function readHeadText(repoRoot: string, repoPath: string): Promise<{
  text?: string
  binary: boolean
  truncated: boolean
}> {
  const sizeText = decode(await runGit(repoRoot, ['cat-file', '-s', `HEAD:${repoPath}`]))?.trim()
  if (!sizeText) return { text: '', binary: false, truncated: false }
  const size = Number(sizeText)
  if (!Number.isSafeInteger(size) || size < 0) return { text: '', binary: false, truncated: true }
  if (size > MAX_TEXT_BYTES) {
    return { binary: false, truncated: true }
  }
  const bytes = await runGit(repoRoot, ['show', `HEAD:${repoPath}`])
  if (!bytes) return { text: '', binary: false, truncated: false }
  if (bytes.includes(0)) return { binary: true, truncated: false }
  const text = decode(bytes)
  return text === null
    ? { binary: true, truncated: false }
    : { text: normalizeReviewText(text), binary: false, truncated: false }
}

export async function getGitInfoForWorkDir(workDir: string): Promise<GitInfo> {
  const repoRoot = decode(await runGit(workDir, ['rev-parse', '--show-toplevel']))?.trim() || null
  if (!repoRoot) {
    return {
      isGit: false,
      branch: null,
      repoName: null,
      repoRoot: null,
      workDir,
      changedFiles: 0,
    }
  }

  const [branchText, remoteText, statusText] = await Promise.all([
    runGit(workDir, ['rev-parse', '--abbrev-ref', 'HEAD']).then(decode),
    runGit(workDir, ['remote', 'get-url', 'origin']).then(decode),
    runGit(workDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']).then(decode),
  ])
  const entries = parsePorcelain(statusText ?? '')
  return {
    isGit: true,
    branch: branchText?.trim() || null,
    repoName: getRepoName(remoteText, repoRoot),
    repoRoot,
    workDir,
    changedFiles: entries.length,
  }
}

export async function getGitReviewForWorkDir(
  workDir: string,
  selectedPath?: string | null,
): Promise<GitReview> {
  const info = await getGitInfoForWorkDir(workDir)
  if (!info.isGit || !info.repoRoot) {
    return { ...info, files: [], filesTruncated: false }
  }

  const statusText = decode(await runGit(workDir, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    '.',
  ])) ?? ''
  const canonicalRepoRoot = await fs.realpath(info.repoRoot).catch(() => info.repoRoot!)
  const canonicalWorkDir = await fs.realpath(workDir).catch(() => workDir)
  const scopePath = path.relative(canonicalRepoRoot, canonicalWorkDir)
  const entries = parsePorcelain(statusText)
  const files: GitReviewFile[] = []
  for (const entry of entries.slice(0, MAX_REVIEW_FILES)) {
    const kind = getKind(entry.status)
    if (entry.path !== selectedPath) {
      files.push({
        path: entry.path,
        ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        status: entry.status,
        kind,
        binary: false,
        truncated: false,
      })
      continue
    }

    const oldRepoPath = toGitPath(path.join(scopePath, entry.oldPath ?? entry.path))
    const currentPath = path.resolve(workDir, entry.path)
    const oldVersion = kind === 'created'
      ? { text: '', binary: false, truncated: false }
      : await readHeadText(canonicalRepoRoot, oldRepoPath)
    const newVersion = kind === 'deleted'
      ? { text: '', binary: false, truncated: false }
      : await readWorktreeText(currentPath)
    const binary = oldVersion.binary || newVersion.binary

    files.push({
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: entry.status,
      kind,
      ...(!binary ? { oldText: oldVersion.text ?? '', newText: newVersion.text ?? '' } : {}),
      binary,
      truncated: oldVersion.truncated || newVersion.truncated,
    })
  }

  return {
    ...info,
    files,
    filesTruncated: entries.length > MAX_REVIEW_FILES,
  }
}

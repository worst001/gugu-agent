import { randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { mkdir, open, readdir, readFile, rename } from 'fs/promises'
import { join } from 'path'
import type {
  ProvenancePack,
  SourceLocator,
  SourceRef,
} from '../types.js'

function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isSourceLocator(value: unknown): value is SourceLocator {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'file':
      return isNonEmptyString(value.path) && isNonEmptyString(value.toolUseId)
    case 'attachment':
      return (
        isNonEmptyString(value.messageId) &&
        Number.isInteger(value.attachmentIndex) &&
        Number(value.attachmentIndex) >= 0 &&
        (value.path === undefined || isNonEmptyString(value.path))
      )
    case 'message':
      return isNonEmptyString(value.messageId)
    case 'tool_result':
      return (
        isNonEmptyString(value.toolUseId) &&
        (value.messageId === undefined || isNonEmptyString(value.messageId))
      )
    case 'url':
      return isNonEmptyString(value.url) && isNonEmptyString(value.toolUseId)
    default:
      return false
  }
}

function isSourceRef(value: unknown): value is SourceRef {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.title) &&
    isSourceLocator(value.locator) &&
    isNonEmptyString(value.observedAt) &&
    (value.contentHash === undefined || isNonEmptyString(value.contentHash)) &&
    (value.excerpt === undefined || typeof value.excerpt === 'string')
  )
}

function isProvenancePack(value: unknown): value is ProvenancePack {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.runId) &&
    Number.isInteger(value.attempt) &&
    Number(value.attempt) > 0 &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.createdAt) &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.every(
      (source) => isSourceRef(source) && source.sessionId === value.sessionId,
    )
  )
}

export class AgentTaskProvenanceStore {
  constructor(private readonly rootDir: string) {}

  getProvenanceDir(taskId: string): string {
    return join(
      this.rootDir,
      sanitizePathComponent(taskId),
      'provenance',
    )
  }

  getProvenancePath(taskId: string, provenancePackId: string): string {
    return join(
      this.getProvenanceDir(taskId),
      `${sanitizePathComponent(provenancePackId)}.json`,
    )
  }

  async persist(pack: ProvenancePack): Promise<void> {
    const dir = this.getProvenanceDir(pack.taskId)
    await mkdir(dir, { recursive: true })
    const path = this.getProvenancePath(pack.taskId, pack.id)
    const tempPath = `${path}.${randomUUID()}.tmp`
    const handle = await open(tempPath, 'wx')
    try {
      await handle.writeFile(`${JSON.stringify(pack, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, path)
  }

  async readLatest(
    taskId: string,
    runId: string,
    attempt: number,
  ): Promise<ProvenancePack | null> {
    const dir = this.getProvenanceDir(taskId)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    }

    const packs: ProvenancePack[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = join(dir, entry.name)
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!isProvenancePack(parsed)) {
        throw new Error(`Invalid Provenance Pack: ${entry.name}`)
      }
      if (parsed.taskId !== taskId) {
        throw new Error(
          `Provenance Pack ${parsed.id} does not belong to task ${taskId}`,
        )
      }
      if (parsed.runId === runId && parsed.attempt === attempt) {
        packs.push(parsed)
      }
    }

    return packs.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
    )[0] ?? null
  }
}

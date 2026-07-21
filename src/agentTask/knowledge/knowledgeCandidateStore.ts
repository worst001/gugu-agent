import { randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { mkdir, open, readdir, readFile, rename } from 'fs/promises'
import { join } from 'path'
import type {
  KnowledgeCandidate,
  KnowledgeCandidatePack,
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

function isKnowledgeCandidate(value: unknown): value is KnowledgeCandidate {
  if (!isRecord(value)) return false
  return (
    isNonEmptyString(value.id) &&
    (value.kind === 'task_outcome' || value.kind === 'review_finding') &&
    value.state === 'pending' &&
    isNonEmptyString(value.text) &&
    isNonEmptyString(value.createdAt)
  )
}

function isKnowledgeCandidatePack(
  value: unknown,
): value is KnowledgeCandidatePack {
  if (!isRecord(value)) return false
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.runId) &&
    Number.isInteger(value.attempt) &&
    Number(value.attempt) > 0 &&
    isNonEmptyString(value.workspaceId) &&
    (value.sessionId === undefined || isNonEmptyString(value.sessionId)) &&
    isNonEmptyString(value.evidencePackId) &&
    (
      value.provenancePackId === undefined ||
      isNonEmptyString(value.provenancePackId)
    ) &&
    Array.isArray(value.artifactPaths) &&
    value.artifactPaths.every(isNonEmptyString) &&
    isNonEmptyString(value.createdAt) &&
    Array.isArray(value.candidates) &&
    value.candidates.length > 0 &&
    value.candidates.every(isKnowledgeCandidate)
  )
}

export class AgentTaskKnowledgeCandidateStore {
  constructor(private readonly rootDir: string) {}

  getCandidateDir(taskId: string): string {
    return join(
      this.rootDir,
      sanitizePathComponent(taskId),
      'knowledge-candidates',
    )
  }

  getCandidatePath(taskId: string, packId: string): string {
    return join(
      this.getCandidateDir(taskId),
      `${sanitizePathComponent(packId)}.json`,
    )
  }

  async persist(pack: KnowledgeCandidatePack): Promise<void> {
    const dir = this.getCandidateDir(pack.taskId)
    await mkdir(dir, { recursive: true })
    const path = this.getCandidatePath(pack.taskId, pack.id)
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
  ): Promise<KnowledgeCandidatePack | null> {
    const dir = this.getCandidateDir(taskId)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    }

    const packs: KnowledgeCandidatePack[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const parsed = JSON.parse(
        await readFile(join(dir, entry.name), 'utf8'),
      ) as unknown
      if (!isKnowledgeCandidatePack(parsed)) {
        throw new Error(`Invalid Knowledge Candidate Pack: ${entry.name}`)
      }
      if (parsed.taskId !== taskId) {
        throw new Error(
          `Knowledge Candidate Pack ${parsed.id} does not belong to task ${taskId}`,
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

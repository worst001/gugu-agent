import { randomUUID } from 'crypto'
import { mkdir, open, readFile, rename } from 'fs/promises'
import { join } from 'path'
import type { EvidencePack } from '../types.js'

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

function isEvidencePack(value: unknown): value is EvidencePack {
  if (!value || typeof value !== 'object') return false
  const evidence = value as Partial<EvidencePack>
  return (
    evidence.schemaVersion === 1 &&
    typeof evidence.id === 'string' &&
    typeof evidence.taskId === 'string' &&
    typeof evidence.runId === 'string' &&
    typeof evidence.attempt === 'number' &&
    typeof evidence.createdAt === 'string' &&
    Array.isArray(evidence.checks) &&
    Array.isArray(evidence.changedFiles) &&
    Array.isArray(evidence.artifacts)
  )
}

export class AgentTaskEvidenceStore {
  constructor(private readonly rootDir: string) {}

  getEvidenceDir(taskId: string): string {
    return join(
      this.rootDir,
      sanitizePathComponent(taskId),
      'evidence',
    )
  }

  getEvidencePath(taskId: string, evidencePackId: string): string {
    return join(
      this.getEvidenceDir(taskId),
      `${sanitizePathComponent(evidencePackId)}.json`,
    )
  }

  async persist(evidence: EvidencePack): Promise<void> {
    const dir = this.getEvidenceDir(evidence.taskId)
    await mkdir(dir, { recursive: true })
    const path = this.getEvidencePath(evidence.taskId, evidence.id)
    const tempPath = `${path}.${randomUUID()}.tmp`
    const handle = await open(tempPath, 'wx')
    try {
      await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tempPath, path)
  }

  async read(
    taskId: string,
    evidencePackId: string,
  ): Promise<EvidencePack | null> {
    try {
      const parsed = JSON.parse(
        await readFile(
          this.getEvidencePath(taskId, evidencePackId),
          'utf8',
        ),
      ) as unknown
      if (!isEvidencePack(parsed)) {
        throw new Error(`Invalid Evidence Pack: ${evidencePackId}`)
      }
      return parsed
    } catch (error) {
      if (isErrno(error, 'ENOENT')) return null
      throw error
    }
  }
}
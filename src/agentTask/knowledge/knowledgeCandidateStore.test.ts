import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { KnowledgeCandidatePack } from '../types.js'
import { AgentTaskKnowledgeCandidateStore } from './knowledgeCandidateStore.js'

let rootDir: string

function pack(
  overrides: Partial<KnowledgeCandidatePack> = {},
): KnowledgeCandidatePack {
  return {
    schemaVersion: 1,
    id: 'candidate-pack-1',
    taskId: 'task-1',
    runId: 'run-1',
    attempt: 1,
    workspaceId: 'ws_v1_abc',
    evidencePackId: 'evidence-1',
    artifactPaths: [],
    createdAt: '2026-07-17T00:00:00.000Z',
    candidates: [
      {
        id: 'candidate-1',
        kind: 'task_outcome',
        state: 'pending',
        text: 'Implemented the bounded fix.',
        createdAt: '2026-07-17T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'knowledge-candidate-store-test-'))
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

describe('AgentTaskKnowledgeCandidateStore', () => {
  it('returns the latest Pack for the requested run and attempt', async () => {
    const store = new AgentTaskKnowledgeCandidateStore(rootDir)
    await store.persist(pack())
    await store.persist(pack({
      id: 'candidate-pack-2',
      createdAt: '2026-07-17T00:01:00.000Z',
    }))
    await store.persist(pack({
      id: 'candidate-pack-old-attempt',
      attempt: 2,
      createdAt: '2026-07-17T00:02:00.000Z',
    }))

    expect(await store.readLatest('task-1', 'run-1', 1)).toEqual(pack({
      id: 'candidate-pack-2',
      createdAt: '2026-07-17T00:01:00.000Z',
    }))
  })

  it('rejects cross-task Packs instead of hiding corruption', async () => {
    const store = new AgentTaskKnowledgeCandidateStore(rootDir)
    const dir = store.getCandidateDir('task-1')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'foreign.json'),
      JSON.stringify(pack({ id: 'foreign', taskId: 'task-2' })),
      'utf8',
    )

    await expect(store.readLatest('task-1', 'run-1', 1))
      .rejects.toThrow('does not belong to task task-1')
  })
})

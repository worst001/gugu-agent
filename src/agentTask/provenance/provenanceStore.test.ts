import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ProvenancePack } from '../types.js'
import { AgentTaskProvenanceStore } from './provenanceStore.js'

let rootDir: string

function pack(overrides: Partial<ProvenancePack> = {}): ProvenancePack {
  return {
    schemaVersion: 1,
    id: 'pack-1',
    taskId: 'task-1',
    runId: 'run-1',
    attempt: 1,
    workspaceId: 'ws_v1_abc',
    sessionId: 'session-1',
    createdAt: '2026-07-17T00:00:00.000Z',
    sources: [
      {
        id: 'source-1',
        sessionId: 'session-1',
        title: 'facts.md',
        locator: { kind: 'message', messageId: 'message-1' },
        observedAt: '2026-07-17T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'provenance-store-test-'))
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
})

describe('AgentTaskProvenanceStore', () => {
  it('returns the latest valid pack for the requested run and attempt', async () => {
    const store = new AgentTaskProvenanceStore(rootDir)
    await store.persist(pack())
    await store.persist(pack({
      id: 'pack-2',
      createdAt: '2026-07-17T00:01:00.000Z',
    }))
    await store.persist(pack({
      id: 'pack-old-attempt',
      attempt: 2,
      createdAt: '2026-07-17T00:02:00.000Z',
    }))

    expect(await store.readLatest('task-1', 'run-1', 1))
      .toEqual(pack({
        id: 'pack-2',
        createdAt: '2026-07-17T00:01:00.000Z',
      }))
  })

  it('rejects malformed or cross-task packs instead of hiding corruption', async () => {
    const store = new AgentTaskProvenanceStore(rootDir)
    const dir = store.getProvenanceDir('task-1')
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

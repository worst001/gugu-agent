import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { checkReadableInternalPath } from './filesystem.js'

describe('checkReadableInternalPath bundled agent pack reads', () => {
  const originalPackDir = process.env.GUGU_AGENT_PACK_DIR
  const tempDirs: string[] = []

  afterEach(async () => {
    if (originalPackDir === undefined) {
      delete process.env.GUGU_AGENT_PACK_DIR
    } else {
      process.env.GUGU_AGENT_PACK_DIR = originalPackDir
    }

    await Promise.all(
      tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
    )
  })

  test('allows reads from the configured bundled agent pack root', async () => {
    const packDir = await createBundledAgentPack()
    process.env.GUGU_AGENT_PACK_DIR = packDir

    const result = checkReadableInternalPath(
      join(packDir, 'word-master', 'SKILL.md'),
      {},
    )

    expect(result.behavior).toBe('allow')
    expect(result.decisionReason).toMatchObject({
      type: 'other',
      reason: 'Bundled agent pack files are allowed for reading',
    })
  })

  test('does not allow reads from a sibling path with a similar name', async () => {
    const packDir = await createBundledAgentPack()
    const siblingDir = await mkdtemp(join(tmpdir(), 'gugu-agent-pack-sibling-'))
    tempDirs.push(siblingDir)
    process.env.GUGU_AGENT_PACK_DIR = packDir

    const result = checkReadableInternalPath(
      join(siblingDir, 'word-master', 'SKILL.md'),
      {},
    )

    expect(result.behavior).toBe('passthrough')
  })

  test('requires the configured pack root to contain the bundled skill sentinel', async () => {
    const packDir = await mkdtemp(join(tmpdir(), 'gugu-agent-pack-missing-'))
    tempDirs.push(packDir)
    process.env.GUGU_AGENT_PACK_DIR = packDir

    const result = checkReadableInternalPath(
      join(packDir, 'word-master', 'SKILL.md'),
      {},
    )

    expect(result.behavior).toBe('passthrough')
  })

  async function createBundledAgentPack(): Promise<string> {
    const packDir = await mkdtemp(join(tmpdir(), 'gugu-agent-pack-'))
    tempDirs.push(packDir)
    const sentinelDir = join(packDir, 'api-and-interface-design')
    await mkdir(sentinelDir, { recursive: true })
    await writeFile(join(sentinelDir, 'SKILL.md'), '# API Skill\n')
    return packDir
  }
})

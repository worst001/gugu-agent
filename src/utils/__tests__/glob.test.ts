import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, normalize } from 'path'
import { globWithNodeFallback } from '../glob.js'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gugu-glob-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('globWithNodeFallback', () => {
  test('matches basename patterns across nested directories', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'index.ts'), '')
    await writeFile(join(root, 'src', 'nested.ts'), '')
    await writeFile(join(root, 'notes.md'), '')

    const result = await globWithNodeFallback(
      '*.ts',
      root,
      { limit: 10, offset: 0 },
      new AbortController().signal,
      [],
      true,
    )

    expect(result.files.map(path => normalize(path)).sort()).toEqual(
      [join(root, 'index.ts'), join(root, 'src', 'nested.ts')]
        .map(path => normalize(path))
        .sort(),
    )
    expect(result.truncated).toBe(false)
  })

  test('honors hidden and ignore patterns', async () => {
    const root = await makeTempDir()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, '.hidden.ts'), '')
    await writeFile(join(root, 'visible.ts'), '')
    await writeFile(join(root, 'src', 'ignored.ts'), '')

    const result = await globWithNodeFallback(
      '*.ts',
      root,
      { limit: 10, offset: 0 },
      new AbortController().signal,
      ['src/**'],
      false,
    )

    expect(result.files.map(path => normalize(path))).toEqual([
      normalize(join(root, 'visible.ts')),
    ])
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  getGitInfoForWorkDir,
  getGitReviewForWorkDir,
} from '../services/gitReviewService.js'

const cleanupDirs: string[] = []

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
  ])
  const exitCode = await proc.exited
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`)
}

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('git review service', () => {
  it('reports non-Git workspaces without review files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-non-git-'))
    cleanupDirs.push(root)

    expect(await getGitInfoForWorkDir(root)).toMatchObject({
      isGit: false,
      changedFiles: 0,
    })
    expect((await getGitReviewForWorkDir(root)).files).toEqual([])
  })

  it('reads created, edited, deleted, and renamed files from Git', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-git-review-'))
    cleanupDirs.push(root)
    await git(root, 'init')
    await fs.writeFile(path.join(root, 'edited.txt'), 'before\n')
    await fs.writeFile(path.join(root, 'deleted.txt'), 'remove me\n')
    await fs.writeFile(path.join(root, 'old-name.txt'), 'rename me\n')
    await git(root, 'add', '.')
    await git(root, '-c', 'user.name=Gugu', '-c', 'user.email=gugu@example.com', 'commit', '-m', 'initial')

    await fs.writeFile(path.join(root, 'edited.txt'), 'after\n')
    await fs.rm(path.join(root, 'deleted.txt'))
    await fs.rename(path.join(root, 'old-name.txt'), path.join(root, 'new-name.txt'))
    await fs.writeFile(path.join(root, 'created.txt'), 'new file\n')
    await git(root, 'add', '-A')

    const summary = await getGitReviewForWorkDir(root)
    expect(summary.isGit).toBe(true)
    expect(summary.files.every((file) => file.oldText === undefined && file.newText === undefined))
      .toBe(true)
    const review = await getGitReviewForWorkDir(root, 'edited.txt')
    expect(review.files.find((file) => file.path === 'edited.txt')).toMatchObject({
      kind: 'edited',
      oldText: 'before\n',
      newText: 'after\n',
    })
    const deletedReview = await getGitReviewForWorkDir(root, 'deleted.txt')
    expect(deletedReview.files.find((file) => file.path === 'deleted.txt')).toMatchObject({
      kind: 'deleted',
      oldText: 'remove me\n',
      newText: '',
    })
    const createdReview = await getGitReviewForWorkDir(root, 'created.txt')
    expect(createdReview.files.find((file) => file.path === 'created.txt')).toMatchObject({
      kind: 'created',
      oldText: '',
      newText: 'new file\n',
    })
    const renamedReview = await getGitReviewForWorkDir(root, 'new-name.txt')
    expect(renamedReview.files.find((file) => file.path === 'new-name.txt')).toMatchObject({
      kind: 'renamed',
      oldPath: 'old-name.txt',
      oldText: 'rename me\n',
      newText: 'rename me\n',
    })
  })
})

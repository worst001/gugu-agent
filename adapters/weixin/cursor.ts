import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

type StoredCursor = {
  accountId: string
  cursor: string
}

function cursorPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'weixin', 'cursor.json')
}

export async function loadCursor(accountId: string): Promise<string> {
  try {
    const stored = JSON.parse(
      await fs.readFile(cursorPath(), 'utf-8'),
    ) as Partial<StoredCursor>
    return (
      typeof stored.accountId === 'string'
      && typeof stored.cursor === 'string'
      && stored.accountId === accountId
    ) ? stored.cursor : ''
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    if (error instanceof SyntaxError) return ''
    throw error
  }
}

export async function saveCursor(
  accountId: string,
  cursor: string,
): Promise<void> {
  const filePath = cursorPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`
  try {
    await fs.writeFile(
      temporaryPath,
      JSON.stringify({ accountId, cursor }, null, 2),
      { mode: 0o600 },
    )
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch(() => {})
  }
}

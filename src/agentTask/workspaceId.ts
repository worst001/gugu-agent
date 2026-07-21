import { createHash } from 'crypto'
import { resolve } from 'path'
import { normalizePathForConfigKey } from '../utils/path.js'
import { canonicalizePath } from '../utils/sessionStoragePortable.js'

export async function deriveWorkspaceId(workspacePath: string): Promise<string> {
  const path = workspacePath.trim()
  if (!path) throw new Error('workspacePath is required')

  const canonicalPath = normalizePathForConfigKey(
    await canonicalizePath(resolve(path)),
  )
  const identityPath = process.platform === 'win32'
    ? canonicalPath.toLowerCase()
    : canonicalPath
  const hash = createHash('sha256').update(identityPath).digest('hex')
  return `ws_v1_${hash}`
}
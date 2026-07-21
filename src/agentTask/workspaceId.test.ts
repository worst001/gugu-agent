import { describe, expect, it } from 'bun:test'
import { join } from 'path'
import { deriveWorkspaceId } from './workspaceId.js'

describe('deriveWorkspaceId', () => {
  it('returns one opaque ID for equivalent workspace paths', async () => {
    const workspacePath = process.cwd()
    const direct = await deriveWorkspaceId(workspacePath)
    const dotted = await deriveWorkspaceId(join(workspacePath, '.'))

    expect(direct).toBe(dotted)
    expect(direct).toMatch(/^ws_v1_[a-f0-9]{64}$/)
    expect(direct).not.toContain(workspacePath)
    await expect(deriveWorkspaceId('  ')).rejects.toThrow(
      'workspacePath is required',
    )
  })
})
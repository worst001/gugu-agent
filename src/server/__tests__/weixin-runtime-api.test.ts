import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { adapterService } from '../services/adapterService.js'

describe('WeChat runtime API', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-runtime-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('disconnect succeeds after credential deletion even if metadata cleanup fails', async () => {
    const credentialDir = path.join(tmpDir, 'weixin')
    await fs.mkdir(credentialDir, { recursive: true })
    await fs.writeFile(
      path.join(credentialDir, 'credentials.json'),
      JSON.stringify({
        accountId: 'bot-1',
        token: 'secret',
        baseUrl: 'https://ilinkai.weixin.qq.com',
      }),
    )

    const originalUpdateConfig = adapterService.updateConfig
    adapterService.updateConfig = async () => {
      throw new Error('simulated metadata failure')
    }
    try {
      const connectionUrl = new URL(
        'http://127.0.0.1:3456/api/adapters/weixin/connection',
      )
      const response = await handleApiRequest(
        new Request(connectionUrl, { method: 'DELETE' }),
        connectionUrl,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        ok: true,
        metadataCleaned: false,
      })
      await expect(fs.access(path.join(credentialDir, 'credentials.json')))
        .rejects.toThrow()
    } finally {
      adapterService.updateConfig = originalUpdateConfig
    }
  })

  test('validates heartbeat input and exposes it without credentials', async () => {
    const runtimeUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/weixin/runtime',
    )
    const invalid = await handleApiRequest(
      new Request(runtimeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'unknown' }),
      }),
      runtimeUrl,
    )
    expect(invalid.status).toBe(400)

    const heartbeat = await handleApiRequest(
      new Request(runtimeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'online', lastPollAt: 123 }),
      }),
      runtimeUrl,
    )
    expect(heartbeat.status).toBe(200)

    const connectionUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/weixin/connection',
    )
    const connection = await handleApiRequest(
      new Request(connectionUrl),
      connectionUrl,
    )
    expect(await connection.json()).toEqual({
      connected: false,
      accountId: null,
      runtime: { state: 'online', lastPollAt: 123, error: null },
    })
  })
})

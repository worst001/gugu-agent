import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { feishuInstallService } from '../services/feishuInstallService.js'

describe('Feishu installation API', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-feishu-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    feishuInstallService.resetForTests()
  })

  afterEach(async () => {
    feishuInstallService.resetForTests()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('starts, reads and cancels a QR installation through adapter routes', async () => {
    feishuInstallService.setRegisterAppFn((options) => {
      options.onQRCodeReady({
        url: 'https://open.feishu.cn/page/launcher?user_code=api-code',
        expireIn: 600,
      })
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('cancelled'), { code: 'abort' }))
        })
      })
    })

    const startUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/feishu/installations',
    )
    const startResponse = await handleApiRequest(
      new Request(startUrl, { method: 'POST' }),
      startUrl,
    )
    expect(startResponse.status).toBe(201)
    const started = await startResponse.json() as Record<string, any>
    expect(started.state).toBe('waiting')
    expect(started.qrCodeDataUrl).toStartWith('data:image/png;base64,')
    expect(JSON.stringify(started)).not.toContain('api-secret')

    const statusUrl = new URL(`${startUrl}/${started.installationId}`)
    const statusResponse = await handleApiRequest(new Request(statusUrl), statusUrl)
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json() as Record<string, any>).state)
      .toBe('waiting')

    const cancelResponse = await handleApiRequest(
      new Request(statusUrl, { method: 'DELETE' }),
      statusUrl,
    )
    expect(cancelResponse.status).toBe(200)
    expect((await cancelResponse.json() as Record<string, any>).state)
      .toBe('cancelled')
  })

  test('reports and disconnects an authorized Feishu application', async () => {
    let finishRegistration!: (result: {
      client_id: string
      client_secret: string
      user_info: { open_id: string }
    }) => void
    feishuInstallService.setRegisterAppFn((options) => {
      options.onQRCodeReady({
        url: 'https://open.feishu.cn/page/launcher?user_code=api-test',
        expireIn: 600,
      })
      return new Promise((resolve) => {
        finishRegistration = resolve
      })
    })

    const startUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/feishu/installations',
    )
    const startedResponse = await handleApiRequest(
      new Request(startUrl, { method: 'POST' }),
      startUrl,
    )
    const started = await startedResponse.json() as Record<string, any>
    finishRegistration({
      client_id: 'cli_api',
      client_secret: 'api-secret',
      user_info: { open_id: 'ou_api' },
    })
    await waitForAuthorized(startUrl, started.installationId)

    const connectionUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/feishu/connection',
    )
    const connectionResponse = await handleApiRequest(
      new Request(connectionUrl),
      connectionUrl,
    )
    expect(await connectionResponse.json()).toEqual({
      connected: true,
      appId: 'cli_api',
    })

    const disconnectResponse = await handleApiRequest(
      new Request(connectionUrl, { method: 'DELETE' }),
      connectionUrl,
    )
    expect(disconnectResponse.status).toBe(200)

    const disconnectedResponse = await handleApiRequest(
      new Request(connectionUrl),
      connectionUrl,
    )
    expect(await disconnectedResponse.json()).toEqual({
      connected: false,
      appId: null,
    })
    const config = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'adapters.json'), 'utf-8'),
    )
    expect(config.feishu.pairedUsers).toEqual([])
    expect(config.feishu.appId).toBeUndefined()
    expect(config.feishu.appSecret).toBeUndefined()
  })
})

async function waitForAuthorized(
  startUrl: URL,
  installationId: string,
): Promise<void> {
  const statusUrl = new URL(`${startUrl}/${installationId}`)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await handleApiRequest(new Request(statusUrl), statusUrl)
    const status = await response.json() as Record<string, any>
    if (status.state === 'authorized') return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for Feishu authorization')
}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  FeishuInstallService,
  type FeishuInstallationStatus,
} from '../services/feishuInstallService.js'
import { adapterService } from '../services/adapterService.js'

describe('FeishuInstallService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: FeishuInstallService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-feishu-install-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new FeishuInstallService()
  })

  afterEach(async () => {
    service.resetForTests()
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('returns a QR, browser fallback, and the existing adapter capabilities', async () => {
    let capturedOptions: Record<string, any> | undefined
    service.setRegisterAppFn(async (options) => {
      capturedOptions = options
      options.onQRCodeReady({
        url: 'https://open.feishu.cn/page/launcher?user_code=provider-secret',
        expireIn: 600,
      })
      return await new Promise(() => {})
    })

    const status = await service.startInstallation()

    expect(status.state).toBe('waiting')
    expect(status.qrCodeDataUrl).toStartWith('data:image/png;base64,')
    expect(status.authorizationUrl).toBe('https://open.feishu.cn/page/launcher?user_code=provider-secret')
    expect(capturedOptions?.createOnly).toBe(true)
    expect(capturedOptions?.addons.scopes.tenant).toContain(
      'im:message:send_as_bot',
    )
    expect(capturedOptions?.addons.events.items.tenant).toContain(
      'im.message.receive_v1',
    )
    expect(capturedOptions?.addons.callbacks.items).toContain(
      'card.action.trigger',
    )
  })

  test('rejects non-Feishu authorization URLs', async () => {
    service.setRegisterAppFn(async (options) => {
      options.onQRCodeReady({
        url: 'https://example.com/device?code=untrusted',
        expireIn: 600,
      })
      return await new Promise(() => {})
    })

    await expect(service.startInstallation()).rejects.toThrow('不受信任')
  })

  test('stores credentials and pairs only the scanner after authorization', async () => {
    let finishRegistration!: (result: {
      client_id: string
      client_secret: string
      user_info: { open_id: string; tenant_brand: 'feishu' }
    }) => void
    service.setRegisterAppFn((options) => {
      options.onQRCodeReady({
        url: 'https://open.feishu.cn/page/launcher?user_code=test',
        expireIn: 600,
      })
      return new Promise((resolve) => {
        finishRegistration = resolve
      })
    })

    const started = await service.startInstallation()
    finishRegistration({
      client_id: 'cli_gugu',
      client_secret: 'feishu-secret',
      user_info: { open_id: 'ou_scanner', tenant_brand: 'feishu' },
    })
    const status = await waitForState(
      service,
      started.installationId,
      'authorized',
    )

    expect(status).toEqual(expect.objectContaining({
      state: 'authorized',
      appId: 'cli_gugu',
    }))
    expect(JSON.stringify(status)).not.toContain('feishu-secret')

    const config = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'adapters.json'), 'utf-8'),
    )
    expect(config.feishu).toEqual(expect.objectContaining({
      appId: 'cli_gugu',
      appSecret: 'feishu-secret',
      allowedUsers: [],
      pairedUsers: [
        expect.objectContaining({ userId: 'ou_scanner' }),
      ],
    }))
  })

  test('cancels an in-flight authorization without restoring credentials', async () => {
    let finishRegistration!: (result: {
      client_id: string
      client_secret: string
      user_info: { open_id: string; tenant_brand: 'feishu' }
    }) => void
    let releaseFirstWrite!: () => void
    let updateCalls = 0
    const originalUpdateConfig = adapterService.updateConfig.bind(adapterService)
    adapterService.updateConfig = async (patch) => {
      updateCalls += 1
      if (updateCalls === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve
        })
      }
      await originalUpdateConfig(patch)
    }

    try {
      service.setRegisterAppFn((options) => {
        options.onQRCodeReady({
          url: 'https://open.feishu.cn/page/launcher?user_code=test',
          expireIn: 600,
        })
        return new Promise((resolve) => {
          finishRegistration = resolve
        })
      })

      const started = await service.startInstallation()
      finishRegistration({
        client_id: 'cli_cancelled',
        client_secret: 'cancelled-secret',
        user_info: { open_id: 'ou_scanner', tenant_brand: 'feishu' },
      })
      await waitForState(service, started.installationId, 'authorizing')
      expect(service.cancelInstallation(started.installationId).state).toBe('cancelled')
      releaseFirstWrite()

      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (updateCalls >= 2 && !(await service.getConnection()).connected) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(updateCalls).toBe(2)
      expect((await service.getConnection()).connected).toBe(false)
      expect(service.getInstallation(started.installationId).state).toBe('cancelled')
    } finally {
      adapterService.updateConfig = originalUpdateConfig
    }
  })

  test('does not open access when Feishu omits the scanner identity', async () => {
    let finishRegistration!: (result: {
      client_id: string
      client_secret: string
    }) => void
    service.setRegisterAppFn((options) => {
      options.onQRCodeReady({
        url: 'https://open.feishu.cn/page/launcher?user_code=test',
        expireIn: 600,
      })
      return new Promise((resolve) => {
        finishRegistration = resolve
      })
    })

    const started = await service.startInstallation()
    finishRegistration({
      client_id: 'cli_gugu',
      client_secret: 'feishu-secret',
    })
    const status = await waitForState(
      service,
      started.installationId,
      'failed',
    )

    expect(status.error).toContain('扫码者身份')
    await expect(fs.readFile(path.join(tmpDir, 'adapters.json'), 'utf-8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function waitForState(
  service: FeishuInstallService,
  installationId: string,
  state: FeishuInstallationStatus['state'],
): Promise<FeishuInstallationStatus> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = service.getInstallation(installationId)
    if (status.state === state) return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for Feishu installation state: ${state}`)
}

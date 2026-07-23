import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { WeixinInstallService } from '../services/weixinInstallService.js'

describe('WeixinInstallService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: WeixinInstallService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-install-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new WeixinInstallService()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('starts a QR installation without exposing the provider QR ticket', async () => {
    service.setFetchFn(async () => Response.json({
      qrcode: 'provider-secret-ticket',
      qrcode_img_content: 'https://weixin.qq.com/x/connect-test',
    }))

    const status = await service.startInstallation()

    expect(status.state).toBe('waiting')
    expect(status.qrCodeDataUrl).toStartWith('data:image/png;base64,')
    expect(JSON.stringify(status)).not.toContain('provider-secret-ticket')
  })

  test('submits a numeric verification code on the next status poll', async () => {
    const requests: string[] = []
    service.setFetchFn(async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('get_bot_qrcode')) {
        return Response.json({
          qrcode: 'ticket-1',
          qrcode_img_content: 'https://weixin.qq.com/x/connect-test',
        })
      }
      if (!url.includes('verify_code=')) {
        return Response.json({ status: 'need_verifycode' })
      }
      return Response.json({ status: 'scaned' })
    })

    const started = await service.startInstallation()
    expect((await service.getInstallation(started.installationId)).state)
      .toBe('needs_verification')

    await expect(service.submitVerification(started.installationId, 'abc'))
      .rejects.toThrow('numeric')
    await service.submitVerification(started.installationId, '123456')

    expect((await service.getInstallation(started.installationId)).state)
      .toBe('scanned')
    expect(requests.at(-1)).toContain('verify_code=123456')
  })

  test('stores confirmed credentials outside adapters.json and pairs the scanner', async () => {
    service.setFetchFn(async (input) => {
      if (String(input).includes('get_bot_qrcode')) {
        return Response.json({
          qrcode: 'ticket-2',
          qrcode_img_content: 'https://weixin.qq.com/x/connect-test',
        })
      }
      return Response.json({
        status: 'confirmed',
        bot_token: 'weixin-bot-secret',
        ilink_bot_id: 'bot-123',
        ilink_user_id: 'user-456',
        baseurl: 'https://example.weixin.qq.com',
      })
    })

    const started = await service.startInstallation()
    const status = await service.getInstallation(started.installationId)

    expect(status).toEqual(expect.objectContaining({
      state: 'authorized',
      accountId: 'bot-123',
    }))
    expect(JSON.stringify(status)).not.toContain('weixin-bot-secret')

    const credentialPath = path.join(tmpDir, 'weixin', 'credentials.json')
    const credentials = JSON.parse(await fs.readFile(credentialPath, 'utf-8'))
    expect(credentials).toEqual({
      accountId: 'bot-123',
      token: 'weixin-bot-secret',
      baseUrl: 'https://example.weixin.qq.com',
    })
    if (process.platform !== 'win32') {
      expect((await fs.stat(credentialPath)).mode & 0o777).toBe(0o600)
    }

    const adapterConfig = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'adapters.json'), 'utf-8'),
    )
    expect(JSON.stringify(adapterConfig)).not.toContain('weixin-bot-secret')
    expect(adapterConfig.weixin.accountId).toBe('bot-123')
    expect(adapterConfig.weixin.pairedUsers).toEqual([
      expect.objectContaining({ userId: 'user-456' }),
    ])
  })
})

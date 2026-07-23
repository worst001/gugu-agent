import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  deleteWeixinCredentials,
  WeixinInstallService,
} from '../services/weixinInstallService.js'

describe('WeChat installation hardening', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let service: WeixinInstallService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-hardening-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    service = new WeixinInstallService()
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('coalesces concurrent QR start requests', async () => {
    let calls = 0
    let release!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      release = resolve
    })
    service.setFetchFn(async () => {
      calls += 1
      return await response
    })

    const first = service.startInstallation()
    const second = service.startInstallation()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(calls).toBe(1)
    release(Response.json({
      qrcode: 'ticket-1',
      qrcode_img_content: 'https://weixin.qq.com/x/concurrent',
    }))
    const [firstStatus, secondStatus] = await Promise.all([first, second])
    expect(secondStatus.installationId).toBe(firstStatus.installationId)
  })

  test('does not persist a confirmed account without scanner identity', async () => {
    service.setFetchFn(async (input) => {
      if (String(input).includes('get_bot_qrcode')) {
        return Response.json({
          qrcode: 'ticket-2',
          qrcode_img_content: 'https://weixin.qq.com/x/incomplete',
        })
      }
      return Response.json({
        status: 'confirmed',
        bot_token: 'secret',
        ilink_bot_id: 'bot-1',
        baseurl: 'https://example.weixin.qq.com',
      })
    })

    const started = await service.startInstallation()
    const status = await service.getInstallation(started.installationId)

    expect(status.state).toBe('failed')
    expect(status.error).toContain('complete account identity')
    await expect(fs.access(path.join(tmpDir, 'weixin', 'credentials.json')))
      .rejects.toThrow()
  })

  test('starts a fresh QR flow after an authorized account is disconnected', async () => {
    let qrRequests = 0
    service.setFetchFn(async (input) => {
      if (String(input).includes('get_bot_qrcode')) {
        qrRequests += 1
        return Response.json({
          qrcode: 'ticket-' + qrRequests,
          qrcode_img_content: 'https://weixin.qq.com/x/reconnect-' + qrRequests,
        })
      }
      return Response.json({
        status: 'confirmed',
        bot_token: 'secret',
        ilink_bot_id: 'bot-1',
        ilink_user_id: 'user-1',
      })
    })

    const first = await service.startInstallation()
    expect((await service.getInstallation(first.installationId)).state)
      .toBe('authorized')
    await deleteWeixinCredentials()

    const second = await service.startInstallation()
    expect(second.state).toBe('waiting')
    expect(second.installationId).not.toBe(first.installationId)
    expect(qrRequests).toBe(2)
  })

  test('accepts verification only when the provider requests it', async () => {
    service.setFetchFn(async () => Response.json({
      qrcode: 'ticket-3',
      qrcode_img_content: 'https://weixin.qq.com/x/verification',
    }))

    const started = await service.startInstallation()

    await expect(service.submitVerification(started.installationId, '123456'))
      .rejects.toThrow('not awaiting')
  })
})

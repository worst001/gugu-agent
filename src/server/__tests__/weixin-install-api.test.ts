import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { weixinInstallService } from '../services/weixinInstallService.js'

describe('WeChat installation API', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-api-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('starts, verifies and cancels an installation through nested adapter routes', async () => {
    weixinInstallService.setFetchFn(async (input) => {
      if (String(input).includes('get_bot_qrcode')) {
        return Response.json({
          qrcode: 'api-ticket',
          qrcode_img_content: 'https://weixin.qq.com/x/api-test',
        })
      }
      return Response.json({ status: 'need_verifycode' })
    })

    const startUrl = new URL(
      'http://127.0.0.1:3456/api/adapters/weixin/installations',
    )
    const startResponse = await handleApiRequest(
      new Request(startUrl, { method: 'POST' }),
      startUrl,
    )
    expect(startResponse.status).toBe(201)
    const started = await startResponse.json() as Record<string, any>
    expect(started.state).toBe('waiting')
    expect(JSON.stringify(started)).not.toContain('api-ticket')

    const statusUrl = new URL(`${startUrl}/${started.installationId}`)
    const statusResponse = await handleApiRequest(new Request(statusUrl), statusUrl)
    expect(statusResponse.status).toBe(200)
    expect((await statusResponse.json() as Record<string, any>).state)
      .toBe('needs_verification')

    const verificationUrl = new URL(`${statusUrl}/verification`)
    const verificationResponse = await handleApiRequest(
      new Request(verificationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '123456' }),
      }),
      verificationUrl,
    )
    expect(verificationResponse.status).toBe(200)

    const cancelResponse = await handleApiRequest(
      new Request(statusUrl, { method: 'DELETE' }),
      statusUrl,
    )
    expect(cancelResponse.status).toBe(200)
    expect((await cancelResponse.json() as Record<string, any>).state)
      .toBe('cancelled')
  })
})

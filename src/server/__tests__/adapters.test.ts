import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'

describe('adapters API', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-adapters-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('masks adapter secrets and pairing code through the API', async () => {
    await writeAdaptersConfig({
      defaultProjectDir: 'D:\\work',
      pairing: {
        code: 'ABC123',
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      telegram: {
        botToken: 'telegram-secret-token',
        allowedUsers: [123],
        pairedUsers: [{ userId: 456, displayName: 'Telegram User', pairedAt: 1 }],
      },
      feishu: {
        appId: 'cli_abc',
        appSecret: 'feishu-secret',
        encryptKey: 'encrypt-secret',
        verificationToken: 'verify-secret',
        allowedUsers: ['ou_abc'],
      },
      dingtalk: {
        clientId: 'ding-client',
        clientSecret: 'ding-secret',
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=ding-token',
        webhookSecret: 'ding-webhook-secret',
      },
      wecom: {
        corpId: 'corp-id',
        agentId: '1000001',
        secret: 'wecom-secret',
        token: 'wecom-token',
        encodingAesKey: 'wecom-aes-key',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-key',
      },
      qq: {
        appId: 'qq-app',
        token: 'qq-token',
        appSecret: 'qq-secret',
        oneBotAccessToken: 'onebot-secret',
      },
    })

    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3456/api/adapters'),
      new URL('http://127.0.0.1:3456/api/adapters'),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, any>
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('telegram-secret-token')
    expect(serialized).not.toContain('feishu-secret')
    expect(serialized).not.toContain('encrypt-secret')
    expect(serialized).not.toContain('verify-secret')
    expect(serialized).not.toContain('ding-secret')
    expect(serialized).not.toContain('ding-token')
    expect(serialized).not.toContain('wecom-secret')
    expect(serialized).not.toContain('wecom-key')
    expect(serialized).not.toContain('qq-token')
    expect(serialized).not.toContain('onebot-secret')
    expect(body.telegram.botToken).toBe('****oken')
    expect(body.feishu.appSecret).toBe('****cret')
    expect(body.feishu.encryptKey).toBe('****cret')
    expect(body.feishu.verificationToken).toBe('****cret')
    expect(body.dingtalk.clientSecret).toBe('****cret')
    expect(body.dingtalk.webhookSecret).toBe('****cret')
    expect(body.wecom.secret).toBe('****cret')
    expect(body.wecom.token).toBe('****oken')
    expect(body.wecom.encodingAesKey).toBe('****-key')
    expect(body.qq.token).toBe('****oken')
    expect(body.qq.appSecret).toBe('****cret')
    expect(body.qq.oneBotAccessToken).toBe('****cret')
    expect(body.pairing.code).toBe('******')
  })

  test('preserves masked secrets while allowing safe fields to be updated', async () => {
    await writeAdaptersConfig({
      defaultProjectDir: 'D:\\old-project',
      telegram: {
        botToken: 'telegram-secret-token',
        allowedUsers: [111],
      },
      feishu: {
        appId: 'cli_old',
        appSecret: 'feishu-secret',
        encryptKey: 'encrypt-secret',
        verificationToken: 'verify-secret',
        allowedUsers: ['ou_old'],
        streamingCard: false,
      },
      dingtalk: {
        clientId: 'ding-old',
        clientSecret: 'ding-secret',
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=ding-token',
        webhookSecret: 'ding-webhook-secret',
        allowedUsers: ['ding_old'],
      },
      wecom: {
        corpId: 'corp-old',
        agentId: '1000001',
        secret: 'wecom-secret',
        token: 'wecom-token',
        encodingAesKey: 'wecom-aes-key',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-key',
        allowedUsers: ['wecom_old'],
      },
      qq: {
        appId: 'qq-old',
        token: 'qq-token',
        appSecret: 'qq-secret',
        oneBotUrl: 'ws://127.0.0.1:3001',
        oneBotAccessToken: 'onebot-secret',
        allowedUsers: ['qq_old'],
      },
    })

    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3456/api/adapters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultProjectDir: '',
          telegram: {
            botToken: '****oken',
            allowedUsers: [222],
          },
          feishu: {
            appId: 'cli_new',
            appSecret: '****cret',
            encryptKey: '****cret',
            verificationToken: '****cret',
            allowedUsers: [],
            streamingCard: true,
          },
          dingtalk: {
            clientId: 'ding-new',
            clientSecret: '****cret',
            webhookUrl: '****oken',
            webhookSecret: '****cret',
            allowedUsers: ['ding_new'],
          },
          wecom: {
            corpId: 'corp-new',
            agentId: '1000002',
            secret: '****cret',
            token: '****oken',
            encodingAesKey: '****-key',
            webhookUrl: '****-key',
            allowedUsers: [],
          },
          qq: {
            appId: 'qq-new',
            token: '****oken',
            appSecret: '****cret',
            oneBotUrl: 'ws://127.0.0.1:3002',
            oneBotAccessToken: '****cret',
            allowedUsers: ['qq_new'],
          },
        }),
      }),
      new URL('http://127.0.0.1:3456/api/adapters'),
    )

    expect(response.status).toBe(200)
    const raw = await readAdaptersConfig()
    expect(raw.defaultProjectDir).toBe('')
    expect(raw.telegram.botToken).toBe('telegram-secret-token')
    expect(raw.telegram.allowedUsers).toEqual([222])
    expect(raw.feishu.appId).toBe('cli_new')
    expect(raw.feishu.appSecret).toBe('feishu-secret')
    expect(raw.feishu.encryptKey).toBe('encrypt-secret')
    expect(raw.feishu.verificationToken).toBe('verify-secret')
    expect(raw.feishu.allowedUsers).toEqual([])
    expect(raw.feishu.streamingCard).toBe(true)
    expect(raw.dingtalk.clientId).toBe('ding-new')
    expect(raw.dingtalk.clientSecret).toBe('ding-secret')
    expect(raw.dingtalk.webhookUrl).toBe('https://oapi.dingtalk.com/robot/send?access_token=ding-token')
    expect(raw.dingtalk.webhookSecret).toBe('ding-webhook-secret')
    expect(raw.dingtalk.allowedUsers).toEqual(['ding_new'])
    expect(raw.wecom.corpId).toBe('corp-new')
    expect(raw.wecom.secret).toBe('wecom-secret')
    expect(raw.wecom.token).toBe('wecom-token')
    expect(raw.wecom.encodingAesKey).toBe('wecom-aes-key')
    expect(raw.wecom.webhookUrl).toBe('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=wecom-key')
    expect(raw.wecom.allowedUsers).toEqual([])
    expect(raw.qq.appId).toBe('qq-new')
    expect(raw.qq.token).toBe('qq-token')
    expect(raw.qq.appSecret).toBe('qq-secret')
    expect(raw.qq.oneBotUrl).toBe('ws://127.0.0.1:3002')
    expect(raw.qq.oneBotAccessToken).toBe('onebot-secret')
    expect(raw.qq.allowedUsers).toEqual(['qq_new'])
  })

  test('rejects unknown top-level config keys', async () => {
    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3456/api/adapters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unknown: true }),
      }),
      new URL('http://127.0.0.1:3456/api/adapters'),
    )

    expect(response.status).toBe(400)
    const body = await response.json() as { message?: string }
    expect(body.message).toContain('Unknown config key')
  })

  test('reports local adapter diagnostics without returning secrets', async () => {
    await writeAdaptersConfig({
      defaultProjectDir: 'D:\\work',
      pairing: {
        code: 'ABC123',
        expiresAt: Date.now() + 60_000,
        createdAt: Date.now(),
      },
      telegram: {
        botToken: 'telegram-secret-token',
        allowedUsers: [123],
        pairedUsers: [{ userId: 456, displayName: 'Telegram User', pairedAt: 1 }],
      },
      feishu: {
        appId: 'cli_abc',
        appSecret: '',
        allowedUsers: [],
        pairedUsers: [],
      },
      dingtalk: {
        webhookUrl: 'https://oapi.dingtalk.com/robot/send?access_token=ding-token',
        allowedUsers: ['ding_user'],
      },
      wecom: {
        corpId: 'corp-id',
        agentId: '',
        secret: '',
        allowedUsers: [],
      },
      qq: {
        oneBotUrl: 'ws://127.0.0.1:3001',
        pairedUsers: [{ userId: 'qq-user', displayName: 'QQ User', pairedAt: 2 }],
      },
    })

    const response = await handleApiRequest(
      new Request('http://127.0.0.1:3456/api/adapters/status'),
      new URL('http://127.0.0.1:3456/api/adapters/status'),
    )

    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, any>
    expect(JSON.stringify(body)).not.toContain('telegram-secret-token')
    expect(body.defaultProjectConfigured).toBe(true)
    expect(body.pairingActive).toBe(true)
    expect(body.channels).toHaveLength(5)
    expect(body.channels).toContainEqual(expect.objectContaining({
      platform: 'telegram',
      status: 'ready',
      credentialsReady: true,
      allowedUsersCount: 1,
      pairedUsersCount: 1,
    }))
    expect(body.channels).toContainEqual(expect.objectContaining({
      platform: 'feishu',
      status: 'needs_credentials',
      credentialsReady: false,
      missingCredentials: ['appSecret'],
    }))
    expect(body.channels).toContainEqual(expect.objectContaining({
      platform: 'dingtalk',
      status: 'ready',
      credentialsReady: true,
      allowedUsersCount: 1,
    }))
    expect(body.channels).toContainEqual(expect.objectContaining({
      platform: 'wecom',
      status: 'needs_credentials',
      credentialsReady: false,
      missingCredentials: ['corpId/agentId/secret or webhookUrl'],
    }))
    expect(body.channels).toContainEqual(expect.objectContaining({
      platform: 'qq',
      status: 'ready',
      credentialsReady: true,
      pairedUsersCount: 1,
    }))
  })

  async function writeAdaptersConfig(value: Record<string, unknown>) {
    await fs.writeFile(
      path.join(tmpDir, 'adapters.json'),
      JSON.stringify(value, null, 2),
      'utf-8',
    )
  }

  async function readAdaptersConfig(): Promise<any> {
    return JSON.parse(await fs.readFile(path.join(tmpDir, 'adapters.json'), 'utf-8'))
  }
})

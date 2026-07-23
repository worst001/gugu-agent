import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadWeixinCredentials } from '../services/weixinInstallService.js'

describe('WeChat credential storage', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-weixin-credentials-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('rejects malformed or insecure stored credentials', async () => {
    const credentialPath = path.join(tmpDir, 'weixin', 'credentials.json')
    await fs.mkdir(path.dirname(credentialPath), { recursive: true })
    await fs.writeFile(credentialPath, '{broken', 'utf-8')
    await expect(loadWeixinCredentials()).rejects.toThrow('credentials are invalid')

    await fs.writeFile(credentialPath, JSON.stringify({
      accountId: 'bot-1',
      token: 'secret',
      baseUrl: 'http://example.weixin.qq.com',
    }))
    await expect(loadWeixinCredentials()).rejects.toThrow('must use HTTPS')
  })
})

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  ChatGPTAuthService,
  extractAccountIdFromClaims,
  parseJwtClaims,
  type StoredChatGPTTokens,
} from '../services/chatgptAuthService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let service: ChatGPTAuthService

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-oauth-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  service = new ChatGPTAuthService()
}

async function teardown() {
  if (originalConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function jwtWithClaims(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`
}

describe('ChatGPTAuthService — storage', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('loadTokens returns null when file does not exist', async () => {
    expect(await service.loadTokens()).toBeNull()
  })

  test('saveTokens writes file with 0600 permissions', async () => {
    const tokens: StoredChatGPTTokens = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600_000,
      accountId: 'acc_123',
    }
    await service.saveTokens(tokens)

    const tokenPath = path.join(tmpDir, 'cc-haha', 'chatgpt-oauth.json')
    const stat = await fs.stat(tokenPath)
    expect(stat.mode & 0o777).toBe(0o600)
    expect(await service.loadTokens()).toEqual(tokens)
  })

  test('deleteTokens removes stored tokens', async () => {
    await service.saveTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + 3600_000,
    })
    await service.deleteTokens()
    expect(await service.loadTokens()).toBeNull()
  })
})

describe('ChatGPTAuthService — token helpers', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('extracts account id from id token claims', () => {
    const token = jwtWithClaims({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc_claim' },
    })
    const claims = parseJwtClaims(token)
    expect(claims).toBeDefined()
    expect(extractAccountIdFromClaims(claims!)).toBe('acc_claim')
  })

  test('refreshes expired tokens and preserves account id', async () => {
    await service.saveTokens({
      accessToken: 'old-access',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      accountId: 'acc_existing',
    })
    service.setFetchFn(async () =>
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    )

    const tokens = await service.ensureFreshTokens()
    expect(tokens?.accessToken).toBe('new-access')
    expect(tokens?.refreshToken).toBe('new-refresh')
    expect(tokens?.accountId).toBe('acc_existing')
  })
})

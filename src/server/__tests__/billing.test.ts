import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleApiRequest } from '../router.js'
import { BillingService } from '../services/billingService.js'

describe('BillingService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalPurchaseUrl: string | undefined
  let originalVerifyUrl: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-billing-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalPurchaseUrl = process.env.CC_GUGU_BILLING_PURCHASE_URL
    originalVerifyUrl = process.env.CC_GUGU_BILLING_VERIFY_URL
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.CC_GUGU_BILLING_PURCHASE_URL
    delete process.env.CC_GUGU_BILLING_VERIFY_URL
  })

  afterEach(async () => {
    restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
    restoreEnv('CC_GUGU_BILLING_PURCHASE_URL', originalPurchaseUrl)
    restoreEnv('CC_GUGU_BILLING_VERIFY_URL', originalVerifyUrl)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('returns a pending-open status without leaking license secrets', async () => {
    await writeJson(path.join(tmpDir, 'cc-haha', 'billing.json'), {
      licenseKey: 'gugu-license-secret-123456',
      status: 'active',
      plan: 'Pro',
      message: 'ok',
    })

    const service = new BillingService(mockFetchJson({ valid: true }))
    const status = await service.getStatus()
    const serialized = JSON.stringify(status)

    expect(status.maskedLicenseKey).toBe('gugu...3456')
    expect(serialized).not.toContain('gugu-license-secret-123456')
    expect(status.purchaseUrl).toBe(null)
  })

  test('does not call the network when verify URL is not configured', async () => {
    let called = false
    const service = new BillingService(async () => {
      called = true
      return jsonResponse({ valid: true })
    })

    const status = await service.refresh()

    expect(called).toBe(false)
    expect(status.status).toBe('not_configured')
    expect(status.message).toContain('订阅校验服务尚未配置')
  })

  test('activates a license with configured verifier and masks stored key', async () => {
    process.env.CC_GUGU_BILLING_PURCHASE_URL = 'https://example.com/buy'
    process.env.CC_GUGU_BILLING_VERIFY_URL = 'https://example.com/verify'
    const calls: unknown[] = []
    const service = new BillingService(async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return jsonResponse({
        valid: true,
        plan: 'Pro',
        expiresAt: '2099-01-01T00:00:00.000Z',
        message: '订阅已激活',
      })
    })

    const status = await service.activateLicense('gugu-license-secret-123456')

    expect(calls).toHaveLength(1)
    expect(status.status).toBe('active')
    expect(status.plan).toBe('Pro')
    expect(status.purchaseUrl).toBe('https://example.com/buy')
    expect(status.maskedLicenseKey).toBe('gugu...3456')

    const raw = await fs.readFile(path.join(tmpDir, 'cc-haha', 'billing.json'), 'utf-8')
    expect(raw).toContain('gugu-license-secret-123456')
    expect(JSON.stringify(status)).not.toContain('gugu-license-secret-123456')
  })

  test('refresh marks an expired verifier response as expired', async () => {
    process.env.CC_GUGU_BILLING_VERIFY_URL = 'https://example.com/verify'
    await writeJson(path.join(tmpDir, 'cc-haha', 'billing.json'), {
      licenseKey: 'gugu-license-secret-123456',
      deviceId: 'device-1',
    })
    const service = new BillingService(mockFetchJson({
      valid: true,
      plan: 'Pro',
      expiresAt: '2000-01-01T00:00:00.000Z',
    }))

    const status = await service.refresh()

    expect(status.status).toBe('expired')
    expect(status.expiresAt).toBe('2000-01-01T00:00:00.000Z')
  })

  test('routes billing status through the API router', async () => {
    const response = await handleApiRequest(
      new Request('http://localhost/api/billing/status'),
      new URL('http://localhost/api/billing/status'),
    )
    const body = await response.json() as { status: string; maskedLicenseKey: string | null }

    expect(response.status).toBe(200)
    expect(body.status).toBe('not_configured')
    expect(body.maskedLicenseKey).toBe(null)
  })
})

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function mockFetchJson(body: unknown): typeof fetch {
  return (async () => jsonResponse(body)) as typeof fetch
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

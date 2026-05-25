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
  let originalLegacyPurchaseUrl: string | undefined
  let originalVerifyUrl: string | undefined
  let originalGatewayUrl: string | undefined
  let originalLegacyGatewayUrl: string | undefined
  let originalDefaultGatewayUrl: string | undefined
  let originalDisableDefaultGateway: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-billing-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalPurchaseUrl = process.env.CC_GUGU_BILLING_PURCHASE_URL
    originalLegacyPurchaseUrl = process.env.GUGU_PURCHASE_URL
    originalVerifyUrl = process.env.CC_GUGU_BILLING_VERIFY_URL
    originalGatewayUrl = process.env.CC_GUGU_GATEWAY_URL
    originalLegacyGatewayUrl = process.env.GUGU_GATEWAY_URL
    originalDefaultGatewayUrl = process.env.GUGU_DESKTOP_DEFAULT_GATEWAY_URL
    originalDisableDefaultGateway = process.env.CC_GUGU_DISABLE_DEFAULT_GATEWAY
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.CC_GUGU_BILLING_PURCHASE_URL
    delete process.env.GUGU_PURCHASE_URL
    delete process.env.CC_GUGU_BILLING_VERIFY_URL
    delete process.env.CC_GUGU_GATEWAY_URL
    delete process.env.GUGU_GATEWAY_URL
    delete process.env.GUGU_DESKTOP_DEFAULT_GATEWAY_URL
    process.env.CC_GUGU_DISABLE_DEFAULT_GATEWAY = '1'
  })

  afterEach(async () => {
    restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
    restoreEnv('CC_GUGU_BILLING_PURCHASE_URL', originalPurchaseUrl)
    restoreEnv('GUGU_PURCHASE_URL', originalLegacyPurchaseUrl)
    restoreEnv('CC_GUGU_BILLING_VERIFY_URL', originalVerifyUrl)
    restoreEnv('CC_GUGU_GATEWAY_URL', originalGatewayUrl)
    restoreEnv('GUGU_GATEWAY_URL', originalLegacyGatewayUrl)
    restoreEnv('GUGU_DESKTOP_DEFAULT_GATEWAY_URL', originalDefaultGatewayUrl)
    restoreEnv('CC_GUGU_DISABLE_DEFAULT_GATEWAY', originalDisableDefaultGateway)
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
    expect(status.purchaseUrl).toBe('https://gugu.guxingyao.com/buy')
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
    expect(status.message).toContain('Billing verifier is not configured')
  })

  test('registers a gateway device and exposes additive quota fields', async () => {
    process.env.CC_GUGU_GATEWAY_URL = 'https://gateway.example.com'
    const service = new BillingService(async (url) => {
      expect(String(url)).toBe('https://gateway.example.com/v1/devices')
      return jsonResponse({
        deviceId: 'device-1',
        deviceToken: 'token-1',
        entitlement: {
          status: 'active',
          plan: 'free',
          creditsTotal: 50,
          creditsRemaining: 49,
          isTrial: true,
          purchaseUrl: 'https://buy.example.com',
        },
      })
    })

    const status = await service.getStatus()

    expect(status.status).toBe('active')
    expect(status.deviceId).toBe('device-1')
    expect(status.creditsTotal).toBe(50)
    expect(status.creditsRemaining).toBe(49)
    expect(status.isTrial).toBe(true)
    expect(status.purchaseUrl).toBe('https://buy.example.com')
  })

  test('uses build-time default gateway when runtime gateway is absent', async () => {
    process.env.GUGU_DESKTOP_DEFAULT_GATEWAY_URL = 'https://built.example.com/base/'
    const service = new BillingService(async (url) => {
      expect(String(url)).toBe('https://built.example.com/base/v1/devices')
      return jsonResponse({
        deviceId: 'device-1',
        deviceToken: 'token-1',
        entitlement: {
          status: 'active',
          plan: 'free',
          creditsTotal: 25,
          creditsRemaining: 25,
          isTrial: true,
        },
      })
    })

    const config = await service.getConfig()
    const status = await service.getStatus()

    expect(config.gatewayUrlConfigured).toBe(true)
    expect(status.status).toBe('active')
    expect(status.creditsTotal).toBe(25)
  })

  test('uses bundled gateway and purchase URL by default', async () => {
    delete process.env.CC_GUGU_DISABLE_DEFAULT_GATEWAY
    const service = new BillingService(async (url) => {
      expect(String(url)).toBe('https://gugu.guxingyao.com/v1/devices')
      return jsonResponse({
        deviceId: 'device-1',
        deviceToken: 'token-1',
        entitlement: {
          status: 'active',
          plan: 'free',
          creditsTotal: 3,
          creditsRemaining: 3,
          isTrial: true,
        },
      })
    })

    const config = await service.getConfig()
    const status = await service.getStatus()

    expect(config.gatewayUrlConfigured).toBe(true)
    expect(config.purchaseUrl).toBe('https://gugu.guxingyao.com/buy')
    expect(status.status).toBe('active')
    expect(status.creditsTotal).toBe(3)
    expect(status.creditsRemaining).toBe(3)
    expect(status.purchaseUrl).toBe('https://gugu.guxingyao.com/buy')
  })

  test('runtime gateway overrides build-time default gateway', async () => {
    process.env.GUGU_DESKTOP_DEFAULT_GATEWAY_URL = 'https://built.example.com'
    process.env.CC_GUGU_GATEWAY_URL = 'https://runtime.example.com'
    const service = new BillingService(async (url) => {
      expect(String(url)).toBe('https://runtime.example.com/v1/devices')
      return jsonResponse({
        deviceId: 'device-1',
        deviceToken: 'token-1',
        entitlement: {
          status: 'active',
          plan: 'free',
          creditsTotal: 10,
          creditsRemaining: 10,
          isTrial: true,
        },
      })
    })

    const status = await service.getStatus()

    expect(status.status).toBe('active')
  })

  test('gateway connection failures surface as check_failed', async () => {
    process.env.GUGU_DESKTOP_DEFAULT_GATEWAY_URL = 'https://gateway.example.com'
    const service = new BillingService(async () => {
      throw new Error('network down')
    })

    const status = await service.getStatus()

    expect(status.status).toBe('check_failed')
    expect(status.message).toContain('network down')
  })

  test('updates cached gateway credits from response headers', async () => {
    await writeJson(path.join(tmpDir, 'cc-haha', 'billing.json'), {
      deviceId: 'device-1',
      deviceToken: 'token-1',
      status: 'active',
      plan: 'free',
      creditsTotal: 50,
      creditsRemaining: 50,
      isTrial: true,
      message: '网关订阅状态正常。',
    })
    const service = new BillingService(mockFetchJson({}))

    await service.updateGatewayCreditsFromHeaders(new Headers({ 'x-gugu-credits-remaining': '37' }))
    const activeRaw = JSON.parse(await fs.readFile(path.join(tmpDir, 'cc-haha', 'billing.json'), 'utf-8')) as {
      status: string
      creditsRemaining: number
    }

    expect(activeRaw.status).toBe('active')
    expect(activeRaw.creditsRemaining).toBe(37)

    await service.updateGatewayCreditsFromHeaders(new Headers({ 'x-gugu-credits-remaining': '0' }))
    const exhaustedRaw = JSON.parse(await fs.readFile(path.join(tmpDir, 'cc-haha', 'billing.json'), 'utf-8')) as {
      status: string
      creditsRemaining: number
    }

    expect(exhaustedRaw.status).toBe('quota_exhausted')
    expect(exhaustedRaw.creditsRemaining).toBe(0)
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
        message: 'ok',
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

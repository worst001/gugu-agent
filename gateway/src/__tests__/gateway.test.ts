import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createGatewayHandler } from '../index.js'
import { GatewayStore } from '../store.js'
import type { GatewayConfig } from '../types.js'

describe('Gugu Gateway', () => {
  let tmpDir: string
  let originalFetch: typeof fetch
  let stores: GatewayStore[]

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gugu-gateway-'))
    originalFetch = globalThis.fetch
    stores = []
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    for (const store of stores) store.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('registers devices and returns trial entitlement', async () => {
    const { handler } = makeGateway({ freeCredits: 3 })

    const response = await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))
    const body = await response.json() as {
      deviceId: string
      deviceToken: string
      entitlement: { creditsTotal: number; creditsRemaining: number; isTrial: boolean }
    }

    expect(response.status).toBe(200)
    expect(body.deviceId).toBe('device-1')
    expect(body.deviceToken.startsWith('gugu_')).toBe(true)
    expect(body.entitlement.creditsTotal).toBe(3)
    expect(body.entitlement.creditsRemaining).toBe(3)
    expect(body.entitlement.isTrial).toBe(true)
    expect(body.entitlement.purchaseUrl).toBe('https://buy.example.com')
  })

  test('serves the manual purchase page', async () => {
    const { handler } = makeGateway()

    const response = await handler(getRequest('/buy'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html).toContain('Gugu Agent')
    expect(html).toContain('人工发码')
    expect(html).toContain('设置 → 订阅')
  })

  test('deducts free credits and returns 402 when exhausted', async () => {
    let upstreamCalls = 0
    globalThis.fetch = (async () => {
      upstreamCalls += 1
      return jsonResponse({ id: 'msg_1', type: 'message', content: [] })
    }) as typeof fetch

    const { handler } = makeGateway({ freeCredits: 1, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    const first = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))
    const second = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'again' }],
    }, registered.deviceToken))
    const secondBody = await second.json() as { error: { code: string } }

    expect(first.status).toBe(200)
    expect(second.status).toBe(402)
    expect(secondBody.error.code).toBe('GUGU_QUOTA_EXHAUSTED')
    expect(upstreamCalls).toBe(1)
  })

  test('activates a license code and upgrades entitlement', async () => {
    const { handler, store } = makeGateway({ freeCredits: 1 })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }
    const licenseKey = store.issueActivationCode({
      plan: 'pro',
      creditsTotal: 100,
      maxActivations: 1,
    })

    const response = await handler(jsonRequest('/v1/activate', {
      licenseKey,
    }, registered.deviceToken))
    const body = await response.json() as {
      entitlement: { plan: string; creditsTotal: number; creditsRemaining: number; isTrial: boolean }
    }

    expect(response.status).toBe(200)
    expect(body.entitlement.plan).toBe('pro')
    expect(body.entitlement.creditsTotal).toBe(100)
    expect(body.entitlement.creditsRemaining).toBe(100)
    expect(body.entitlement.isTrial).toBe(false)
  })

  test('tracks usage and exposes admin device summaries', async () => {
    globalThis.fetch = (async () => jsonResponse({ id: 'msg_1', type: 'message', content: [] })) as typeof fetch

    const { handler, store } = makeGateway({ freeCredits: 2, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', {
      deviceId: 'device-1',
      appVersion: '0.1.10',
      platform: 'win32-x64',
    }))).json() as {
      deviceToken: string
    }

    await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))

    const summary = store.getDeviceSummary({ deviceToken: registered.deviceToken })
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })
    const adjusted = store.setDeviceCreditsByDeviceId('device-1', 5, 10)

    expect(summary?.deviceId).toBe('device-1')
    expect(summary?.appVersion).toBe('0.1.10')
    expect(summary?.platform).toBe('win32-x64')
    expect(summary?.entitlement.creditsRemaining).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('message')
    expect(events[0].model).toBe('deepseek-v4-pro')
    expect(adjusted.creditsRemaining).toBe(5)
    expect(adjusted.creditsTotal).toBe(10)
  })

  function makeGateway(overrides: Partial<GatewayConfig> = {}) {
    const config: GatewayConfig = {
      dbPath: path.join(tmpDir, 'gateway.sqlite'),
      freeCredits: 5,
      purchaseUrl: 'https://buy.example.com',
      deepseekApiKey: '',
      deepseekBaseUrl: 'https://deepseek.example.com/anthropic',
      deepseekMainModel: 'deepseek-v4-pro',
      deepseekFastModel: 'deepseek-v4-flash',
      glmApiKey: '',
      glmBaseUrl: 'https://glm.example.com/api/paas/v4',
      ...overrides,
    }
    const store = new GatewayStore(config)
    stores.push(store)
    return { config, store, handler: createGatewayHandler(config, store) }
  }
})

function jsonRequest(pathname: string, body: unknown, token?: string): Request {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function getRequest(pathname: string): Request {
  return new Request(`http://localhost${pathname}`)
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

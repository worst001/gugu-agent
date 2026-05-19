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
      entitlement: { creditsTotal: number; creditsRemaining: number; expiresAt: string | null; isTrial: boolean; purchaseUrl: string | null }
    }

    expect(response.status).toBe(200)
    expect(body.deviceId).toBe('device-1')
    expect(body.deviceToken.startsWith('gugu_')).toBe(true)
    expect(body.entitlement.creditsTotal).toBe(3)
    expect(body.entitlement.creditsRemaining).toBe(3)
    expect(body.entitlement.expiresAt).toBeTruthy()
    expect(body.entitlement.isTrial).toBe(true)
    expect(body.entitlement.purchaseUrl).toBe('https://buy.example.com')
  })

  test('serves the package purchase page', async () => {
    const { handler } = makeGateway()

    const response = await handler(getRequest('/buy'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html).toContain('Gugu Agent')
    expect(html).toContain('light-monthly')
    expect(html).toContain('pro-monthly')
    expect(html).toContain('max-monthly')
    expect(html).not.toContain('topup-large')
    expect(html).not.toContain('点额度')
    expect(html).not.toContain('补充包')
    expect(html).not.toContain('31 天有效期')
    expect(html).toContain('/v1/orders')
  })

  test('serves the public home and download pages', async () => {
    const { handler } = makeGateway({
      downloadUrl: 'https://downloads.example.com/Gugu-Agent.exe',
      downloadVersion: '0.1.0',
      downloadSha256: 'abc123',
    })

    const home = await handler(getRequest('/'))
    const download = await handler(getRequest('/download'))
    const homeHtml = await home.text()
    const downloadHtml = await download.text()

    expect(home.status).toBe(200)
    expect(homeHtml).toContain('Gugu Agent')
    expect(homeHtml).toContain('/buy')
    expect(homeHtml).toContain('/download')
    expect(download.status).toBe(200)
    expect(downloadHtml).toContain('https://downloads.example.com/Gugu-Agent.exe')
    expect(downloadHtml).toContain('0.1.0')
    expect(downloadHtml).toContain('abc123')
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

    const response = await handler(jsonRequest('/v1/activate', { licenseKey }, registered.deviceToken))
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

  test('records DeepSeek JSON token usage without changing message forwarding', async () => {
    globalThis.fetch = (async () => jsonResponse({
      id: 'msg_1',
      type: 'message',
      content: [],
      usage: { input_tokens: 11, output_tokens: 7 },
    })) as typeof fetch

    const { handler, store } = makeGateway({ freeCredits: 2, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    const response = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))
    const body = await response.json() as { id: string }
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })

    expect(response.status).toBe(200)
    expect(body.id).toBe('msg_1')
    expect(events[0].inputTokens).toBe(11)
    expect(events[0].outputTokens).toBe(7)
  })

  test('records DeepSeek SSE token usage without breaking streaming', async () => {
    globalThis.fetch = (async () => new Response(
      [
        'event: message_start\n',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":17,"output_tokens":1}}}\n\n',
        'event: message_delta\n',
        'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n',
      ].join(''),
      { headers: { 'Content-Type': 'text/event-stream' } },
    )) as typeof fetch

    const { handler, store } = makeGateway({ freeCredits: 2, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    const response = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))
    const text = await response.text()
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })

    expect(response.status).toBe(200)
    expect(text).toContain('message_delta')
    expect(events[0].inputTokens).toBe(17)
    expect(events[0].outputTokens).toBe(9)
  })

  test('deducts weighted attachment credits and records GLM usage tokens', async () => {
    globalThis.fetch = (async () => jsonResponse({
      ok: true,
      usage: { prompt_tokens: 21, completion_tokens: 8 },
    })) as typeof fetch

    const { handler, store } = makeGateway({
      freeCredits: 10,
      glmApiKey: 'glm-key',
      attachmentCreditCost: 6,
    })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    const response = await handler(jsonRequest('/v1/attachments/parse', {
      operation: 'chat_completions',
      body: { model: 'glm-5v-turbo', messages: [] },
    }, registered.deviceToken))
    const summary = store.getDeviceSummary({ deviceToken: registered.deviceToken })
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })

    expect(response.status).toBe(200)
    expect(response.headers.get('x-gugu-credits-remaining')).toBe('4')
    expect(summary?.entitlement.creditsRemaining).toBe(4)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('vision')
    expect(events[0].model).toBe('glm-5v-turbo')
    expect(events[0].credits).toBe(6)
    expect(events[0].inputTokens).toBe(21)
    expect(events[0].outputTokens).toBe(8)
  })

  test('uses summary and OCR credit weights for GLM attachment operations', async () => {
    globalThis.fetch = (async () => jsonResponse({ ok: true })) as typeof fetch

    const { handler, store } = makeGateway({
      freeCredits: 10,
      glmApiKey: 'glm-key',
      fileParseCreditCost: 3,
      summarizeCreditCost: 4,
    })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    await handler(jsonRequest('/v1/attachments/parse', {
      operation: 'layout_parsing',
      body: { model: 'glm-ocr' },
    }, registered.deviceToken))
    await handler(jsonRequest('/v1/attachments/parse', {
      operation: 'chat_completions',
      body: { model: 'glm-5.1', messages: [] },
    }, registered.deviceToken))

    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })
    expect(events.map((event) => event.kind)).toEqual(['summarize', 'ocr'])
    expect(events.map((event) => event.credits)).toEqual([4, 3])
    expect(store.getEntitlement(registered.deviceToken).creditsRemaining).toBe(3)
  })

  test('creates manual orders and fulfills them idempotently', async () => {
    const { handler, store } = makeGateway({ adminToken: 'secret' })

    const created = await handler(jsonRequest('/v1/orders', {
      packageId: 'pro-monthly',
      contact: 'wechat: gugu',
    }))
    const createdBody = await created.json() as { order: { orderId: string; status: string; amountCents: number } }
    const listed = await handler(getRequest('/admin/api/orders?q=gugu', 'secret'))
    const listedBody = await listed.json() as { data: Array<{ orderId: string; contact: string | null }> }
    const paid = store.markOrderPaid(createdBody.order.orderId)
    const fulfilled = store.fulfillOrder(createdBody.order.orderId)
    const fulfilledAgain = store.fulfillOrder(createdBody.order.orderId)

    expect(created.status).toBe(200)
    expect(createdBody.order.status).toBe('pending_payment')
    expect(createdBody.order.amountCents).toBe(4900)
    expect(listedBody.data[0]?.orderId).toBe(createdBody.order.orderId)
    expect(listedBody.data[0]?.contact).toBe('wechat: gugu')
    expect(paid.status).toBe('paid')
    expect(fulfilled.status).toBe('fulfilled')
    expect(fulfilled.licenseKey?.startsWith('GUGU-')).toBe(true)
    expect(fulfilledAgain.licenseKey).toBe(fulfilled.licenseKey)
  })

  test('rejects removed topup packages from public orders', async () => {
    const { handler } = makeGateway()

    const response = await handler(jsonRequest('/v1/orders', {
      packageId: 'topup-large',
    }))
    const body = await response.json() as { error: { code: string; message: string } }

    expect(response.status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toContain('not available')
  })

  test('protects dashboard APIs with the admin token', async () => {
    const disabled = makeGateway()
    const disabledDashboard = await disabled.handler(getRequest('/admin/dashboard'))
    const disabledSummary = await disabled.handler(getRequest('/admin/api/summary'))

    const enabled = makeGateway({ adminToken: 'secret' })
    const noToken = await enabled.handler(getRequest('/admin/api/summary'))
    const withToken = await enabled.handler(getRequest('/admin/api/summary?range=30d', 'secret'))
    const downloadInfo = await enabled.handler(getRequest('/admin/api/download', 'secret'))
    const dashboard = await enabled.handler(getRequest('/admin/dashboard'))
    const body = await withToken.json() as { range: string; devices: { total: number } }
    const downloadBody = await downloadInfo.json() as { downloadUrl: string | null }

    expect(disabledDashboard.status).toBe(404)
    expect(disabledSummary.status).toBe(404)
    expect(noToken.status).toBe(401)
    expect(withToken.status).toBe(200)
    expect(downloadInfo.status).toBe(200)
    expect(downloadBody.downloadUrl).toBeNull()
    expect(body.range).toBe('30d')
    expect(body.devices.total).toBe(0)
    expect(dashboard.status).toBe(200)
    expect(await dashboard.text()).toContain('/admin/api/summary')
    expect(await (await enabled.handler(getRequest('/admin/dashboard'))).text()).toContain('/admin/api/download')
  })

  test('issues package activation codes with package defaults', async () => {
    const { store } = makeGateway()
    const licenseKey = store.issueActivationCodeForPackage('pro-monthly')
    const registered = store.registerDevice({ deviceId: 'device-1' })
    const entitlement = store.activate(registered.deviceToken, licenseKey)

    expect(licenseKey.startsWith('GUGU-')).toBe(true)
    expect(entitlement.plan).toBe('pro')
    expect(entitlement.creditsTotal).toBe(600)
  })

  function makeGateway(overrides: Partial<GatewayConfig> = {}) {
    const config: GatewayConfig = {
      dbPath: path.join(tmpDir, 'gateway.sqlite'),
      freeCredits: 5,
      purchaseUrl: 'https://buy.example.com',
      publicBaseUrl: null,
      downloadUrl: null,
      downloadVersion: null,
      downloadSha256: null,
      adminToken: '',
      dashboardTokenPerCredit: null,
      deepseekApiKey: '',
      deepseekBaseUrl: 'https://deepseek.example.com/anthropic',
      deepseekMainModel: 'deepseek-v4-pro',
      deepseekFastModel: 'deepseek-v4-flash',
      messageCreditCost: 1,
      attachmentCreditCost: 6,
      fileParseCreditCost: 3,
      summarizeCreditCost: 4,
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

function getRequest(pathname: string, token?: string): Request {
  return new Request(`http://localhost${pathname}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

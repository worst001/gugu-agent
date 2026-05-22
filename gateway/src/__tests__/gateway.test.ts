import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createCipheriv, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'
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
    const { handler } = makeGateway({ icpRecord: '沪ICP备2026021385号-1' })

    const response = await handler(getRequest('/buy'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html).toContain('Gugu Agent')
    expect(html).toContain('当前购买流程')
    expect(html).toContain('购买页只负责帮你选对档位')
    expect(html).toContain('结算页单独处理')
    expect(html).toContain('light-monthly')
    expect(html).toContain('pro-monthly')
    expect(html).toContain('max-monthly')
    expect(html).toContain('/checkout?packageId=light-monthly')
    expect(html).toContain('订阅')
    expect(html).not.toContain('topup-large')
    expect(html).not.toContain('补充包')
    expect(html).not.toContain('/v1/orders')
    expect(html).not.toContain('联系方式或备注')
    expect(html).not.toContain('微信支付二维码')
    expect(html).not.toContain('data-copy-license')
    expect(html).not.toContain('orderResult')
    expect(html).toContain('沪ICP备2026021385号-1')
    expect(html).toContain('https://beian.miit.gov.cn/')
  })

  test('serves a checkout page for a selected package', async () => {
    const { handler } = makeGateway({ icpRecord: '沪ICP备2026021385号-1' })

    const response = await handler(getRequest('/checkout?packageId=light-monthly'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('轻量版')
    expect(html).toContain('¥19')
    expect(html).toContain('联系方式或备注')
    expect(html).toContain('微信支付')
    expect(html).toContain('支付宝')
    expect(html).toContain('支付宝即将上线')
    expect(html).toContain('/v1/orders')
    expect(html).toContain('paymentProvider: provider')
    expect(html).toContain('currentOrderId')
    expect(html).toContain('selectPaymentMethod')
    expect(html).toContain('data-provider="alipay"')
    expect(html).not.toContain('推荐')
    expect(html).not.toContain('>可用<')
    expect(html).toContain('沪ICP备2026021385号-1')
  })

  test('serves a checkout error for invalid packages without creating orders', async () => {
    const { handler } = makeGateway()

    const response = await handler(getRequest('/checkout?packageId=topup-large'))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('套餐不可用')
    expect(html).toContain('/buy')
    expect(html).not.toContain('/v1/orders')
  })

  test('serves the public home and download pages', async () => {
    const { handler } = makeGateway({
      downloadUrl: 'https://downloads.example.com/Gugu-Agent.exe',
      downloadWindowsUrl: 'https://downloads.example.com/Gugu-Agent.msi',
      downloadMacosUrl: 'https://downloads.example.com/Gugu-Agent.dmg',
      downloadVersion: '0.1.0',
      downloadSha256: 'abc123',
      downloadWindowsSha256: 'windows-sha',
      downloadMacosSha256: 'macos-sha',
      icpRecord: '沪ICP备2026021385号-1',
    })

    const home = await handler(getRequest('/'))
    const download = await handler(getRequest('/download'))
    const homeHtml = await home.text()
    const downloadHtml = await download.text()

    expect(home.status).toBe(200)
    expect(homeHtml).toContain('Gugu Agent')
    expect(homeHtml).toContain('/buy')
    expect(homeHtml).toContain('/download')
    expect(homeHtml).toContain('沪ICP备2026021385号-1')
    expect(download.status).toBe(200)
    expect(downloadHtml).toContain('https://downloads.example.com/Gugu-Agent.msi')
    expect(downloadHtml).toContain('https://downloads.example.com/Gugu-Agent.dmg')
    expect(downloadHtml).toContain('官方 HTTPS 下载源')
    expect(downloadHtml).toContain('下载 Windows MSI')
    expect(downloadHtml).toContain('下载 macOS DMG')
    expect(downloadHtml).toContain('安装安全说明')
    expect(downloadHtml).toContain('危险下载内容')
    expect(downloadHtml).toContain('Windows SHA256')
    expect(downloadHtml).toContain('windows-sha')
    expect(downloadHtml).toContain('macOS SHA256')
    expect(downloadHtml).toContain('macos-sha')
    expect(downloadHtml).toContain('0.1.0')
    expect(downloadHtml).toContain('沪ICP备2026021385号-1')
    expect(downloadHtml).not.toContain('待配置')
    expect(downloadHtml).not.toContain('安装包准备中')
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

  test('forces free plan message requests onto the fast DeepSeek model', async () => {
    let forwardedModel = ''
    globalThis.fetch = (async (_input, init) => {
      forwardedModel = JSON.parse(String(init?.body ?? '{}')).model
      return jsonResponse({ id: 'msg_1', type: 'message', content: [] })
    }) as typeof fetch

    const { handler, store } = makeGateway({ freeCredits: 2, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }

    const response = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })

    expect(response.status).toBe(200)
    expect(forwardedModel).toBe('deepseek-v4-flash')
    expect(events[0].model).toBe('deepseek-v4-flash')
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

  test('keeps paid plan message requests on the requested managed DeepSeek model', async () => {
    let forwardedModel = ''
    globalThis.fetch = (async (_input, init) => {
      forwardedModel = JSON.parse(String(init?.body ?? '{}')).model
      return jsonResponse({ id: 'msg_1', type: 'message', content: [] })
    }) as typeof fetch

    const { handler, store } = makeGateway({ freeCredits: 1, deepseekApiKey: 'deepseek-key' })
    const registered = await (await handler(jsonRequest('/v1/devices', { deviceId: 'device-1' }))).json() as {
      deviceToken: string
    }
    const licenseKey = store.issueActivationCode({
      plan: 'pro',
      creditsTotal: 100,
      maxActivations: 1,
    })
    await handler(jsonRequest('/v1/activate', { licenseKey }, registered.deviceToken))

    const response = await handler(jsonRequest('/v1/messages', {
      model: 'gugu-managed-main',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
    }, registered.deviceToken))
    const events = store.listUsageEvents({ deviceToken: registered.deviceToken, limit: 10 })

    expect(response.status).toBe(200)
    expect(forwardedModel).toBe('deepseek-v4-pro')
    expect(events[0].model).toBe('deepseek-v4-pro')
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
    expect(events[0].model).toBe('deepseek-v4-flash')
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
    const createdBody = await created.json() as {
      order: { orderId: string; status: string; amountCents: number }
      orderToken: string
      payment: null
    }
    const listed = await handler(getRequest('/admin/api/orders?q=gugu', 'secret'))
    const listedBody = await listed.json() as { data: Array<{ orderId: string; contact: string | null }> }
    const missingStatus = await handler(orderStatusRequest(createdBody.order.orderId))
    const wrongStatus = await handler(orderStatusRequest(createdBody.order.orderId, 'wrong-token'))
    const pendingStatus = await handler(orderStatusRequest(createdBody.order.orderId, createdBody.orderToken))
    const pendingStatusBody = await pendingStatus.json() as { order: { status: string }; licenseKey: string | null }
    const paid = store.markOrderPaid(createdBody.order.orderId)
    const fulfilled = store.fulfillOrder(createdBody.order.orderId)
    const fulfilledAgain = store.fulfillOrder(createdBody.order.orderId)
    const fulfilledStatus = await handler(orderStatusRequest(createdBody.order.orderId, createdBody.orderToken))
    const fulfilledStatusBody = await fulfilledStatus.json() as { order: { status: string }; licenseKey: string | null }

    expect(created.status).toBe(200)
    expect(createdBody.order.status).toBe('pending_payment')
    expect(createdBody.order.amountCents).toBe(4900)
    expect(createdBody.orderToken.startsWith('ord_')).toBe(true)
    expect(createdBody.payment).toBeNull()
    expect(listedBody.data[0]?.orderId).toBe(createdBody.order.orderId)
    expect(listedBody.data[0]?.contact).toBe('wechat: gugu')
    expect(missingStatus.status).toBe(401)
    expect(wrongStatus.status).toBe(401)
    expect(pendingStatus.status).toBe(200)
    expect(pendingStatusBody.order.status).toBe('pending_payment')
    expect(pendingStatusBody.licenseKey).toBeNull()
    expect(paid.status).toBe('paid')
    expect(fulfilled.status).toBe('fulfilled')
    expect(fulfilled.licenseKey?.startsWith('GUGU-')).toBe(true)
    expect(fulfilledAgain.licenseKey).toBe(fulfilled.licenseKey)
    expect(fulfilledStatusBody.order.status).toBe('fulfilled')
    expect(fulfilledStatusBody.licenseKey).toBe(fulfilled.licenseKey)
  })

  test('creates WeChat Native orders when payment is configured', async () => {
    const fixture = await makeWechatPayFixture(tmpDir)
    const nativeCalls: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = []
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      nativeCalls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        body,
      })
      return signedWechatResponse(fixture, JSON.stringify({ code_url: 'weixin://wxpay/test-code' }))
    }) as typeof fetch

    const { handler } = makeGateway({ wechatPay: fixture.config })
    const created = await handler(jsonRequest('/v1/orders', {
      packageId: 'pro-monthly',
      contact: 'wechat: gugu',
      paymentProvider: 'wechat',
    }))
    const body = await created.json() as {
      order: {
        orderId: string
        paymentProvider: string | null
        paymentCodeUrl: string | null
        paymentExpiresAt: string | null
      }
      orderToken: string
      payment: { provider: string; codeUrl: string; qrDataUrl: string; expiresAt: string }
    }

    expect(created.status).toBe(200)
    expect(nativeCalls).toHaveLength(1)
    expect(nativeCalls[0]?.url).toBe('https://api.mch.weixin.qq.com/v3/pay/transactions/native')
    expect(nativeCalls[0]?.authorization).toContain('mchid="1900000001"')
    expect(nativeCalls[0]?.body.out_trade_no).toBe(body.order.orderId)
    expect((nativeCalls[0]?.body.amount as { total?: number }).total).toBe(4900)
    expect(nativeCalls[0]?.body.notify_url).toBe(fixture.config.notifyUrl)
    expect(body.order.paymentProvider).toBe('wechat')
    expect(body.order.paymentCodeUrl).toBe('weixin://wxpay/test-code')
    expect(body.order.paymentExpiresAt).toBe(body.payment.expiresAt)
    expect(body.orderToken.startsWith('ord_')).toBe(true)
    expect(body.payment.provider).toBe('wechat')
    expect(body.payment.codeUrl).toBe('weixin://wxpay/test-code')
    expect(body.payment.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  test('falls back to a manual order when WeChat Native creation fails', async () => {
    const fixture = await makeWechatPayFixture(tmpDir)
    globalThis.fetch = (async () => jsonResponse({
      code: 'SYSTEM_ERROR',
      message: 'try again later',
    }, { status: 500 })) as typeof fetch

    const { handler } = makeGateway({ wechatPay: fixture.config })
    const response = await handler(jsonRequest('/v1/orders', {
      packageId: 'light-monthly',
      contact: 'wechat: gugu',
    }))
    const body = await response.json() as {
      order: { status: string; paymentProvider: string | null }
      orderToken: string
      payment: null
      paymentError: string
    }

    expect(response.status).toBe(200)
    expect(body.order.status).toBe('pending_payment')
    expect(body.order.paymentProvider).toBeNull()
    expect(body.orderToken.startsWith('ord_')).toBe(true)
    expect(body.payment).toBeNull()
    expect(body.paymentError).toContain('SYSTEM_ERROR')
  })

  test('rejects invalid WeChat notifications without fulfilling orders', async () => {
    const fixture = await makeWechatPayFixture(tmpDir)
    const { handler, store } = makeGateway({ wechatPay: fixture.config })
    const order = store.createOrder({ packageId: 'light-monthly' })
    const orderToken = store.getOrderToken(order.orderId)

    const invalidSignature = await handler(wechatNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'wx-tx-invalid-signature',
      amountCents: order.amountCents,
      tamperSignature: true,
    }))
    const wrongAmount = await handler(wechatNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'wx-tx-wrong-amount',
      amountCents: order.amountCents + 1,
    }))
    const unknownOrder = await handler(wechatNotifyRequest(fixture, {
      orderId: 'GUGU-20990101-NOTFOUND',
      transactionId: 'wx-tx-unknown-order',
      amountCents: order.amountCents,
    }))
    const status = await handler(orderStatusRequest(order.orderId, orderToken))
    const statusBody = await status.json() as { order: { status: string }; licenseKey: string | null }

    expect(invalidSignature.status).toBe(400)
    expect(wrongAmount.status).toBe(400)
    expect(unknownOrder.status).toBe(400)
    expect(statusBody.order.status).toBe('pending_payment')
    expect(statusBody.licenseKey).toBeNull()
  })

  test('fulfills WeChat success notifications idempotently', async () => {
    const fixture = await makeWechatPayFixture(tmpDir)
    const { handler, store } = makeGateway({ wechatPay: fixture.config })
    const order = store.createOrder({ packageId: 'max-monthly' })
    const orderToken = store.getOrderToken(order.orderId)

    const firstNotify = await handler(wechatNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'wx-tx-success',
      amountCents: order.amountCents,
    }))
    const firstStatus = await handler(orderStatusRequest(order.orderId, orderToken))
    const firstStatusBody = await firstStatus.json() as {
      order: { status: string; wechatTransactionId: string | null; paidAmountCents: number | null }
      licenseKey: string | null
    }
    const secondNotify = await handler(wechatNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'wx-tx-success',
      amountCents: order.amountCents,
    }))
    const secondStatus = await handler(orderStatusRequest(order.orderId, orderToken))
    const secondStatusBody = await secondStatus.json() as { licenseKey: string | null }

    expect(firstNotify.status).toBe(204)
    expect(secondNotify.status).toBe(204)
    expect(firstStatusBody.order.status).toBe('fulfilled')
    expect(firstStatusBody.order.wechatTransactionId).toBe('wx-tx-success')
    expect(firstStatusBody.order.paidAmountCents).toBe(order.amountCents)
    expect(firstStatusBody.licenseKey?.startsWith('GUGU-')).toBe(true)
    expect(secondStatusBody.licenseKey).toBe(firstStatusBody.licenseKey)
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

  test('creates manual fallback orders when Alipay is unavailable', async () => {
    const { handler } = makeGateway()

    const response = await handler(jsonRequest('/v1/orders', {
      packageId: 'light-monthly',
      paymentProvider: 'alipay',
    }))
    const body = await response.json() as {
      order: { status: string; paymentProvider: string | null }
      orderToken: string
      payment: null
    }

    expect(response.status).toBe(200)
    expect(body.order.status).toBe('pending_payment')
    expect(body.order.paymentProvider).toBeNull()
    expect(body.orderToken.startsWith('ord_')).toBe(true)
    expect(body.payment).toBeNull()
  })

  test('creates Alipay page pay orders when payment is configured', async () => {
    const fixture = await makeAlipayFixture(tmpDir)
    globalThis.fetch = (async () => {
      throw new Error('Alipay page pay should not call fetch while creating an order.')
    }) as typeof fetch

    const { handler } = makeGateway({ alipay: fixture.config })
    const created = await handler(jsonRequest('/v1/orders', {
      packageId: 'pro-monthly',
      contact: 'alipay: gugu',
      paymentProvider: 'alipay',
    }))
    const body = await created.json() as {
      order: {
        orderId: string
        paymentProvider: string | null
        paymentCodeUrl: string | null
        paymentExpiresAt: string | null
      }
      orderToken: string
      payment: { provider: string; codeUrl: string; qrDataUrl: string; expiresAt: string }
    }

    expect(created.status).toBe(200)
    const paymentUrl = new URL(body.payment.codeUrl)
    const bizContent = JSON.parse(paymentUrl.searchParams.get('biz_content') || '{}') as Record<string, unknown>
    expect(`${paymentUrl.origin}${paymentUrl.pathname}`).toBe(fixture.config.gatewayUrl)
    expect(paymentUrl.searchParams.get('method')).toBe('alipay.trade.page.pay')
    expect(paymentUrl.searchParams.get('app_id')).toBe(fixture.config.appId)
    expect(paymentUrl.searchParams.get('sign_type')).toBe('RSA2')
    expect(paymentUrl.searchParams.get('notify_url')).toBe(fixture.config.notifyUrl)
    expect(paymentUrl.searchParams.get('sign')).toBeTruthy()
    expect(bizContent.out_trade_no).toBe(body.order.orderId)
    expect(bizContent.total_amount).toBe('49.00')
    expect(bizContent.product_code).toBe('FAST_INSTANT_TRADE_PAY')
    expect(body.order.paymentProvider).toBe('alipay')
    expect(body.order.paymentCodeUrl).toBe(body.payment.codeUrl)
    expect(body.order.paymentExpiresAt).toBe(body.payment.expiresAt)
    expect(body.orderToken.startsWith('ord_')).toBe(true)
    expect(body.payment.provider).toBe('alipay')
    expect(body.payment.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  test('reuses the same pending order when switching payment providers', async () => {
    const wechatFixture = await makeWechatPayFixture(tmpDir)
    const alipayFixture = await makeAlipayFixture(tmpDir)
    const nativeCalls: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      nativeCalls.push({ url: String(input), body })
      return signedWechatResponse(wechatFixture, JSON.stringify({ code_url: 'weixin://wxpay/reuse-test' }))
    }) as typeof fetch

    const { handler } = makeGateway({
      wechatPay: wechatFixture.config,
      alipay: alipayFixture.config,
    })
    const wechatCreated = await handler(jsonRequest('/v1/orders', {
      packageId: 'light-monthly',
      contact: 'switch-provider',
      paymentProvider: 'wechat',
    }))
    const wechatBody = await wechatCreated.json() as {
      order: { orderId: string; paymentProvider: string | null }
      orderToken: string
      payment: { provider: string; codeUrl: string }
    }
    const alipayCreated = await handler(jsonRequest('/v1/orders', {
      packageId: 'light-monthly',
      contact: 'switch-provider-updated',
      paymentProvider: 'alipay',
      orderId: wechatBody.order.orderId,
      orderToken: wechatBody.orderToken,
    }))
    const alipayBody = await alipayCreated.json() as {
      order: { orderId: string; paymentProvider: string | null; paymentCodeUrl: string | null }
      orderToken: string
      payment: { provider: string; codeUrl: string }
    }

    expect(wechatCreated.status).toBe(200)
    expect(alipayCreated.status).toBe(200)
    expect(nativeCalls).toHaveLength(1)
    expect(wechatBody.order.orderId).toBe(alipayBody.order.orderId)
    expect(wechatBody.orderToken).toBe(alipayBody.orderToken)
    expect(wechatBody.payment.provider).toBe('wechat')
    expect(alipayBody.payment.provider).toBe('alipay')
    expect(alipayBody.order.paymentProvider).toBe('alipay')
    expect(alipayBody.order.paymentCodeUrl).toBe(alipayBody.payment.codeUrl)
  })

  test('rejects invalid Alipay notifications without fulfilling orders', async () => {
    const fixture = await makeAlipayFixture(tmpDir)
    const { handler, store } = makeGateway({ alipay: fixture.config })
    const order = store.createOrder({ packageId: 'light-monthly' })
    const orderToken = store.getOrderToken(order.orderId)

    const invalidSignature = await handler(alipayNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'ali-tx-invalid-signature',
      amountCents: order.amountCents,
      tamperSignature: true,
    }))
    const wrongAmount = await handler(alipayNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'ali-tx-wrong-amount',
      amountCents: order.amountCents + 1,
    }))
    const unknownOrder = await handler(alipayNotifyRequest(fixture, {
      orderId: 'GUGU-20990101-NOTFOUND',
      transactionId: 'ali-tx-unknown-order',
      amountCents: order.amountCents,
    }))
    const status = await handler(orderStatusRequest(order.orderId, orderToken))
    const statusBody = await status.json() as { order: { status: string }; licenseKey: string | null }

    expect(invalidSignature.status).toBe(400)
    expect(await invalidSignature.text()).toBe('fail')
    expect(wrongAmount.status).toBe(400)
    expect(unknownOrder.status).toBe(400)
    expect(statusBody.order.status).toBe('pending_payment')
    expect(statusBody.licenseKey).toBeNull()
  })

  test('fulfills Alipay success notifications idempotently', async () => {
    const fixture = await makeAlipayFixture(tmpDir)
    const { handler, store } = makeGateway({ alipay: fixture.config })
    const order = store.createOrder({ packageId: 'max-monthly' })
    const orderToken = store.getOrderToken(order.orderId)

    const firstNotify = await handler(alipayNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'ali-tx-success',
      amountCents: order.amountCents,
    }))
    const firstStatus = await handler(orderStatusRequest(order.orderId, orderToken))
    const firstStatusBody = await firstStatus.json() as {
      order: { status: string; alipayTradeNo: string | null; paidAmountCents: number | null }
      licenseKey: string | null
    }
    const secondNotify = await handler(alipayNotifyRequest(fixture, {
      orderId: order.orderId,
      transactionId: 'ali-tx-success',
      amountCents: order.amountCents,
    }))
    const secondStatus = await handler(orderStatusRequest(order.orderId, orderToken))
    const secondStatusBody = await secondStatus.json() as { licenseKey: string | null }

    expect(firstNotify.status).toBe(200)
    expect(await firstNotify.text()).toBe('success')
    expect(secondNotify.status).toBe(200)
    expect(await secondNotify.text()).toBe('success')
    expect(firstStatusBody.order.status).toBe('fulfilled')
    expect(firstStatusBody.order.alipayTradeNo).toBe('ali-tx-success')
    expect(firstStatusBody.order.paidAmountCents).toBe(order.amountCents)
    expect(firstStatusBody.licenseKey?.startsWith('GUGU-')).toBe(true)
    expect(secondStatusBody.licenseKey).toBe(firstStatusBody.licenseKey)
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
      icpRecord: null,
      icpUrl: 'https://beian.miit.gov.cn/',
      downloadUrl: null,
      downloadWindowsUrl: null,
      downloadMacosUrl: null,
      downloadVersion: null,
      downloadSha256: null,
      downloadWindowsSha256: null,
      downloadMacosSha256: null,
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
      wechatPay: disabledWechatPayConfig(),
      alipay: disabledAlipayConfig(),
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

function orderStatusRequest(orderId: string, orderToken?: string): Request {
  return new Request(`http://localhost/v1/orders/${encodeURIComponent(orderId)}/status`, {
    headers: {
      ...(orderToken ? { 'X-Gugu-Order-Token': orderToken } : {}),
    },
  })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

type WechatPayFixture = {
  config: GatewayConfig['wechatPay']
  wechatPrivateKey: KeyObject
}

async function makeWechatPayFixture(baseDir: string): Promise<WechatPayFixture> {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const wechat = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const merchantPrivateKeyPath = path.join(baseDir, `merchant-${randomBytes(4).toString('hex')}.pem`)
  const wechatPublicKeyPath = path.join(baseDir, `wechat-${randomBytes(4).toString('hex')}.pem`)
  await fs.writeFile(
    merchantPrivateKeyPath,
    merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  )
  await fs.writeFile(
    wechatPublicKeyPath,
    wechat.publicKey.export({ type: 'spki', format: 'pem' }),
  )

  return {
    config: {
      enabled: true,
      appId: 'wx-app-id',
      mchId: '1900000001',
      merchantCertSerialNo: 'MERCHANT_SERIAL_NO',
      privateKeyPath: merchantPrivateKeyPath,
      wechatPayPublicKeyId: 'PUB_KEY_ID_TEST',
      wechatPayPublicKeyPath: wechatPublicKeyPath,
      apiV3Key: '12345678901234567890123456789012',
      notifyUrl: 'https://gugu.example.com/v1/payments/wechat/notify',
    },
    wechatPrivateKey: wechat.privateKey,
  }
}

function disabledWechatPayConfig(): GatewayConfig['wechatPay'] {
  return {
    enabled: false,
    appId: '',
    mchId: '',
    merchantCertSerialNo: '',
    privateKeyPath: '',
    wechatPayPublicKeyId: '',
    wechatPayPublicKeyPath: '',
    apiV3Key: '',
    notifyUrl: null,
  }
}

type AlipayFixture = {
  config: GatewayConfig['alipay']
  alipayPrivateKey: KeyObject
}

async function makeAlipayFixture(baseDir: string): Promise<AlipayFixture> {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const alipay = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const merchantPrivateKeyPath = path.join(baseDir, `alipay-merchant-${randomBytes(4).toString('hex')}.pem`)
  const alipayPublicKeyPath = path.join(baseDir, `alipay-public-${randomBytes(4).toString('hex')}.pem`)
  await fs.writeFile(
    merchantPrivateKeyPath,
    merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  )
  await fs.writeFile(
    alipayPublicKeyPath,
    alipay.publicKey.export({ type: 'spki', format: 'pem' }),
  )

  return {
    config: {
      enabled: true,
      appId: '2021000000000000',
      privateKeyPath: merchantPrivateKeyPath,
      alipayPublicKeyPath,
      notifyUrl: 'https://gugu.example.com/v1/payments/alipay/notify',
      gatewayUrl: 'https://openapi.alipay.test/gateway.do',
      sellerId: '2088000000000000',
    },
    alipayPrivateKey: alipay.privateKey,
  }
}

function disabledAlipayConfig(): GatewayConfig['alipay'] {
  return {
    enabled: false,
    appId: '',
    privateKeyPath: '',
    alipayPublicKeyPath: '',
    notifyUrl: null,
    gatewayUrl: 'https://openapi.alipay.com/gateway.do',
    sellerId: '',
  }
}

function alipayNotifyRequest(
  fixture: AlipayFixture,
  input: {
    orderId: string
    transactionId: string
    amountCents: number
    tradeStatus?: 'TRADE_SUCCESS' | 'TRADE_FINISHED' | 'WAIT_BUYER_PAY'
    tamperSignature?: boolean
  },
): Request {
  const params: Record<string, string> = {
    app_id: fixture.config.appId,
    seller_id: fixture.config.sellerId,
    notify_time: '2026-05-22 10:00:00',
    notify_type: 'trade_status_sync',
    notify_id: `notify-${randomBytes(4).toString('hex')}`,
    out_trade_no: input.orderId,
    trade_no: input.transactionId,
    trade_status: input.tradeStatus || 'TRADE_SUCCESS',
    total_amount: formatTestAmountYuan(input.amountCents),
    gmt_payment: '2026-05-22 10:00:00',
    subject: 'Gugu Agent',
  }
  const signedPayload = canonicalizeAlipayNotifyParams(params)
  params.sign_type = 'RSA2'
  params.sign = signAlipayPayload(
    fixture.alipayPrivateKey,
    input.tamperSignature ? `${signedPayload}x` : signedPayload,
  )
  return new Request('http://localhost/v1/payments/alipay/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams(params).toString(),
  })
}

function canonicalizeAlipayNotifyParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== 'sign' && key !== 'sign_type' && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

function signAlipayPayload(privateKey: KeyObject, payload: string): string {
  return sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64')
}

function formatTestAmountYuan(amountCents: number): string {
  return (amountCents / 100).toFixed(2)
}

function signedWechatResponse(fixture: WechatPayFixture, body: string, init?: ResponseInit): Response {
  const timestamp = '1779152400'
  const nonce = 'test-notify-nonce'
  const signature = signWechatPayload(fixture.wechatPrivateKey, `${timestamp}\n${nonce}\n${body}\n`)
  return new Response(body, {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      'Wechatpay-Serial': fixture.config.wechatPayPublicKeyId,
      'Wechatpay-Signature': signature,
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      ...(init?.headers ?? {}),
    },
  })
}

function wechatNotifyRequest(
  fixture: WechatPayFixture,
  input: {
    orderId: string
    transactionId: string
    amountCents: number
    tamperSignature?: boolean
  },
): Request {
  const rawBody = JSON.stringify({
    id: `notify-${randomBytes(4).toString('hex')}`,
    event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: encryptWechatResource(fixture, {
      out_trade_no: input.orderId,
      transaction_id: input.transactionId,
      trade_state: 'SUCCESS',
      success_time: '2026-05-21T10:00:00+08:00',
      amount: {
        total: input.amountCents,
        currency: 'CNY',
      },
    }),
  })
  const timestamp = '1779152400'
  const nonce = `nonce-${randomBytes(4).toString('hex')}`
  const signature = signWechatPayload(
    fixture.wechatPrivateKey,
    `${timestamp}\n${nonce}\n${input.tamperSignature ? `${rawBody}x` : rawBody}\n`,
  )
  return new Request('http://localhost/v1/payments/wechat/notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Wechatpay-Serial': fixture.config.wechatPayPublicKeyId,
      'Wechatpay-Signature': signature,
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
    },
    body: rawBody,
  })
}

function encryptWechatResource(
  fixture: WechatPayFixture,
  payload: Record<string, unknown>,
): Record<string, string> {
  const nonce = randomBytes(12).toString('hex').slice(0, 12)
  const associatedData = 'transaction'
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(fixture.config.apiV3Key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  )
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
    associated_data: associatedData,
    nonce,
    original_type: 'transaction',
  }
}

function signWechatPayload(privateKey: KeyObject, payload: string): string {
  return sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64')
}

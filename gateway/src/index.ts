import { loadGatewayConfig } from './config.js'
import { createBuyPageHtml } from './buyPage.js'
import { createDashboardPageHtml } from './dashboardPage.js'
import { createDownloadPageHtml, createHomePageHtml } from './sitePages.js'
import { isPurchasablePackageId } from './packages.js'
import {
  GatewayAuthError,
  GatewayQuotaError,
  GatewayStore,
} from './store.js'
import type {
  GatewayConfig,
  GatewayEntitlement,
  GatewayErrorBody,
  GatewayOrderStatus,
  GatewayPlan,
} from './types.js'

type JsonRecord = Record<string, unknown>

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
}

export function createGatewayHandler(config: GatewayConfig, store = new GatewayStore(config)) {
  return async function handleGatewayRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/admin/api/')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      })
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true })
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
        return html(createHomePageHtml(config))
      }

      if (req.method === 'GET' && (url.pathname === '/download' || url.pathname === '/download/')) {
        return html(createDownloadPageHtml(config))
      }

      if (req.method === 'GET' && (url.pathname === '/buy' || url.pathname === '/buy/')) {
        return html(createBuyPageHtml())
      }

      if (req.method === 'GET' && (url.pathname === '/admin/dashboard' || url.pathname === '/admin/dashboard/')) {
        if (!config.adminToken) return adminErrorJson(404, 'ADMIN_DISABLED', 'Admin dashboard is not enabled.')
        return html(createDashboardPageHtml())
      }

      if (req.method === 'POST' && url.pathname === '/v1/devices') {
        const body = await readJson(req)
        return json(store.registerDevice({
          deviceId: asString(body.deviceId),
          appVersion: asString(body.appVersion),
          platform: asString(body.platform),
        }))
      }

      if (req.method === 'GET' && url.pathname === '/v1/entitlement') {
        return json(store.getEntitlement(readDeviceToken(req)))
      }

      if (req.method === 'POST' && url.pathname === '/v1/activate') {
        const body = await readJson(req)
        const licenseKey = asString(body.licenseKey)
        if (!licenseKey) return errorJson(400, 'BAD_REQUEST', 'licenseKey is required')
        return json({ entitlement: store.activate(readDeviceToken(req), licenseKey) })
      }

      if (req.method === 'POST' && url.pathname === '/v1/orders') {
        const body = await readJson(req)
        const packageId = asString(body.packageId)
        if (!packageId) return errorJson(400, 'BAD_REQUEST', 'packageId is required')
        if (!isPurchasablePackageId(packageId)) return errorJson(400, 'BAD_REQUEST', 'Package is not available for purchase.')
        return json({ order: store.createOrder({ packageId, contact: asString(body.contact) }) })
      }

      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        return await forwardMessage(req, config, store)
      }

      if (req.method === 'POST' && url.pathname === '/v1/attachments/parse') {
        return await forwardAttachment(req, config, store)
      }

      if (url.pathname.startsWith('/admin/api/')) {
        return handleAdminApi(req, url, config, store)
      }

      return errorJson(404, 'NOT_FOUND', `Unknown gateway endpoint: ${url.pathname}`)
    } catch (error) {
      return handleGatewayError(error)
    }
  }
}

export function startGateway(): void {
  const config = loadGatewayConfig()
  const port = Number.parseInt(process.env.GUGU_GATEWAY_PORT || '8787', 10)
  const host = process.env.GUGU_GATEWAY_HOST || '127.0.0.1'
  const fetch = createGatewayHandler(config)
  Bun.serve({ port, hostname: host, fetch })
  console.log(`[gugu-gateway] listening on http://${host}:${port}`)
}

async function forwardMessage(
  req: Request,
  config: GatewayConfig,
  store: GatewayStore,
): Promise<Response> {
  if (!config.deepseekApiKey) {
    return errorJson(503, 'UPSTREAM_NOT_CONFIGURED', 'GUGU_DEEPSEEK_API_KEY is not configured')
  }

  const deviceToken = readDeviceToken(req)
  const body = await readJson(req)
  const upstreamModel = resolveDeepSeekModel(config, asString(body.model))
  const creditCost = config.messageCreditCost
  body.model = upstreamModel

  const reservation = store.consumeUsage(deviceToken, 'message', upstreamModel, creditCost, {
    upstream: 'deepseek',
  })
  let upstream: Response
  try {
    upstream = await fetch(`${config.deepseekBaseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.deepseekApiKey,
        'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01',
        ...(req.headers.get('anthropic-beta')
          ? { 'anthropic-beta': req.headers.get('anthropic-beta')! }
          : {}),
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    store.refundCredit(deviceToken, creditCost)
    store.recordUsageTokens(reservation.usageEventId, {}, { upstreamError: 'network' })
    throw error
  }

  const headers = new Headers(upstream.headers)
  headers.set('x-gugu-credits-remaining', String(reservation.entitlement.creditsRemaining))
  headers.set('access-control-expose-headers', 'x-gugu-credits-remaining')

  if (!upstream.ok) {
    const refunded = store.refundCredit(deviceToken, creditCost)
    const text = await upstream.text().catch(() => '')
    store.recordUsageTokens(reservation.usageEventId, {}, {
      upstreamStatus: upstream.status,
      refundedCredits: creditCost,
    })
    return errorJson(
      upstream.status,
      upstream.status === 401 ? 'UPSTREAM_AUTH_FAILED' : 'UPSTREAM_ERROR',
      text || `DeepSeek returned HTTP ${upstream.status}`,
      refunded,
    )
  }

  const contentType = upstream.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const raw = await upstream.text()
    const parsed = parseJson(raw)
    store.recordUsageTokens(reservation.usageEventId, extractUsageTokens(parsed), {
      upstreamStatus: upstream.status,
      stream: false,
    })
    return new Response(raw, {
      status: upstream.status,
      headers,
    })
  }

  const bodyStream = upstream.body
    ? trackUsageStream(upstream.body, store, reservation.usageEventId)
    : upstream.body

  return new Response(bodyStream, {
    status: upstream.status,
    headers,
  })
}

async function forwardAttachment(
  req: Request,
  config: GatewayConfig,
  store: GatewayStore,
): Promise<Response> {
  if (!config.glmApiKey) {
    return errorJson(503, 'UPSTREAM_NOT_CONFIGURED', 'GUGU_GLM_API_KEY is not configured')
  }

  const deviceToken = readDeviceToken(req)
  const body = await readJson(req)
  const operation = asString(body.operation)

  let consumedCredits = 0
  let usageEventId: number | null = null
  try {
    if (operation === 'chat_completions' || operation === 'layout_parsing') {
      const usage = resolveAttachmentUsage(config, operation, body.body)
      const reservation = store.consumeUsage(deviceToken, usage.kind, usage.model, usage.credits, {
        operation,
        upstream: 'glm',
      })
      consumedCredits = usage.credits
      usageEventId = reservation.usageEventId
      const endpoint = operation === 'chat_completions' ? '/chat/completions' : '/layout_parsing'
      const upstream = await fetch(`${config.glmBaseUrl.replace(/\/+$/, '')}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.glmApiKey}`,
        },
        body: JSON.stringify(body.body ?? {}),
        signal: AbortSignal.timeout(120_000),
      })
      return proxyJsonResponse(
        upstream,
        upstream.ok ? reservation.entitlement : store.refundCredit(deviceToken, usage.credits),
        store,
        reservation.usageEventId,
        { operation, upstream: 'glm' },
      )
    }

    if (operation === 'file_parser') {
      const name = asString(body.name) || 'attachment.bin'
      const mimeType = asString(body.mimeType) || 'application/octet-stream'
      const dataBase64 = asString(body.dataBase64)
      if (!dataBase64) return errorJson(400, 'BAD_REQUEST', 'dataBase64 is required')

      const usage = resolveAttachmentUsage(config, operation, body.body)
      const reservation = store.consumeUsage(deviceToken, usage.kind, usage.model, usage.credits, {
        operation,
        upstream: 'glm',
        fileName: name,
        mimeType,
      })
      consumedCredits = usage.credits
      usageEventId = reservation.usageEventId
      const form = new FormData()
      form.append('tool_type', 'prime-sync')
      form.append('file', new Blob([Buffer.from(dataBase64, 'base64')], { type: mimeType }), name)
      const upstream = await fetch(`${config.glmBaseUrl.replace(/\/+$/, '')}/files/parser/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.glmApiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      })
      return proxyJsonResponse(
        upstream,
        upstream.ok ? reservation.entitlement : store.refundCredit(deviceToken, usage.credits),
        store,
        reservation.usageEventId,
        { operation, upstream: 'glm', fileName: name, mimeType },
      )
    }

    return errorJson(400, 'BAD_REQUEST', 'Unsupported attachment parse operation')
  } catch (error) {
    if (consumedCredits > 0 && !(error instanceof GatewayQuotaError) && !(error instanceof GatewayAuthError)) {
      store.refundCredit(deviceToken, consumedCredits)
      if (usageEventId) store.recordUsageTokens(usageEventId, {}, { upstreamError: 'network' })
    }
    throw error
  }
}

async function proxyJsonResponse(
  upstream: Response,
  entitlement: GatewayEntitlement,
  store?: GatewayStore,
  usageEventId?: number,
  metadata?: Record<string, unknown>,
): Promise<Response> {
  const raw = await upstream.text()
  if (store && usageEventId) {
    const parsed = parseJson(raw)
    store.recordUsageTokens(usageEventId, extractUsageTokens(parsed), {
      ...(metadata ?? {}),
      upstreamStatus: upstream.status,
      ...(upstream.ok ? {} : { refundedCredits: true }),
    })
  }
  const headers = new Headers({
    ...JSON_HEADERS,
    'x-gugu-credits-remaining': String(entitlement.creditsRemaining),
    'access-control-expose-headers': 'x-gugu-credits-remaining',
  })
  return new Response(raw, { status: upstream.status, headers })
}

function handleAdminApi(
  req: Request,
  url: URL,
  config: GatewayConfig,
  store: GatewayStore,
): Response {
  try {
    const authError = requireAdmin(config, req)
    if (authError) return authError

    if (req.method === 'GET' && url.pathname === '/admin/api/summary') {
      const range = asDashboardRange(url.searchParams.get('range') || '7d')
      return adminJson(store.getDashboardSummary(range))
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/devices') {
      const devices = store.listDevices({
        plan: asString(url.searchParams.get('plan')) as GatewayPlan | undefined,
        status: asString(url.searchParams.get('status')) as GatewayEntitlement['status'] | undefined,
        q: asString(url.searchParams.get('q')),
        limit: asPositiveInt(url.searchParams.get('limit')),
        cursor: asPositiveInt(url.searchParams.get('cursor')),
      })
      return adminJson({
        ...devices,
        data: devices.data.map((device) => ({
          ...device,
          deviceToken: maskSecret(device.deviceToken),
          licenseKey: device.licenseKey ? maskSecret(device.licenseKey) : null,
        })),
      })
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/usage') {
      const limit = asPositiveInt(url.searchParams.get('limit')) || 50
      const data = store.listUsageEvents({
        deviceId: asString(url.searchParams.get('deviceId')),
        limit,
        cursor: asPositiveInt(url.searchParams.get('cursor')),
      })
      return adminJson({
        data,
        pagination: {
          limit,
          nextCursor: data.length === limit ? data[data.length - 1]?.id ?? null : null,
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/orders') {
      return adminJson(store.listOrders({
        status: asString(url.searchParams.get('status')) as GatewayOrderStatus | undefined,
        q: asString(url.searchParams.get('q')),
        limit: asPositiveInt(url.searchParams.get('limit')),
        cursor: asPositiveInt(url.searchParams.get('cursor')),
      }))
    }

    if (req.method === 'GET' && url.pathname === '/admin/api/download') {
      return adminJson({
        downloadUrl: config.downloadUrl,
        downloadVersion: config.downloadVersion,
        downloadSha256: config.downloadSha256,
        publicBaseUrl: config.publicBaseUrl,
      })
    }

    const orderAction = url.pathname.match(/^\/admin\/api\/orders\/([^/]+)\/(pay|fulfill|cancel)$/)
    if (req.method === 'POST' && orderAction) {
      const orderId = decodeURIComponent(orderAction[1]!)
      const action = orderAction[2]
      const order = action === 'pay'
        ? store.markOrderPaid(orderId)
        : action === 'fulfill'
          ? store.fulfillOrder(orderId)
          : store.cancelOrder(orderId)
      return adminJson({ order })
    }

    return adminErrorJson(404, 'NOT_FOUND', `Unknown admin endpoint: ${url.pathname}`)
  } catch (error) {
    return adminErrorJson(400, 'ADMIN_REQUEST_FAILED', error instanceof Error ? error.message : String(error))
  }
}

function resolveDeepSeekModel(config: GatewayConfig, requested: string | undefined): string {
  if (requested === 'gugu-managed-fast') return config.deepseekFastModel
  if (requested === 'gugu-managed-main' || requested === 'gugu-managed-strong') return config.deepseekMainModel
  return requested?.trim() || config.deepseekMainModel
}

async function readJson(req: Request): Promise<JsonRecord> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as JsonRecord : {}
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function readDeviceToken(req: Request): string {
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const token = bearer || req.headers.get('x-gugu-device-token')?.trim()
  if (!token) {
    throw new GatewayAuthError('Missing Gugu device token')
  }
  return token
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asPositiveInt(value: unknown): number | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined
}

function asDashboardRange(value: string): '7d' | '30d' | 'all' {
  return value === '30d' || value === 'all' ? value : '7d'
}

function handleGatewayError(error: unknown): Response {
  if (error instanceof GatewayQuotaError) {
    return errorJson(error.statusCode, 'GUGU_QUOTA_EXHAUSTED', error.message, error.entitlement)
  }
  if (error instanceof GatewayAuthError) {
    return errorJson(401, 'UNAUTHORIZED', error.message)
  }
  if (error instanceof Error && error.message === 'Invalid JSON body') {
    return errorJson(400, 'BAD_REQUEST', error.message)
  }
  console.error('[gugu-gateway] unexpected error:', error)
  return errorJson(500, 'INTERNAL_ERROR', 'Gateway internal error')
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(),
      ...(init?.headers ?? {}),
    },
  })
}

function adminJson(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  })
}

function adminErrorJson(status: number, code: string, message: string): Response {
  return adminJson({ error: { code, message } }, { status })
}

function requireAdmin(config: GatewayConfig, req: Request): Response | null {
  if (!config.adminToken) return adminErrorJson(404, 'ADMIN_DISABLED', 'Admin dashboard is not enabled.')
  const auth = req.headers.get('authorization') || ''
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token || token !== config.adminToken) {
    return adminErrorJson(401, 'UNAUTHORIZED', 'Admin token is required.')
  }
  return null
}

function resolveAttachmentUsage(
  config: GatewayConfig,
  operation: string | undefined,
  payload: unknown,
): { kind: string; model: string; credits: number } {
  const model = extractPayloadModel(payload)
  if (operation === 'file_parser') {
    return { kind: 'file_parser', model: model || 'glm-file-parser', credits: config.fileParseCreditCost }
  }
  if (operation === 'layout_parsing') {
    return { kind: 'ocr', model: model || 'glm-ocr', credits: config.fileParseCreditCost }
  }
  if (model.includes('glm-5.1')) {
    return { kind: 'summarize', model, credits: config.summarizeCreditCost }
  }
  if (model.includes('glm-5v') || payloadHasImage(payload)) {
    return { kind: 'vision', model: model || 'glm-5v-turbo', credits: config.attachmentCreditCost }
  }
  return { kind: 'glm_text', model: model || 'glm-chat', credits: config.messageCreditCost }
}

function extractPayloadModel(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const model = (payload as { model?: unknown }).model
  return typeof model === 'string' ? model.trim() : ''
}

function payloadHasImage(payload: unknown): boolean {
  return (JSON.stringify(payload ?? {}) || '').includes('image_url')
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function extractUsageTokens(value: unknown): { inputTokens?: number | null; outputTokens?: number | null } {
  const usage = findUsageObject(value)
  if (!usage) return {}
  return {
    inputTokens: readTokenNumber(usage.input_tokens)
      ?? readTokenNumber(usage.inputTokens)
      ?? readTokenNumber(usage.prompt_tokens)
      ?? readTokenNumber(usage.promptTokens),
    outputTokens: readTokenNumber(usage.output_tokens)
      ?? readTokenNumber(usage.outputTokens)
      ?? readTokenNumber(usage.completion_tokens)
      ?? readTokenNumber(usage.completionTokens),
  }
}

function findUsageObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    'input_tokens' in record ||
    'output_tokens' in record ||
    'prompt_tokens' in record ||
    'completion_tokens' in record
  ) {
    return record
  }
  if (record.usage && typeof record.usage === 'object') return record.usage as Record<string, unknown>
  if (record.message && typeof record.message === 'object') {
    const usage = findUsageObject(record.message)
    if (usage) return usage
  }
  if (record.response && typeof record.response === 'object') {
    const usage = findUsageObject(record.response)
    if (usage) return usage
  }
  return null
}

function readTokenNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

function maskSecret(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function mergeUsage(
  current: { inputTokens: number | null; outputTokens: number | null },
  next: { inputTokens?: number | null; outputTokens?: number | null },
): void {
  if (typeof next.inputTokens === 'number') {
    current.inputTokens = Math.max(current.inputTokens ?? 0, next.inputTokens)
  }
  if (typeof next.outputTokens === 'number') {
    current.outputTokens = Math.max(current.outputTokens ?? 0, next.outputTokens)
  }
}

function trackUsageStream(
  body: ReadableStream<Uint8Array>,
  store: GatewayStore,
  usageEventId: number,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  const tokens = { inputTokens: null as number | null, outputTokens: null as number | null }

  const parseChunk = (text: string) => {
    buffer += text
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      mergeUsage(tokens, extractUsageTokens(parseJson(data)))
    }
  }

  const persist = (metadata?: Record<string, unknown>) => {
    if (finished) return
    finished = true
    store.recordUsageTokens(usageEventId, tokens, {
      stream: true,
      usageCaptured: tokens.inputTokens !== null || tokens.outputTokens !== null,
      ...(metadata ?? {}),
    })
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            parseChunk(decoder.decode(value, { stream: true }))
            controller.enqueue(value)
          }
        }
        const tail = decoder.decode()
        if (tail) parseChunk(tail)
        if (buffer.trim()) {
          const line = buffer.trim()
          if (line.startsWith('data:')) mergeUsage(tokens, extractUsageTokens(parseJson(line.slice(5).trim())))
        }
        persist()
        controller.close()
      } catch (error) {
        persist({ streamError: error instanceof Error ? error.message : String(error) })
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    cancel(reason) {
      persist({ streamCancelled: String(reason ?? '') })
    },
  })
}

function html(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: {
      ...HTML_HEADERS,
      ...(init?.headers ?? {}),
    },
  })
}

function errorJson(
  status: number,
  code: string,
  message: string,
  entitlement?: GatewayEntitlement,
): Response {
  const body: GatewayErrorBody = {
    error: {
      code,
      message,
      ...(entitlement ? { entitlement } : {}),
    },
  }
  return json(body, { status })
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-gugu-device-token, anthropic-version, anthropic-beta',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

if (import.meta.main) {
  startGateway()
}

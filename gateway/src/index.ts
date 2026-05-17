import { loadGatewayConfig } from './config.js'
import {
  GatewayAuthError,
  GatewayQuotaError,
  GatewayStore,
} from './store.js'
import type { GatewayConfig, GatewayEntitlement, GatewayErrorBody } from './types.js'

type JsonRecord = Record<string, unknown>

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function createGatewayHandler(config: GatewayConfig, store = new GatewayStore(config)) {
  return async function handleGatewayRequest(req: Request): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true })
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

      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        return await forwardMessage(req, config, store)
      }

      if (req.method === 'POST' && url.pathname === '/v1/attachments/parse') {
        return await forwardAttachment(req, config, store)
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
  body.model = upstreamModel

  const entitlement = store.consumeCredit(deviceToken, 'message', upstreamModel)
  const upstream = await fetch(`${config.deepseekBaseUrl.replace(/\/+$/, '')}/v1/messages`, {
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

  const headers = new Headers(upstream.headers)
  headers.set('x-gugu-credits-remaining', String(entitlement.creditsRemaining))
  headers.set('access-control-expose-headers', 'x-gugu-credits-remaining')

  if (!upstream.ok) {
    const refunded = store.refundCredit(deviceToken)
    const text = await upstream.text().catch(() => '')
    return errorJson(
      upstream.status,
      upstream.status === 401 ? 'UPSTREAM_AUTH_FAILED' : 'UPSTREAM_ERROR',
      text || `DeepSeek returned HTTP ${upstream.status}`,
      refunded,
    )
  }

  return new Response(upstream.body, {
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

  try {
    if (operation === 'chat_completions' || operation === 'layout_parsing') {
      const entitlement = store.consumeCredit(deviceToken, 'attachment', operation)
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
      return proxyJsonResponse(upstream, upstream.ok ? entitlement : store.refundCredit(deviceToken))
    }

    if (operation === 'file_parser') {
      const name = asString(body.name) || 'attachment.bin'
      const mimeType = asString(body.mimeType) || 'application/octet-stream'
      const dataBase64 = asString(body.dataBase64)
      if (!dataBase64) return errorJson(400, 'BAD_REQUEST', 'dataBase64 is required')

      const entitlement = store.consumeCredit(deviceToken, 'attachment', operation)
      const form = new FormData()
      form.append('tool_type', 'prime-sync')
      form.append('file', new Blob([Buffer.from(dataBase64, 'base64')], { type: mimeType }), name)
      const upstream = await fetch(`${config.glmBaseUrl.replace(/\/+$/, '')}/files/parser/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.glmApiKey}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      })
      return proxyJsonResponse(upstream, upstream.ok ? entitlement : store.refundCredit(deviceToken))
    }

    return errorJson(400, 'BAD_REQUEST', 'Unsupported attachment parse operation')
  } catch (error) {
    store.refundCredit(deviceToken)
    throw error
  }
}

async function proxyJsonResponse(upstream: Response, entitlement: GatewayEntitlement): Promise<Response> {
  const raw = await upstream.text()
  const headers = new Headers({
    ...JSON_HEADERS,
    'x-gugu-credits-remaining': String(entitlement.creditsRemaining),
    'access-control-expose-headers': 'x-gugu-credits-remaining',
  })
  return new Response(raw, { status: upstream.status, headers })
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

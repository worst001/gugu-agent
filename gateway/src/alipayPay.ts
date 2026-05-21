import * as fs from 'node:fs'
import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto'
import { toDataURL } from 'qrcode'
import type {
  GatewayAlipayConfig,
  GatewayConfig,
  GatewayOrder,
  GatewayPaymentResponse,
} from './types.js'

const PAYMENT_TTL_MINUTES = 30

type AlipayPrecreateResponse = {
  code?: unknown
  msg?: unknown
  sub_code?: unknown
  sub_msg?: unknown
  out_trade_no?: unknown
  qr_code?: unknown
}

export type AlipayPaymentResult = GatewayPaymentResponse & {
  payload: Record<string, unknown>
}

export type AlipayPaidOrder = {
  orderId: string
  transactionId: string
  tradeState: string
  successTime: string | null
  amountCents: number
  payload: Record<string, unknown>
}

export function isAlipayReady(config: GatewayConfig): boolean {
  const alipay = config.alipay
  return Boolean(
    alipay &&
    alipay.enabled &&
    alipay.appId &&
    alipay.privateKeyPath &&
    alipay.alipayPublicKeyPath &&
    alipay.notifyUrl &&
    alipay.gatewayUrl,
  )
}

export async function createAlipayPrecreatePayment(
  config: GatewayConfig,
  order: GatewayOrder,
): Promise<AlipayPaymentResult> {
  assertAlipayReady(config)
  const alipay = config.alipay
  const expiresAt = new Date(Date.now() + PAYMENT_TTL_MINUTES * 60 * 1000).toISOString()
  const bizContent = {
    out_trade_no: order.orderId,
    total_amount: formatAmountYuan(order.amountCents),
    subject: truncateText(`Gugu Agent ${order.packageName}`, 127),
    body: truncateText(order.packageId, 128),
    timeout_express: `${PAYMENT_TTL_MINUTES}m`,
    qr_code_timeout_express: `${PAYMENT_TTL_MINUTES}m`,
  }
  const params = buildAlipayCommonParams(alipay, 'alipay.trade.precreate', {
    notify_url: alipay.notifyUrl!,
    biz_content: JSON.stringify(bizContent),
  })
  const responseText = await signedAlipayPost(alipay, params)
  const parsed = parseAlipayResponse(alipay, responseText, 'alipay_trade_precreate_response') as AlipayPrecreateResponse
  assertAlipaySuccess(parsed)
  const returnedOrderId = stringField(parsed.out_trade_no)
  if (returnedOrderId && returnedOrderId !== order.orderId) {
    throw new Error('Alipay precreate response order id does not match the order.')
  }
  const codeUrl = stringField(parsed.qr_code)
  if (!codeUrl) throw new Error('Alipay precreate response did not include qr_code.')

  return {
    provider: 'alipay',
    codeUrl,
    qrDataUrl: await toDataURL(codeUrl, { margin: 1, width: 260 }),
    expiresAt,
    payload: {
      precreateResponse: parsed as Record<string, unknown>,
    },
  }
}

export function parseAlipayPaymentNotify(
  config: GatewayConfig,
  rawBody: string,
): AlipayPaidOrder {
  assertAlipayReady(config)
  const alipay = config.alipay
  const params = parseFormBody(rawBody)
  validateAlipaySignature(alipay, params)

  const appId = params.get('app_id') || ''
  if (appId !== alipay.appId) throw new Error('Unexpected Alipay app_id.')
  const sellerId = params.get('seller_id') || ''
  if (alipay.sellerId && sellerId !== alipay.sellerId) {
    throw new Error('Unexpected Alipay seller_id.')
  }

  const tradeState = params.get('trade_status') || ''
  if (tradeState !== 'TRADE_SUCCESS' && tradeState !== 'TRADE_FINISHED') {
    throw new Error(`Unsupported Alipay trade status: ${tradeState || 'missing'}.`)
  }

  const orderId = params.get('out_trade_no') || ''
  const transactionId = params.get('trade_no') || ''
  const amountCents = parseAmountCents(params.get('total_amount') || '')
  if (!orderId) throw new Error('Alipay notify is missing out_trade_no.')
  if (!transactionId) throw new Error('Alipay notify is missing trade_no.')
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Alipay notify is missing total_amount.')
  }

  return {
    orderId,
    transactionId,
    tradeState,
    successTime: toAlipayIsoTime(params.get('gmt_payment') || params.get('notify_time') || ''),
    amountCents,
    payload: Object.fromEntries(params.entries()),
  }
}

function assertAlipayReady(config: GatewayConfig): void {
  if (!isAlipayReady(config)) throw new Error('Alipay is not fully configured.')
}

function buildAlipayCommonParams(
  config: GatewayAlipayConfig,
  method: string,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    app_id: config.appId,
    method,
    format: 'JSON',
    charset: 'UTF-8',
    sign_type: 'RSA2',
    timestamp: formatAlipayTimestamp(new Date()),
    version: '1.0',
    ...extra,
  }
}

async function signedAlipayPost(
  config: GatewayAlipayConfig,
  params: Record<string, string>,
): Promise<string> {
  const signed = {
    ...params,
    sign: signAlipayParams(config, params),
  }
  const response = await fetch(config.gatewayUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams(signed).toString(),
  })
  const responseText = await response.text()
  if (!response.ok) throw new Error(`Alipay request failed (${response.status}).`)
  return responseText
}

function parseAlipayResponse(
  config: GatewayAlipayConfig,
  raw: string,
  responseKey: string,
): Record<string, unknown> {
  const parsed = parseJson(raw) as Record<string, unknown>
  const response = parsed[responseKey]
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`Alipay response is missing ${responseKey}.`)
  }
  const signature = typeof parsed.sign === 'string' ? parsed.sign : ''
  if (signature) {
    const signedContent = extractAlipayResponseObject(raw, responseKey) || JSON.stringify(response)
    validateAlipayResponseSignature(signedContent, signature, config.alipayPublicKeyPath)
  }
  return response as Record<string, unknown>
}

function assertAlipaySuccess(response: AlipayPrecreateResponse): void {
  if (response.code === '10000') return
  const code = stringField(response.sub_code) || stringField(response.code)
  const message = stringField(response.sub_msg) || stringField(response.msg)
  throw new Error([code, message].filter(Boolean).join(': ') || 'Alipay returned an unsuccessful response.')
}

function signAlipayParams(config: GatewayAlipayConfig, params: Record<string, string>): string {
  const privateKey = createPrivateKey(normalizePrivateKey(fs.readFileSync(config.privateKeyPath, 'utf8')))
  return sign('RSA-SHA256', Buffer.from(canonicalizeAlipayRequestParams(params)), privateKey).toString('base64')
}

function validateAlipayResponseSignature(
  signedContent: string,
  signature: string,
  publicKeyPath: string,
): void {
  const publicKey = createPublicKey(normalizePublicKey(fs.readFileSync(publicKeyPath, 'utf8')))
  const valid = verify('RSA-SHA256', Buffer.from(signedContent), publicKey, Buffer.from(signature, 'base64'))
  if (!valid) throw new Error('Invalid Alipay response signature.')
}

function validateAlipaySignature(
  config: GatewayAlipayConfig,
  params: URLSearchParams,
): void {
  const signature = params.get('sign') || ''
  if (!signature) throw new Error('Missing Alipay signature.')
  const record: Record<string, string> = {}
  for (const [key, value] of params.entries()) record[key] = value
  const publicKey = createPublicKey(normalizePublicKey(fs.readFileSync(config.alipayPublicKeyPath, 'utf8')))
  const valid = verify('RSA-SHA256', Buffer.from(canonicalizeAlipayNotifyParams(record)), publicKey, Buffer.from(signature, 'base64'))
  if (!valid) throw new Error('Invalid Alipay signature.')
}

function canonicalizeAlipayRequestParams(params: Record<string, string>): string {
  return canonicalizeAlipayParams(params, new Set(['sign']))
}

function canonicalizeAlipayNotifyParams(params: Record<string, string>): string {
  return canonicalizeAlipayParams(params, new Set(['sign', 'sign_type']))
}

function canonicalizeAlipayParams(params: Record<string, string>, excludedKeys: Set<string>): string {
  return Object.keys(params)
    .filter((key) => !excludedKeys.has(key) && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

function extractAlipayResponseObject(raw: string, responseKey: string): string | null {
  const key = `"${responseKey}"`
  const keyIndex = raw.indexOf(key)
  if (keyIndex < 0) return null
  const colonIndex = raw.indexOf(':', keyIndex + key.length)
  if (colonIndex < 0) return null
  const objectStart = raw.indexOf('{', colonIndex + 1)
  if (objectStart < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = objectStart; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(objectStart, index + 1)
    }
  }

  return null
}

function parseFormBody(rawBody: string): URLSearchParams {
  return new URLSearchParams(rawBody)
}

function formatAmountYuan(amountCents: number): string {
  return (amountCents / 100).toFixed(2)
}

function parseAmountCents(value: string): number {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return NaN
  return Number.parseInt(match[1]!, 10) * 100 + Number.parseInt((match[2] || '').padEnd(2, '0'), 10)
}

function formatAlipayTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function toAlipayIsoTime(value: string): string | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return trimmed || null
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`
}

function normalizePrivateKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.includes('BEGIN')) return trimmed
  return wrapPem('PRIVATE KEY', trimmed)
}

function normalizePublicKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.includes('BEGIN')) return trimmed
  return wrapPem('PUBLIC KEY', trimmed)
}

function wrapPem(label: string, value: string): string {
  const body = value.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') || ''
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`
}

function stringField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function parseJson(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('Invalid Alipay JSON payload.')
  }
}

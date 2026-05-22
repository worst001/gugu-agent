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

export async function createAlipayPagePayment(
  config: GatewayConfig,
  order: GatewayOrder,
  orderToken: string,
): Promise<AlipayPaymentResult> {
  assertAlipayReady(config)
  const alipay = config.alipay
  const expiresAt = new Date(Date.now() + PAYMENT_TTL_MINUTES * 60 * 1000).toISOString()
  const bizContent = {
    out_trade_no: order.orderId,
    total_amount: formatAmountYuan(order.amountCents),
    subject: truncateText(`Gugu Agent ${order.packageName}`, 127),
    body: truncateText(order.packageId, 128),
    product_code: 'FAST_INSTANT_TRADE_PAY',
    timeout_express: `${PAYMENT_TTL_MINUTES}m`,
  }
  const params = buildAlipayCommonParams(alipay, 'alipay.trade.page.pay', {
    notify_url: alipay.notifyUrl!,
    biz_content: JSON.stringify(bizContent),
  })
  const signedParams = {
    ...params,
    sign: signAlipayParams(alipay, params),
  }
  const cashierUrl = buildAlipayGatewayUrl(alipay.gatewayUrl, signedParams)
  const codeUrl = buildAlipayCheckoutUrl(config.publicBaseUrl, order.orderId, orderToken) || cashierUrl

  return {
    provider: 'alipay',
    codeUrl,
    qrDataUrl: await toDataURL(codeUrl, { margin: 1, width: 300 }),
    expiresAt,
    payload: {
      method: 'alipay.trade.page.pay',
      productCode: bizContent.product_code,
      cashierUrl,
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

function signAlipayParams(config: GatewayAlipayConfig, params: Record<string, string>): string {
  const privateKey = createPrivateKey(normalizePrivateKey(fs.readFileSync(config.privateKeyPath, 'utf8')))
  return sign('RSA-SHA256', Buffer.from(canonicalizeAlipayRequestParams(params)), privateKey).toString('base64')
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

function buildAlipayGatewayUrl(gatewayUrl: string, params: Record<string, string>): string {
  const url = new URL(gatewayUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

function buildAlipayCheckoutUrl(publicBaseUrl: string | null, orderId: string, orderToken: string): string | null {
  if (!publicBaseUrl) return null
  const url = new URL('/v1/payments/alipay/checkout', publicBaseUrl)
  url.searchParams.set('orderId', orderId)
  url.searchParams.set('orderToken', orderToken)
  return url.toString()
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

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

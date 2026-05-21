import * as fs from 'node:fs'
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'
import { toDataURL } from 'qrcode'
import type {
  GatewayConfig,
  GatewayOrder,
  GatewayPaymentResponse,
  GatewayWechatPayConfig,
} from './types.js'

const WECHAT_PAY_HOST = 'https://api.mch.weixin.qq.com'
const WECHAT_PAY_AUTH_TYPE = 'WECHATPAY2-SHA256-RSA2048'
const PAYMENT_TTL_MS = 30 * 60 * 1000

type WechatNativeResponse = {
  code_url?: unknown
}

type WechatQueryResponse = {
  out_trade_no?: unknown
  transaction_id?: unknown
  trade_state?: unknown
  success_time?: unknown
  amount?: {
    total?: unknown
  }
}

type WechatNotifyBody = {
  id?: unknown
  event_type?: unknown
  resource_type?: unknown
  resource?: {
    algorithm?: unknown
    ciphertext?: unknown
    associated_data?: unknown
    nonce?: unknown
    original_type?: unknown
  }
}

export type WechatPaymentResult = GatewayPaymentResponse & {
  payload: Record<string, unknown>
}

export type WechatPaidOrder = {
  orderId: string
  transactionId: string
  tradeState: string
  successTime: string | null
  amountCents: number
  payload: Record<string, unknown>
}

export function isWechatPayReady(config: GatewayConfig): boolean {
  const wechat = config.wechatPay
  return Boolean(
    wechat &&
    wechat.enabled &&
    wechat.appId &&
    wechat.mchId &&
    wechat.merchantCertSerialNo &&
    wechat.privateKeyPath &&
    wechat.wechatPayPublicKeyId &&
    wechat.wechatPayPublicKeyPath &&
    wechat.apiV3Key.length === 32 &&
    wechat.notifyUrl,
  )
}

export async function createWechatNativePayment(
  config: GatewayConfig,
  order: GatewayOrder,
): Promise<WechatPaymentResult> {
  assertWechatReady(config)
  const wechat = config.wechatPay
  const expiresAt = new Date(Date.now() + PAYMENT_TTL_MS).toISOString()
  const body = JSON.stringify({
    appid: wechat.appId,
    mchid: wechat.mchId,
    description: truncateText(`Gugu Agent ${order.packageName}`, 127),
    out_trade_no: order.orderId,
    time_expire: toWechatTime(expiresAt),
    attach: order.packageId,
    notify_url: wechat.notifyUrl,
    amount: {
      total: order.amountCents,
      currency: order.currency,
    },
  })

  const response = await signedWechatFetch(wechat, 'POST', '/v3/pay/transactions/native', body)
  const responseText = await response.text()
  if (!response.ok) throw new Error(readWechatError(responseText) || `WeChat Native payment failed (${response.status}).`)
  validateWechatResponseSignature(wechat, response.headers, responseText)

  const parsed = parseJson(responseText) as WechatNativeResponse
  const codeUrl = typeof parsed.code_url === 'string' && parsed.code_url.trim()
    ? parsed.code_url.trim()
    : ''
  if (!codeUrl) throw new Error('WeChat Native payment response did not include code_url.')

  return {
    provider: 'wechat',
    codeUrl,
    qrDataUrl: await toDataURL(codeUrl, { margin: 1, width: 260 }),
    expiresAt,
    payload: {
      prepayResponse: parsed,
    },
  }
}

export async function queryWechatOrder(
  config: GatewayConfig,
  orderId: string,
): Promise<WechatPaidOrder | null> {
  assertWechatReady(config)
  const wechat = config.wechatPay
  const encodedOrderId = encodeURIComponent(orderId)
  const path = `/v3/pay/transactions/out-trade-no/${encodedOrderId}?mchid=${encodeURIComponent(wechat.mchId)}`
  const response = await signedWechatFetch(wechat, 'GET', path, '')
  const responseText = await response.text()
  if (!response.ok) throw new Error(readWechatError(responseText) || `WeChat order query failed (${response.status}).`)
  validateWechatResponseSignature(wechat, response.headers, responseText)

  const parsed = parseJson(responseText) as WechatQueryResponse
  if (parsed.trade_state !== 'SUCCESS') return null
  return normalizePaidOrder(parsed)
}

export function parseWechatPaymentNotify(
  config: GatewayConfig,
  headers: Headers,
  rawBody: string,
): WechatPaidOrder {
  assertWechatReady(config)
  const wechat = config.wechatPay
  validateWechatResponseSignature(wechat, headers, rawBody)

  const body = parseJson(rawBody) as WechatNotifyBody
  if (body.event_type !== 'TRANSACTION.SUCCESS') {
    throw new Error('Unsupported WeChat notify event type.')
  }
  if (body.resource_type !== 'encrypt-resource' || !body.resource) {
    throw new Error('Invalid WeChat notify resource.')
  }
  if (body.resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('Unsupported WeChat notify encryption algorithm.')
  }

  const decrypted = decryptWechatResource(wechat, body.resource)
  return normalizePaidOrder(decrypted)
}

function assertWechatReady(config: GatewayConfig): void {
  if (!isWechatPayReady(config)) throw new Error('WeChat Pay is not fully configured.')
}

async function signedWechatFetch(
  config: GatewayWechatPayConfig,
  method: 'GET' | 'POST',
  path: string,
  body: string,
): Promise<Response> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomBytes(16).toString('hex')
  const authorization = buildWechatAuthorization(config, method, path, timestamp, nonce, body)
  return fetch(`${WECHAT_PAY_HOST}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    ...(method === 'POST' ? { body } : {}),
  })
}

function buildWechatAuthorization(
  config: GatewayWechatPayConfig,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const signature = signWechatMessage(config.privateKeyPath, `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`)
  return `${WECHAT_PAY_AUTH_TYPE} mchid="${config.mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantCertSerialNo}"`
}

function signWechatMessage(privateKeyPath: string, message: string): string {
  const privateKey = createPrivateKey(fs.readFileSync(privateKeyPath))
  return sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64')
}

function validateWechatResponseSignature(
  config: GatewayWechatPayConfig,
  headers: Headers,
  body: string,
): void {
  const serial = headers.get('wechatpay-serial')
  const signature = headers.get('wechatpay-signature')
  const timestamp = headers.get('wechatpay-timestamp')
  const nonce = headers.get('wechatpay-nonce')
  if (!serial || !signature || !timestamp || !nonce) {
    throw new Error('Missing WeChat Pay signature headers.')
  }
  if (serial !== config.wechatPayPublicKeyId) {
    throw new Error('Unexpected WeChat Pay public key id.')
  }

  const publicKey = createPublicKey(fs.readFileSync(config.wechatPayPublicKeyPath))
  const message = `${timestamp}\n${nonce}\n${body}\n`
  const valid = verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(signature, 'base64'))
  if (!valid) throw new Error('Invalid WeChat Pay signature.')
}

function decryptWechatResource(
  config: GatewayWechatPayConfig,
  resource: NonNullable<WechatNotifyBody['resource']>,
): WechatQueryResponse {
  const ciphertext = typeof resource.ciphertext === 'string' ? resource.ciphertext : ''
  const nonce = typeof resource.nonce === 'string' ? resource.nonce : ''
  const associatedData = typeof resource.associated_data === 'string' ? resource.associated_data : ''
  if (!ciphertext || !nonce) throw new Error('Invalid WeChat encrypted resource.')

  const encrypted = Buffer.from(ciphertext, 'base64')
  if (encrypted.length <= 16) throw new Error('Invalid WeChat ciphertext.')
  const data = encrypted.subarray(0, encrypted.length - 16)
  const authTag = encrypted.subarray(encrypted.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'))
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'))
  decipher.setAuthTag(authTag)
  return parseJson(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) as WechatQueryResponse
}

function normalizePaidOrder(value: WechatQueryResponse): WechatPaidOrder {
  const orderId = stringField(value.out_trade_no)
  const transactionId = stringField(value.transaction_id)
  const tradeState = stringField(value.trade_state)
  const successTime = nullableStringField(value.success_time)
  const amountCents = typeof value.amount?.total === 'number' && Number.isFinite(value.amount.total)
    ? Math.trunc(value.amount.total)
    : NaN

  if (!orderId) throw new Error('WeChat paid order is missing out_trade_no.')
  if (!transactionId) throw new Error('WeChat paid order is missing transaction_id.')
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('WeChat paid order is missing amount.total.')
  return {
    orderId,
    transactionId,
    tradeState,
    successTime,
    amountCents,
    payload: value as Record<string, unknown>,
  }
}

function toWechatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+00:00`
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function stringField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function nullableStringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseJson(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw new Error('Invalid WeChat Pay JSON payload.')
  }
}

function readWechatError(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown }
    const code = typeof parsed.code === 'string' ? parsed.code : ''
    const message = typeof parsed.message === 'string' ? parsed.message : ''
    return [code, message].filter(Boolean).join(': ') || null
  } catch {
    return raw.trim() || null
  }
}

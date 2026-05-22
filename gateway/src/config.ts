import * as os from 'node:os'
import * as path from 'node:path'
import type { GatewayConfig } from './types.js'

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readOptionalUrl(name: string): string | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function readOptionalPositiveIntEnv(name: string): number | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

function readBoolEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function readStringEnv(name: string): string {
  return process.env[name]?.trim() || ''
}

export function loadGatewayConfig(): GatewayConfig {
  const legacyDownloadUrl = readOptionalUrl('GUGU_DOWNLOAD_URL')
  const legacyDownloadSha256 = process.env.GUGU_DOWNLOAD_SHA256?.trim() || null
  const publicBaseUrl = readOptionalUrl('GUGU_PUBLIC_BASE_URL')

  return {
    dbPath:
      process.env.GUGU_GATEWAY_DB_PATH?.trim() ||
      path.join(os.homedir(), '.gugu-agent', 'gateway.sqlite'),
    freeCredits: readIntEnv('GUGU_FREE_CREDITS', 50),
    purchaseUrl: readOptionalUrl('GUGU_PURCHASE_URL'),
    publicBaseUrl,
    icpRecord: process.env.GUGU_ICP_RECORD?.trim() || null,
    icpUrl: readOptionalUrl('GUGU_ICP_URL') || 'https://beian.miit.gov.cn/',
    downloadUrl: legacyDownloadUrl,
    downloadWindowsUrl: readOptionalUrl('GUGU_DOWNLOAD_WINDOWS_URL') || legacyDownloadUrl,
    downloadMacosUrl: readOptionalUrl('GUGU_DOWNLOAD_MACOS_URL'),
    downloadVersion: process.env.GUGU_DOWNLOAD_VERSION?.trim() || null,
    downloadSha256: legacyDownloadSha256,
    downloadWindowsSha256: process.env.GUGU_DOWNLOAD_WINDOWS_SHA256?.trim() || legacyDownloadSha256,
    downloadMacosSha256: process.env.GUGU_DOWNLOAD_MACOS_SHA256?.trim() || null,
    adminToken: process.env.GUGU_ADMIN_TOKEN?.trim() || '',
    dashboardTokenPerCredit: readOptionalPositiveIntEnv('GUGU_DASHBOARD_TOKEN_PER_CREDIT'),
    deepseekApiKey: process.env.GUGU_DEEPSEEK_API_KEY?.trim() || '',
    deepseekBaseUrl:
      readOptionalUrl('GUGU_DEEPSEEK_BASE_URL') ||
      'https://api.deepseek.com/anthropic',
    deepseekMainModel:
      process.env.GUGU_DEEPSEEK_MODEL?.trim() || 'deepseek-v4-pro',
    deepseekFastModel:
      process.env.GUGU_DEEPSEEK_FAST_MODEL?.trim() || 'deepseek-v4-flash',
    messageCreditCost: readPositiveIntEnv('GUGU_MESSAGE_CREDIT_COST', 1),
    attachmentCreditCost: readPositiveIntEnv('GUGU_ATTACHMENT_CREDIT_COST', 6),
    fileParseCreditCost: readPositiveIntEnv('GUGU_FILE_PARSE_CREDIT_COST', 3),
    summarizeCreditCost: readPositiveIntEnv('GUGU_SUMMARIZE_CREDIT_COST', 4),
    glmApiKey: process.env.GUGU_GLM_API_KEY?.trim() || '',
    glmBaseUrl:
      readOptionalUrl('GUGU_GLM_BASE_URL') ||
      'https://open.bigmodel.cn/api/paas/v4',
    wechatPay: {
      enabled: readBoolEnv('GUGU_WECHAT_PAY_ENABLED'),
      appId: readStringEnv('GUGU_WECHAT_APP_ID'),
      mchId: readStringEnv('GUGU_WECHAT_MCH_ID'),
      merchantCertSerialNo: readStringEnv('GUGU_WECHAT_MCH_CERT_SERIAL_NO'),
      privateKeyPath: readStringEnv('GUGU_WECHAT_PRIVATE_KEY_PATH'),
      wechatPayPublicKeyId: readStringEnv('GUGU_WECHATPAY_PUBLIC_KEY_ID'),
      wechatPayPublicKeyPath: readStringEnv('GUGU_WECHATPAY_PUBLIC_KEY_PATH'),
      apiV3Key: readStringEnv('GUGU_WECHAT_API_V3_KEY'),
      notifyUrl:
        readOptionalUrl('GUGU_WECHAT_NOTIFY_URL') ||
        (publicBaseUrl ? `${publicBaseUrl}/v1/payments/wechat/notify` : null),
    },
    alipay: {
      enabled: readBoolEnv('GUGU_ALIPAY_PAY_ENABLED'),
      appId: readStringEnv('GUGU_ALIPAY_APP_ID'),
      privateKeyPath: readStringEnv('GUGU_ALIPAY_PRIVATE_KEY_PATH'),
      alipayPublicKeyPath: readStringEnv('GUGU_ALIPAY_PUBLIC_KEY_PATH'),
      notifyUrl:
        readOptionalUrl('GUGU_ALIPAY_NOTIFY_URL') ||
        (publicBaseUrl ? `${publicBaseUrl}/v1/payments/alipay/notify` : null),
      gatewayUrl:
        readOptionalUrl('GUGU_ALIPAY_GATEWAY_URL') ||
        'https://openapi.alipay.com/gateway.do',
      sellerId: readStringEnv('GUGU_ALIPAY_SELLER_ID'),
    },
  }
}

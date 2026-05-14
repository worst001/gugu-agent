import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiError } from '../middleware/errorHandler.js'

export type BillingStatus = 'not_configured' | 'inactive' | 'active' | 'expired' | 'check_failed'

export type BillingStatusResponse = {
  status: BillingStatus
  plan: string | null
  expiresAt: string | null
  maskedLicenseKey: string | null
  purchaseUrl: string | null
  lastCheckedAt: string | null
  message: string
}

export type BillingConfigResponse = {
  purchaseUrl: string | null
  verifyUrlConfigured: boolean
}

type BillingFile = {
  licenseKey?: string
  deviceId?: string
  status?: BillingStatus
  plan?: string | null
  expiresAt?: string | null
  lastCheckedAt?: string | null
  message?: string
}

type VerifyResponse = {
  valid?: unknown
  status?: unknown
  plan?: unknown
  expiresAt?: unknown
  message?: unknown
}

type FetchLike = typeof fetch

const BILLING_CONFIG_DIR = 'cc-haha'
const BILLING_FILE = 'billing.json'
const VERIFY_TIMEOUT_MS = 20_000
const MAX_LICENSE_KEY_LENGTH = 512

export class BillingService {
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  async getConfig(): Promise<BillingConfigResponse> {
    return {
      purchaseUrl: readOptionalUrlEnv('CC_GUGU_BILLING_PURCHASE_URL'),
      verifyUrlConfigured: Boolean(readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')),
    }
  }

  async getStatus(): Promise<BillingStatusResponse> {
    const data = await this.readBillingFile()
    return this.toPublicStatus(data)
  }

  async activateLicense(licenseKey: string): Promise<BillingStatusResponse> {
    const normalized = normalizeLicenseKey(licenseKey)
    const verifyUrl = readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')
    if (!verifyUrl) {
      return this.toPublicStatus({
        status: 'not_configured',
        message: '订阅激活服务尚未配置，暂时不会影响功能使用。',
      })
    }

    const current = await this.readBillingFile()
    const next = await this.verifyLicense(normalized, current.deviceId || randomUUID(), verifyUrl)
    await this.writeBillingFile({
      ...next,
      licenseKey: normalized,
      deviceId: current.deviceId || next.deviceId,
    })
    return this.toPublicStatus(await this.readBillingFile())
  }

  async refresh(): Promise<BillingStatusResponse> {
    const verifyUrl = readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')
    const current = await this.readBillingFile()
    if (!verifyUrl) {
      return this.toPublicStatus({
        ...current,
        status: current.licenseKey ? 'check_failed' : 'not_configured',
        message: '订阅校验服务尚未配置，暂时不会影响功能使用。',
      })
    }

    if (!current.licenseKey) {
      return this.toPublicStatus({
        ...current,
        status: 'inactive',
        message: '尚未填写激活码。',
      })
    }

    const next = await this.verifyLicense(current.licenseKey, current.deviceId || randomUUID(), verifyUrl)
    await this.writeBillingFile({
      ...next,
      licenseKey: current.licenseKey,
      deviceId: current.deviceId || next.deviceId,
    })
    return this.toPublicStatus(await this.readBillingFile())
  }

  async clearLicense(): Promise<BillingStatusResponse> {
    await fs.rm(this.getBillingPath(), { force: true }).catch(() => {})
    return this.toPublicStatus({})
  }

  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getBillingPath(): string {
    return path.join(this.getConfigDir(), BILLING_CONFIG_DIR, BILLING_FILE)
  }

  private async readBillingFile(): Promise<BillingFile> {
    try {
      const raw = await fs.readFile(this.getBillingPath(), 'utf-8')
      const parsed = JSON.parse(raw) as BillingFile
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read billing status: ${error}`)
    }
  }

  private async writeBillingFile(data: BillingFile): Promise<void> {
    const filePath = this.getBillingPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpPath, filePath)
    } catch (error) {
      await fs.rm(tmpPath, { force: true }).catch(() => {})
      throw ApiError.internal(`Failed to write billing status: ${error}`)
    }
  }

  private async verifyLicense(
    licenseKey: string,
    deviceId: string,
    verifyUrl: string,
  ): Promise<BillingFile & { deviceId: string }> {
    const checkedAt = new Date().toISOString()
    try {
      const response = await this.fetchFn(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          deviceId,
          product: 'gugu-agent',
        }),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      })
      const body = await response.json().catch(() => ({})) as VerifyResponse
      if (!response.ok) {
        return {
          deviceId,
          status: 'check_failed',
          plan: null,
          expiresAt: null,
          lastCheckedAt: checkedAt,
          message: readMessage(body) || `订阅校验失败 (${response.status})。`,
        }
      }

      const valid = body.valid === true
      const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt.trim()
        ? body.expiresAt.trim()
        : null
      const status = resolveVerifiedStatus(valid, body.status, expiresAt)
      return {
        deviceId,
        status,
        plan: typeof body.plan === 'string' && body.plan.trim() ? body.plan.trim() : null,
        expiresAt,
        lastCheckedAt: checkedAt,
        message: readMessage(body) || defaultStatusMessage(status),
      }
    } catch (error) {
      return {
        deviceId,
        status: 'check_failed',
        plan: null,
        expiresAt: null,
        lastCheckedAt: checkedAt,
        message: error instanceof Error ? error.message : '订阅校验失败。',
      }
    }
  }

  private toPublicStatus(data: BillingFile): BillingStatusResponse {
    const verifyUrlConfigured = Boolean(readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL'))
    const rawStatus = normalizeStatus(data.status)
    const status = !verifyUrlConfigured && !data.licenseKey
      ? 'not_configured'
      : rawStatus
    return {
      status,
      plan: typeof data.plan === 'string' && data.plan.trim() ? data.plan.trim() : null,
      expiresAt: typeof data.expiresAt === 'string' && data.expiresAt.trim() ? data.expiresAt.trim() : null,
      maskedLicenseKey: data.licenseKey ? maskLicenseKey(data.licenseKey) : null,
      purchaseUrl: readOptionalUrlEnv('CC_GUGU_BILLING_PURCHASE_URL'),
      lastCheckedAt: typeof data.lastCheckedAt === 'string' ? data.lastCheckedAt : null,
      message: typeof data.message === 'string' && data.message.trim()
        ? data.message
        : defaultStatusMessage(status),
    }
  }
}

function normalizeLicenseKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw ApiError.badRequest('licenseKey is required')
  if (trimmed.length > MAX_LICENSE_KEY_LENGTH) {
    throw ApiError.badRequest(`licenseKey must be ${MAX_LICENSE_KEY_LENGTH} characters or fewer`)
  }
  return trimmed
}

function readOptionalUrlEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function maskLicenseKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '********'
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

function normalizeStatus(status: unknown): BillingStatus {
  if (
    status === 'not_configured' ||
    status === 'inactive' ||
    status === 'active' ||
    status === 'expired' ||
    status === 'check_failed'
  ) {
    return status
  }
  return 'inactive'
}

function resolveVerifiedStatus(valid: boolean, status: unknown, expiresAt: string | null): BillingStatus {
  const normalized = normalizeStatus(status)
  if (normalized === 'expired') return 'expired'
  if (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now()) {
    return 'expired'
  }
  return valid ? 'active' : normalized === 'active' ? 'check_failed' : normalized
}

function readMessage(body: VerifyResponse): string | null {
  return typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null
}

function defaultStatusMessage(status: BillingStatus): string {
  switch (status) {
    case 'not_configured':
      return '订阅服务即将开放，当前不会影响功能使用。'
    case 'active':
      return '订阅已激活。'
    case 'expired':
      return '订阅已过期。'
    case 'check_failed':
      return '订阅状态暂时无法校验。'
    case 'inactive':
    default:
      return '尚未开通订阅。'
  }
}

export const billingService = new BillingService()

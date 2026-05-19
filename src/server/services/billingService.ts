import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ApiError } from '../middleware/errorHandler.js'

export type BillingStatus =
  | 'not_configured'
  | 'inactive'
  | 'active'
  | 'expired'
  | 'quota_exhausted'
  | 'check_failed'

export type BillingStatusResponse = {
  status: BillingStatus
  plan: string | null
  expiresAt: string | null
  maskedLicenseKey: string | null
  purchaseUrl: string | null
  lastCheckedAt: string | null
  message: string
  deviceId: string | null
  creditsTotal: number | null
  creditsRemaining: number | null
  isTrial: boolean
  quotaReason: string | null
}

export type BillingConfigResponse = {
  purchaseUrl: string | null
  verifyUrlConfigured: boolean
  gatewayUrlConfigured: boolean
}

export type GatewayDeviceAuth = {
  gatewayUrl: string
  deviceId: string
  deviceToken: string
  entitlement: GatewayEntitlement
}

type BillingFile = {
  licenseKey?: string
  deviceId?: string
  deviceToken?: string
  status?: BillingStatus
  plan?: string | null
  expiresAt?: string | null
  lastCheckedAt?: string | null
  message?: string
  purchaseUrl?: string | null
  creditsTotal?: number | null
  creditsRemaining?: number | null
  isTrial?: boolean
  quotaReason?: string | null
}

type VerifyResponse = {
  valid?: unknown
  status?: unknown
  plan?: unknown
  expiresAt?: unknown
  message?: unknown
}

type GatewayEntitlementStatus = 'active' | 'expired' | 'quota_exhausted' | 'inactive'

type GatewayEntitlement = {
  status?: GatewayEntitlementStatus
  plan?: string | null
  expiresAt?: string | null
  creditsTotal?: number
  creditsRemaining?: number
  isTrial?: boolean
  purchaseUrl?: string | null
  quotaReason?: string | null
  reason?: string | null
  message?: string
}

type GatewayDeviceResponse = {
  deviceId?: string
  deviceToken?: string
  entitlement?: GatewayEntitlement
}

type GatewayErrorResponse = {
  error?: {
    code?: string
    message?: string
    entitlement?: GatewayEntitlement
  }
  message?: string
}

type FetchLike = typeof fetch

const BILLING_CONFIG_DIR = 'cc-haha'
const BILLING_FILE = 'billing.json'
const VERIFY_TIMEOUT_MS = 20_000
const MAX_LICENSE_KEY_LENGTH = 512
const BUILTIN_GATEWAY_URL = 'http://139.196.214.54:8787'

export class BillingService {
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  async getConfig(): Promise<BillingConfigResponse> {
    const gatewayUrl = readGatewayUrl()
    return {
      purchaseUrl: readPurchaseUrl(),
      verifyUrlConfigured: Boolean(readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')),
      gatewayUrlConfigured: Boolean(gatewayUrl),
    }
  }

  async getStatus(): Promise<BillingStatusResponse> {
    if (readGatewayUrl()) {
      return this.refreshGatewayStatus()
    }
    const data = await this.readBillingFile()
    return this.toPublicStatus(data)
  }

  async activateLicense(licenseKey: string): Promise<BillingStatusResponse> {
    const normalized = normalizeLicenseKey(licenseKey)
    const gatewayUrl = readGatewayUrl()
    if (gatewayUrl) {
      return this.activateGatewayLicense(normalized, gatewayUrl)
    }

    const verifyUrl = readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')
    if (!verifyUrl) {
      return this.toPublicStatus({
        status: 'not_configured',
        message: 'Billing verifier is not configured.',
      })
    }

    const current = await this.readBillingFile()
    const next = await this.verifyLicense(normalized, current.deviceId || randomUUID(), verifyUrl)
    await this.writeBillingFile({
      ...current,
      ...next,
      licenseKey: normalized,
      deviceToken: current.deviceToken,
      deviceId: current.deviceId || next.deviceId,
    })
    return this.toPublicStatus(await this.readBillingFile())
  }

  async refresh(): Promise<BillingStatusResponse> {
    if (readGatewayUrl()) {
      return this.refreshGatewayStatus()
    }

    const verifyUrl = readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL')
    const current = await this.readBillingFile()
    if (!verifyUrl) {
      return this.toPublicStatus({
        ...current,
        status: current.licenseKey ? 'check_failed' : 'not_configured',
        message: 'Billing verifier is not configured.',
      })
    }

    if (!current.licenseKey) {
      return this.toPublicStatus({
        ...current,
        status: 'inactive',
        message: 'No license key has been activated.',
      })
    }

    const next = await this.verifyLicense(current.licenseKey, current.deviceId || randomUUID(), verifyUrl)
    await this.writeBillingFile({
      ...current,
      ...next,
      licenseKey: current.licenseKey,
      deviceToken: current.deviceToken,
      deviceId: current.deviceId || next.deviceId,
    })
    return this.toPublicStatus(await this.readBillingFile())
  }

  async clearLicense(): Promise<BillingStatusResponse> {
    const current = await this.readBillingFile()
    if (current.deviceId || current.deviceToken) {
      await this.writeBillingFile({
        deviceId: current.deviceId,
        deviceToken: current.deviceToken,
        status: 'inactive',
        plan: null,
        expiresAt: null,
        creditsTotal: null,
        creditsRemaining: null,
        isTrial: false,
        purchaseUrl: null,
        quotaReason: null,
        lastCheckedAt: new Date().toISOString(),
        message: 'License was removed. Trial/device identity is preserved.',
      })
      return this.toPublicStatus(await this.readBillingFile())
    }
    await fs.rm(this.getBillingPath(), { force: true }).catch(() => {})
    return this.toPublicStatus({})
  }

  async updateGatewayCreditsFromHeaders(headers: Headers): Promise<void> {
    const raw = headers.get('x-gugu-credits-remaining')
    if (!raw) return
    const remaining = Number.parseInt(raw, 10)
    if (!Number.isFinite(remaining)) return
    await this.updateGatewayCreditsRemaining(remaining)
  }

  async ensureGatewayDevice(): Promise<GatewayDeviceAuth> {
    const gatewayUrl = readGatewayUrl()
    if (!gatewayUrl) {
      throw ApiError.internal('Gugu Gateway URL is not configured. Set CC_GUGU_GATEWAY_URL.')
    }

    const current = await this.readBillingFile()
    if (current.deviceToken) {
      const existing = await this.fetchGatewayEntitlement(gatewayUrl, current.deviceToken)
      if (existing) {
        const next = this.mergeGatewayEntitlement(current, existing, {
          deviceId: current.deviceId || randomUUID(),
          deviceToken: current.deviceToken,
        })
        await this.writeBillingFile(next)
        return {
          gatewayUrl,
          deviceId: next.deviceId!,
          deviceToken: current.deviceToken,
          entitlement: entitlementFromFile(next),
        }
      }
    }

    const registered = await this.registerGatewayDevice(gatewayUrl, current.deviceId || randomUUID())
    const next = this.mergeGatewayEntitlement(current, registered.entitlement, {
      deviceId: registered.deviceId,
      deviceToken: registered.deviceToken,
    })
    await this.writeBillingFile(next)
    return {
      gatewayUrl,
      deviceId: registered.deviceId,
      deviceToken: registered.deviceToken,
      entitlement: registered.entitlement,
    }
  }

  private async refreshGatewayStatus(): Promise<BillingStatusResponse> {
    try {
      const auth = await this.ensureGatewayDevice()
      const current = await this.readBillingFile()
      await this.writeBillingFile(this.mergeGatewayEntitlement(current, auth.entitlement, {
        deviceId: auth.deviceId,
        deviceToken: auth.deviceToken,
      }))
      return this.toPublicStatus(await this.readBillingFile())
    } catch (error) {
      const current = await this.readBillingFile()
      return this.toPublicStatus({
        ...current,
        status: 'check_failed',
        lastCheckedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'Failed to contact Gugu Gateway.',
      })
    }
  }

  private async updateGatewayCreditsRemaining(creditsRemaining: number): Promise<void> {
    const current = await this.readBillingFile()
    if (!current.deviceToken) return

    const remaining = Math.max(0, Math.trunc(creditsRemaining))
    const status: BillingStatus = remaining <= 0 ? 'quota_exhausted' : 'active'
    await this.writeBillingFile({
      ...current,
      status,
      creditsRemaining: remaining,
      lastCheckedAt: new Date().toISOString(),
      message: defaultStatusMessage(status),
    })
  }

  private async activateGatewayLicense(
    licenseKey: string,
    gatewayUrl: string,
  ): Promise<BillingStatusResponse> {
    const auth = await this.ensureGatewayDevice()
    const checkedAt = new Date().toISOString()
    const response = await this.fetchFn(joinUrl(gatewayUrl, '/v1/activate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.deviceToken}`,
      },
      body: JSON.stringify({ licenseKey }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => ({})) as GatewayDeviceResponse & GatewayErrorResponse
    if (!response.ok) {
      const current = await this.readBillingFile()
      await this.writeBillingFile({
        ...current,
        licenseKey,
        status: 'check_failed',
        lastCheckedAt: checkedAt,
        message: readGatewayErrorMessage(body) || `Activation failed (${response.status}).`,
      })
      return this.toPublicStatus(await this.readBillingFile())
    }

    const entitlement = normalizeGatewayEntitlement(body.entitlement)
    const current = await this.readBillingFile()
    await this.writeBillingFile(this.mergeGatewayEntitlement({
      ...current,
      licenseKey,
    }, entitlement, {
      deviceId: stringOr(auth.deviceId, body.deviceId),
      deviceToken: auth.deviceToken,
    }))
    return this.toPublicStatus(await this.readBillingFile())
  }

  private async registerGatewayDevice(
    gatewayUrl: string,
    deviceId: string,
  ): Promise<{ deviceId: string; deviceToken: string; entitlement: GatewayEntitlement }> {
    const response = await this.fetchFn(joinUrl(gatewayUrl, '/v1/devices'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        appVersion: process.env.GUGU_APP_VERSION || process.env.npm_package_version || null,
        platform: `${process.platform}-${process.arch}`,
      }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    const body = await response.json().catch(() => ({})) as GatewayDeviceResponse & GatewayErrorResponse
    if (!response.ok || !body.deviceToken) {
      throw ApiError.internal(readGatewayErrorMessage(body) || `Gateway device registration failed (${response.status}).`)
    }
    return {
      deviceId: stringOr(deviceId, body.deviceId),
      deviceToken: body.deviceToken,
      entitlement: normalizeGatewayEntitlement(body.entitlement),
    }
  }

  private async fetchGatewayEntitlement(
    gatewayUrl: string,
    deviceToken: string,
  ): Promise<GatewayEntitlement | null> {
    const response = await this.fetchFn(joinUrl(gatewayUrl, '/v1/entitlement'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${deviceToken}` },
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 404) return null
    const body = await response.json().catch(() => ({})) as GatewayEntitlement & GatewayErrorResponse
    if (!response.ok) {
      throw ApiError.internal(readGatewayErrorMessage(body) || `Gateway entitlement check failed (${response.status}).`)
    }
    return normalizeGatewayEntitlement(body)
  }

  private mergeGatewayEntitlement(
    current: BillingFile,
    entitlement: GatewayEntitlement,
    identity: { deviceId: string; deviceToken: string },
  ): BillingFile {
    const status = mapGatewayStatus(entitlement.status)
    return {
      ...current,
      deviceId: identity.deviceId,
      deviceToken: identity.deviceToken,
      status,
      plan: stringOrNull(entitlement.plan),
      expiresAt: stringOrNull(entitlement.expiresAt),
      purchaseUrl: stringOrNull(entitlement.purchaseUrl),
      creditsTotal: numberOrNull(entitlement.creditsTotal),
      creditsRemaining: numberOrNull(entitlement.creditsRemaining),
      isTrial: entitlement.isTrial === true,
      quotaReason: stringOrNull(entitlement.quotaReason),
      lastCheckedAt: new Date().toISOString(),
      message: typeof entitlement.message === 'string' && entitlement.message.trim()
        ? entitlement.message.trim()
        : defaultStatusMessage(status),
    }
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
          message: readMessage(body) || `Billing verifier failed (${response.status}).`,
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
        message: error instanceof Error ? error.message : 'Billing verifier failed.',
      }
    }
  }

  private toPublicStatus(data: BillingFile): BillingStatusResponse {
    const verifyUrlConfigured = Boolean(readOptionalUrlEnv('CC_GUGU_BILLING_VERIFY_URL'))
    const gatewayUrlConfigured = Boolean(readGatewayUrl())
    const rawStatus = normalizeStatus(data.status)
    const status = !gatewayUrlConfigured && !verifyUrlConfigured && !data.licenseKey
      ? 'not_configured'
      : rawStatus
    return {
      status,
      plan: typeof data.plan === 'string' && data.plan.trim() ? data.plan.trim() : null,
      expiresAt: typeof data.expiresAt === 'string' && data.expiresAt.trim() ? data.expiresAt.trim() : null,
      maskedLicenseKey: data.licenseKey ? maskLicenseKey(data.licenseKey) : null,
      purchaseUrl: stringOrNull(data.purchaseUrl) || readPurchaseUrl(),
      lastCheckedAt: typeof data.lastCheckedAt === 'string' ? data.lastCheckedAt : null,
      message: typeof data.message === 'string' && data.message.trim()
        ? data.message
        : defaultStatusMessage(status),
      deviceId: typeof data.deviceId === 'string' && data.deviceId.trim() ? data.deviceId.trim() : null,
      creditsTotal: numberOrNull(data.creditsTotal),
      creditsRemaining: numberOrNull(data.creditsRemaining),
      isTrial: data.isTrial === true,
      quotaReason: stringOrNull(data.quotaReason),
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

function readGatewayUrl(): string | null {
  return readOptionalUrlEnv('CC_GUGU_GATEWAY_URL') ||
    readOptionalUrlEnv('GUGU_GATEWAY_URL') ||
    readOptionalUrlEnv('GUGU_DESKTOP_DEFAULT_GATEWAY_URL') ||
    readBuiltinGatewayUrl()
}

function readPurchaseUrl(): string | null {
  return readOptionalUrlEnv('CC_GUGU_BILLING_PURCHASE_URL') ||
    readOptionalUrlEnv('GUGU_PURCHASE_URL') ||
    joinUrl(readGatewayUrl() || BUILTIN_GATEWAY_URL, '/buy')
}

function readBuiltinGatewayUrl(): string | null {
  if (process.env.CC_GUGU_DISABLE_DEFAULT_GATEWAY === '1') return null
  return readUrlValue(BUILTIN_GATEWAY_URL)
}

function readOptionalUrlEnv(name: string): string | null {
  return readUrlValue(process.env[name])
}

function readUrlValue(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function joinUrl(baseUrl: string, pathname: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
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
    status === 'quota_exhausted' ||
    status === 'check_failed'
  ) {
    return status
  }
  return 'inactive'
}

function mapGatewayStatus(status: unknown): BillingStatus {
  if (status === 'active' || status === 'expired' || status === 'quota_exhausted' || status === 'inactive') {
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

function normalizeGatewayEntitlement(value: unknown): GatewayEntitlement {
  if (!value || typeof value !== 'object') {
    return { status: 'inactive' }
  }
  const input = value as GatewayEntitlement
  return {
    status: mapGatewayStatus(input.status) as GatewayEntitlementStatus,
    plan: stringOrNull(input.plan),
    expiresAt: stringOrNull(input.expiresAt),
    creditsTotal: numberOrNull(input.creditsTotal) ?? 0,
    creditsRemaining: numberOrNull(input.creditsRemaining) ?? 0,
    isTrial: input.isTrial === true,
    purchaseUrl: stringOrNull(input.purchaseUrl),
    quotaReason: stringOrNull(input.quotaReason) || stringOrNull(input.reason),
    message: typeof input.message === 'string' && input.message.trim() ? input.message.trim() : undefined,
  }
}

function entitlementFromFile(file: BillingFile): GatewayEntitlement {
  return {
    status: mapGatewayStatus(file.status) as GatewayEntitlementStatus,
    plan: file.plan,
    expiresAt: file.expiresAt,
    creditsTotal: numberOrNull(file.creditsTotal) ?? 0,
    creditsRemaining: numberOrNull(file.creditsRemaining) ?? 0,
    isTrial: file.isTrial === true,
    purchaseUrl: stringOrNull(file.purchaseUrl),
    quotaReason: stringOrNull(file.quotaReason),
    message: file.message,
  }
}

function readMessage(body: VerifyResponse): string | null {
  return typeof body.message === 'string' && body.message.trim() ? body.message.trim() : null
}

function readGatewayErrorMessage(body: GatewayErrorResponse): string | null {
  if (body.error?.message && body.error.message.trim()) return body.error.message.trim()
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim()
  return null
}

function stringOr(fallback: string, value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function defaultStatusMessage(status: BillingStatus): string {
  switch (status) {
    case 'not_configured':
      return 'Billing is not configured.'
    case 'active':
      return 'Subscription is active.'
    case 'expired':
      return 'Subscription has expired.'
    case 'quota_exhausted':
      return 'Included credits have been used up. Purchase or activate a plan to continue.'
    case 'check_failed':
      return 'Failed to check subscription status.'
    case 'inactive':
    default:
      return 'No active subscription.'
  }
}

export const billingService = new BillingService()

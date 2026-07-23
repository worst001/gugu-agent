import { randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { toDataURL } from 'qrcode'
import { ApiError } from '../middleware/errorHandler.js'
import { adapterService } from './adapterService.js'

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const INSTALLATION_TTL_MS = 5 * 60_000
const QR_START_TIMEOUT_MS = 30_000
const QR_STATUS_TIMEOUT_MS = 40_000

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>
type ProviderStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect'

type ProviderStatusResponse = {
  status: ProviderStatus
  bot_token?: string
  ilink_bot_id?: string
  ilink_user_id?: string
  baseurl?: string
  redirect_host?: string
}

type InternalInstallation = {
  installationId: string
  qrcode: string
  qrCodeDataUrl: string
  state: WeixinInstallationStatus['state']
  expiresAt: number
  currentApiBaseUrl: string
  verificationCode?: string
  accountId?: string
  error?: string
}

export type WeixinInstallationStatus = {
  installationId: string
  state:
    | 'waiting'
    | 'scanned'
    | 'needs_verification'
    | 'authorized'
    | 'expired'
    | 'failed'
    | 'cancelled'
  expiresAt: number
  qrCodeDataUrl?: string
  accountId?: string
  error?: string
}

export type StoredWeixinCredentials = {
  accountId: string
  token: string
  baseUrl: string
}

export type WeixinRuntimeStatus = {
  state: 'starting' | 'online' | 'degraded' | 'offline'
  lastPollAt: number | null
  error: string | null
}

let runtimeStatus: WeixinRuntimeStatus = {
  state: 'offline',
  lastPollAt: null,
  error: null,
}

export function getWeixinRuntimeStatus(): WeixinRuntimeStatus {
  return { ...runtimeStatus }
}

export function updateWeixinRuntimeStatus(
  next: Partial<WeixinRuntimeStatus> & Pick<WeixinRuntimeStatus, 'state'>,
): WeixinRuntimeStatus {
  runtimeStatus = { ...runtimeStatus, ...next }
  return getWeixinRuntimeStatus()
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function getWeixinCredentialPath(): string {
  return path.join(configDir(), 'weixin', 'credentials.json')
}

export async function loadWeixinCredentials(): Promise<StoredWeixinCredentials | null> {
  try {
    const credentials = JSON.parse(
      await fs.readFile(getWeixinCredentialPath(), 'utf-8'),
    ) as Partial<StoredWeixinCredentials>
    if (
      typeof credentials.accountId !== 'string'
      || !credentials.accountId.trim()
      || typeof credentials.token !== 'string'
      || !credentials.token
      || typeof credentials.baseUrl !== 'string'
    ) {
      throw new Error('WeChat credentials are invalid; reconnect the account')
    }
    return {
      accountId: credentials.accountId,
      token: credentials.token,
      baseUrl: requireHttpsUrl(credentials.baseUrl, 'WeChat API base URL'),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      throw new Error('WeChat credentials are invalid; reconnect the account')
    }
    throw error
  }
}

async function saveWeixinCredentials(credentials: StoredWeixinCredentials): Promise<void> {
  const filePath = getWeixinCredentialPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.unlink(temporaryPath).catch(() => {})
  }
}

export async function deleteWeixinCredentials(): Promise<void> {
  try {
    await fs.unlink(getWeixinCredentialPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function commonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': '65536',
  }
}

function authenticatedHeaders(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(
      String(randomBytes(4).readUInt32BE(0)),
      'utf-8',
    ).toString('base64'),
    ...commonHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function requireHttpsUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL`)
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS`)
  return url.origin
}

export class WeixinInstallService {
  private fetchFn: FetchFn = fetch
  private installations = new Map<string, InternalInstallation>()
  private startPromise: Promise<WeixinInstallationStatus> | null = null

  setFetchFn(fetchFn: FetchFn): void {
    this.fetchFn = fetchFn
  }

  async startInstallation(): Promise<WeixinInstallationStatus> {
    if (this.startPromise) return await this.startPromise
    const operation = this.createInstallation()
    this.startPromise = operation
    try {
      return await operation
    } finally {
      if (this.startPromise === operation) this.startPromise = null
    }
  }

  private async createInstallation(): Promise<WeixinInstallationStatus> {
    if (await loadWeixinCredentials()) {
      throw ApiError.conflict('WeChat is already connected; disconnect it before connecting another account')
    }
    this.purgeExpired()
    const active = [...this.installations.values()].find(
      (item) => ['waiting', 'scanned', 'needs_verification'].includes(item.state),
    )
    if (active) return this.publicStatus(active)

    const response = await this.fetchFn(
      `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
      {
        method: 'POST',
        headers: authenticatedHeaders(),
        body: JSON.stringify({ local_token_list: [] }),
        signal: AbortSignal.timeout(QR_START_TIMEOUT_MS),
      },
    )
    if (!response.ok) throw new Error(`WeChat QR request failed: ${response.status}`)
    const body = await response.json() as {
      qrcode?: string
      qrcode_img_content?: string
    }
    if (!body.qrcode || !body.qrcode_img_content) {
      throw new Error('WeChat QR response is missing required fields')
    }

    const startedAt = Date.now()
    const installation: InternalInstallation = {
      installationId: randomUUID(),
      qrcode: body.qrcode,
      qrCodeDataUrl: await toDataURL(body.qrcode_img_content, { margin: 1, width: 280 }),
      state: 'waiting',
      expiresAt: startedAt + INSTALLATION_TTL_MS,
      currentApiBaseUrl: ILINK_BASE_URL,
    }
    this.installations.set(installation.installationId, installation)
    return this.publicStatus(installation)
  }

  async getInstallation(installationId: string): Promise<WeixinInstallationStatus> {
    const installation = this.requireInstallation(installationId)
    if (Date.now() >= installation.expiresAt) installation.state = 'expired'
    if (['authorized', 'expired', 'failed', 'cancelled'].includes(installation.state)) {
      return this.publicStatus(installation)
    }

    let endpoint = `${installation.currentApiBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(installation.qrcode)}`
    if (installation.verificationCode) {
      endpoint += `&verify_code=${encodeURIComponent(installation.verificationCode)}`
    }
    const response = await this.fetchFn(endpoint, {
      method: 'GET',
      headers: commonHeaders(),
      signal: AbortSignal.timeout(QR_STATUS_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`WeChat QR status request failed: ${response.status}`)
    }
    await this.applyProviderStatus(
      installation,
      await response.json() as ProviderStatusResponse,
    )
    return this.publicStatus(installation)
  }

  async submitVerification(
    installationId: string,
    verificationCode: string,
  ): Promise<WeixinInstallationStatus> {
    const installation = this.requireInstallation(installationId)
    if (!/^\d{4,8}$/.test(verificationCode)) {
      throw ApiError.badRequest('WeChat verification code must be 4-8 numeric digits')
    }
    if (installation.state !== 'needs_verification') {
      throw ApiError.conflict('WeChat installation is not awaiting a verification code')
    }
    installation.verificationCode = verificationCode
    return this.publicStatus(installation)
  }

  cancelInstallation(installationId: string): WeixinInstallationStatus {
    const installation = this.requireInstallation(installationId)
    if (installation.state === 'authorized') {
      throw ApiError.conflict('WeChat is already connected; disconnect the account instead')
    }
    if (['expired', 'failed', 'cancelled'].includes(installation.state)) {
      return this.publicStatus(installation)
    }
    installation.state = 'cancelled'
    installation.verificationCode = undefined
    return this.publicStatus(installation)
  }

  private async applyProviderStatus(
    installation: InternalInstallation,
    provider: ProviderStatusResponse,
  ): Promise<void> {
    switch (provider.status) {
      case 'wait':
        installation.state = 'waiting'
        return
      case 'scaned':
        installation.state = 'scanned'
        installation.verificationCode = undefined
        return
      case 'need_verifycode':
        installation.state = 'needs_verification'
        return
      case 'scaned_but_redirect':
        if (provider.redirect_host) {
          installation.currentApiBaseUrl = requireHttpsUrl(
            `https://${provider.redirect_host}`,
            'WeChat redirect host',
          )
        }
        installation.state = 'scanned'
        return
      case 'expired':
        installation.state = 'expired'
        return
      case 'verify_code_blocked':
        installation.state = 'failed'
        installation.error = 'Too many incorrect verification attempts; generate a new QR code'
        installation.verificationCode = undefined
        return
      case 'binded_redirect':
        installation.state = 'failed'
        installation.error = 'This WeChat bot is already bound but no local credentials were found'
        return
      case 'confirmed':
        await this.authorize(installation, provider)
        return
      default:
        installation.state = 'failed'
        installation.error = 'WeChat returned an unknown QR status'
    }
  }

  private async authorize(
    installation: InternalInstallation,
    provider: ProviderStatusResponse,
  ): Promise<void> {
    if (!provider.bot_token || !provider.ilink_bot_id || !provider.ilink_user_id) {
      installation.state = 'failed'
      installation.error = 'WeChat confirmed authorization without complete account identity'
      return
    }
    const baseUrl = requireHttpsUrl(
      provider.baseurl || installation.currentApiBaseUrl,
      'WeChat API base URL',
    )
    await saveWeixinCredentials({
      accountId: provider.ilink_bot_id,
      token: provider.bot_token,
      baseUrl,
    })

    try {
      await adapterService.updateConfig({
        weixin: {
          accountId: provider.ilink_bot_id,
          baseUrl,
          allowedUsers: [],
          pairedUsers: [{
            userId: provider.ilink_user_id,
            displayName: 'WeChat scanner',
            pairedAt: Date.now(),
          }],
        },
      })
    } catch (error) {
      await deleteWeixinCredentials().catch(() => {})
      throw error
    }
    installation.accountId = provider.ilink_bot_id
    installation.state = 'authorized'
    installation.verificationCode = undefined
  }

  private requireInstallation(installationId: string): InternalInstallation {
    const installation = this.installations.get(installationId)
    if (!installation) throw ApiError.notFound('WeChat installation not found')
    return installation
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [id, installation] of this.installations) {
      if (now >= installation.expiresAt) this.installations.delete(id)
    }
  }

  private publicStatus(installation: InternalInstallation): WeixinInstallationStatus {
    const showQr = ['waiting', 'scanned', 'needs_verification'].includes(
      installation.state,
    )
    return {
      installationId: installation.installationId,
      state: installation.state,
      expiresAt: installation.expiresAt,
      ...(showQr ? { qrCodeDataUrl: installation.qrCodeDataUrl } : {}),
      ...(installation.accountId ? { accountId: installation.accountId } : {}),
      ...(installation.error ? { error: installation.error } : {}),
    }
  }
}

export const weixinInstallService = new WeixinInstallService()

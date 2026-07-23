import { randomUUID } from 'node:crypto'
import { registerApp } from '@larksuiteoapi/node-sdk'
import { toDataURL } from 'qrcode'
import { ApiError } from '../middleware/errorHandler.js'
import { adapterService } from './adapterService.js'

const QR_READY_TIMEOUT_MS = 20_000
const DEFAULT_INSTALLATION_TTL_MS = 10 * 60 * 1000

type RegistrationStatus = 'polling' | 'slow_down' | 'domain_switched'

type RegisterAppOptions = {
  source?: string
  signal?: AbortSignal
  onQRCodeReady: (info: { url: string; expireIn: number }) => void
  onStatusChange?: (info: { status: RegistrationStatus; interval?: number }) => void
  appPreset?: {
    name?: string
    desc?: string
  }
  addons?: {
    preset?: boolean
    scopes?: { tenant?: string[] }
    events?: { items?: { tenant?: string[] } }
    callbacks?: { items?: string[] }
  }
  createOnly?: boolean
}

type RegisterAppResult = {
  client_id: string
  client_secret: string
  user_info?: {
    open_id?: string
    tenant_brand?: 'feishu' | 'lark'
  }
}

export type FeishuRegisterAppFn = (
  options: RegisterAppOptions,
) => Promise<RegisterAppResult>

export type FeishuInstallationStatus = {
  installationId: string
  state: 'waiting' | 'authorizing' | 'authorized' | 'expired' | 'failed' | 'cancelled'
  expiresAt: number
  qrCodeDataUrl?: string
  authorizationUrl?: string
  appId?: string
  error?: string
}

export type FeishuConnection = {
  connected: boolean
  appId: string | null
}

type InternalInstallation = FeishuInstallationStatus & {
  controller: AbortController
}

type RegistrationError = Error & {
  code?: string
  description?: string
}

const officialRegisterApp: FeishuRegisterAppFn = registerApp

function registrationErrorMessage(error: unknown): string {
  const registrationError = error as RegistrationError
  switch (registrationError.code) {
    case 'access_denied':
      return '飞书授权已拒绝，请重新连接。'
    case 'expired_token':
      return '飞书二维码已过期，请重新连接。'
    case 'abort':
      return '飞书连接已取消。'
    default:
      return registrationError.description
        || registrationError.message
        || '飞书授权失败，请重试。'
  }
}

export class FeishuInstallService {
  private registerAppFn: FeishuRegisterAppFn = officialRegisterApp
  private installations = new Map<string, InternalInstallation>()
  private startPromise: Promise<FeishuInstallationStatus> | null = null

  setRegisterAppFn(registerAppFn: FeishuRegisterAppFn): void {
    this.registerAppFn = registerAppFn
  }

  resetForTests(): void {
    for (const installation of this.installations.values()) {
      installation.controller.abort()
    }
    this.installations.clear()
    this.startPromise = null
    this.registerAppFn = officialRegisterApp
  }

  async getConnection(): Promise<FeishuConnection> {
    const config = await adapterService.getRawConfig()
    const appId = config.feishu?.appId?.trim()
    const appSecret = config.feishu?.appSecret?.trim()
    return {
      connected: Boolean(appId && appSecret),
      appId: appId && appSecret ? appId : null,
    }
  }

  async startInstallation(): Promise<FeishuInstallationStatus> {
    if (this.startPromise) return await this.startPromise
    const operation = this.createInstallation()
    this.startPromise = operation
    try {
      return await operation
    } finally {
      if (this.startPromise === operation) this.startPromise = null
    }
  }

  private async createInstallation(): Promise<FeishuInstallationStatus> {
    if ((await this.getConnection()).connected) {
      throw ApiError.conflict('飞书已连接，请先断开当前应用。')
    }

    this.purgeExpired()
    const active = [...this.installations.values()].find(
      (installation) => ['waiting', 'authorizing'].includes(installation.state),
    )
    if (active) return this.publicStatus(active)

    const controller = new AbortController()
    const installation: InternalInstallation = {
      installationId: randomUUID(),
      state: 'waiting',
      expiresAt: Date.now() + DEFAULT_INSTALLATION_TTL_MS,
      controller,
    }
    this.installations.set(installation.installationId, installation)

    let resolveQr!: () => void
    let rejectQr!: (error: Error) => void
    const qrReady = new Promise<void>((resolve, reject) => {
      resolveQr = resolve
      rejectQr = reject
    })
    const qrReadyTimer = setTimeout(() => {
      if (installation.qrCodeDataUrl || installation.state !== 'waiting') return
      installation.state = 'failed'
      installation.error = '飞书二维码生成超时，请重试。'
      controller.abort()
      rejectQr(new Error(installation.error))
    }, QR_READY_TIMEOUT_MS)

    void this.registerAppFn({
      source: 'gugu-agent',
      signal: controller.signal,
      createOnly: true,
      appPreset: {
        name: 'Gugu Agent',
        desc: '在飞书中使用本地 Gugu Agent',
      },
      addons: {
        preset: true,
        scopes: {
          tenant: [
            'im:message.p2p_msg:readonly',
            'im:message:send_as_bot',
            'im:message:update',
            'im:resource',
          ],
        },
        events: {
          items: {
            tenant: ['im.message.receive_v1'],
          },
        },
        callbacks: {
          items: ['card.action.trigger'],
        },
      },
      onQRCodeReady: (info) => {
        if (controller.signal.aborted || installation.state !== 'waiting') return
        const authorizationUrl = new URL(info.url)
        if (
          authorizationUrl.protocol !== 'https:'
          || !['open.feishu.cn', 'open.larksuite.com'].includes(authorizationUrl.hostname)
        ) {
          throw new Error('飞书返回了不受信任的授权地址。')
        }
        installation.expiresAt = Date.now()
          + Math.max(1, info.expireIn || 600) * 1000
        void toDataURL(authorizationUrl.toString(), {
          margin: 4,
          width: 360,
          errorCorrectionLevel: 'M',
        })
          .then((qrCodeDataUrl) => {
            if (controller.signal.aborted || installation.state !== 'waiting') return
            installation.qrCodeDataUrl = qrCodeDataUrl
            installation.authorizationUrl = authorizationUrl.toString()
            clearTimeout(qrReadyTimer)
            resolveQr()
          })
          .catch((error) => {
            installation.state = 'failed'
            installation.error = registrationErrorMessage(error)
            controller.abort()
            clearTimeout(qrReadyTimer)
            rejectQr(new Error(installation.error))
          })
      },
    })
      .then(async (result) => {
        await qrReady
        if (controller.signal.aborted || installation.state !== 'waiting') return
        installation.state = 'authorizing'
        await this.authorize(installation, result)
      })
      .catch((error: unknown) => {
        if (['cancelled', 'expired', 'failed'].includes(installation.state)) return
        const registrationError = error as RegistrationError
        installation.state = registrationError.code === 'expired_token'
          ? 'expired'
          : 'failed'
        installation.error = registrationErrorMessage(error)
        clearTimeout(qrReadyTimer)
        rejectQr(new Error(installation.error))
      })

    await qrReady
    return this.publicStatus(installation)
  }

  getInstallation(installationId: string): FeishuInstallationStatus {
    const installation = this.requireInstallation(installationId)
    if (
      Date.now() >= installation.expiresAt
      && ['waiting', 'authorizing'].includes(installation.state)
    ) {
      installation.state = 'expired'
      installation.error = '飞书二维码已过期，请重新连接。'
      installation.controller.abort()
    }
    return this.publicStatus(installation)
  }

  cancelInstallation(installationId: string): FeishuInstallationStatus {
    const installation = this.requireInstallation(installationId)
    if (installation.state === 'authorized') {
      throw ApiError.conflict('飞书已连接，请断开应用。')
    }

    if (['expired', 'failed', 'cancelled'].includes(installation.state)) {
      return this.publicStatus(installation)
    }
    installation.state = 'cancelled'
    installation.error = undefined
    installation.controller.abort()
    return this.publicStatus(installation)
  }

  async disconnect(): Promise<void> {
    for (const installation of this.installations.values()) {
      if (['waiting', 'authorizing'].includes(installation.state)) {
        installation.state = 'cancelled'
        installation.controller.abort()
      }
    }
    await adapterService.updateConfig({
      feishu: {
        appId: undefined,
        appSecret: undefined,
        encryptKey: undefined,
        verificationToken: undefined,
        allowedUsers: [],
        pairedUsers: [],
      },
    })
  }

  private async authorize(
    installation: InternalInstallation,
    result: RegisterAppResult,
  ): Promise<void> {
    const appId = result.client_id?.trim()
    const appSecret = result.client_secret?.trim()
    const scannerOpenId = result.user_info?.open_id?.trim()
    if (!appId || !appSecret || !scannerOpenId) {
      installation.state = 'failed'
      installation.error = '飞书授权未返回完整的应用凭据或扫码者身份，请重新连接。'
      return
    }

    if (installation.controller.signal.aborted || installation.state !== 'authorizing') return
    await adapterService.updateConfig({
      feishu: {
        appId,
        appSecret,
        encryptKey: undefined,
        verificationToken: undefined,
        allowedUsers: [],
        pairedUsers: [{
          userId: scannerOpenId,
          displayName: 'Feishu scanner',
          pairedAt: Date.now(),
        }],
      },
    })
    if (installation.controller.signal.aborted || installation.state !== 'authorizing') {
      const config = await adapterService.getRawConfig()
      if (config.feishu?.appId === appId && config.feishu?.appSecret === appSecret) {
        await adapterService.updateConfig({
          feishu: {
            appId: undefined,
            appSecret: undefined,
            encryptKey: undefined,
            verificationToken: undefined,
            allowedUsers: [],
            pairedUsers: [],
          },
        })
      }
      return
    }
    installation.appId = appId
    installation.state = 'authorized'
    installation.qrCodeDataUrl = undefined
    installation.authorizationUrl = undefined
    installation.error = undefined
  }

  private requireInstallation(installationId: string): InternalInstallation {
    const installation = this.installations.get(installationId)
    if (!installation) throw ApiError.notFound('飞书连接任务不存在。')
    return installation
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [installationId, installation] of this.installations) {
      if (now >= installation.expiresAt) {
        installation.controller.abort()
        this.installations.delete(installationId)
      }
    }
  }

  private publicStatus(
    installation: InternalInstallation,
  ): FeishuInstallationStatus {
    return {
      installationId: installation.installationId,
      state: installation.state,
      expiresAt: installation.expiresAt,
      ...(installation.qrCodeDataUrl && installation.state === 'waiting'
        ? { qrCodeDataUrl: installation.qrCodeDataUrl }
        : {}),
      ...(installation.authorizationUrl && installation.state === 'waiting'
        ? { authorizationUrl: installation.authorizationUrl }
        : {}),
      ...(installation.appId ? { appId: installation.appId } : {}),
      ...(installation.error ? { error: installation.error } : {}),
    }
  }
}

export const feishuInstallService = new FeishuInstallService()

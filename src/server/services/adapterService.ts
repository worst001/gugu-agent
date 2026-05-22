/**
 * Adapter Service — 读写 IM Adapter 配置文件
 *
 * 配置文件：~/.claude/adapters.json
 * 原子写入：先写临时文件，再 rename
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code?: string | null
  expiresAt?: number | null
  createdAt?: number | null
}

export type AdapterPlatform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq'

export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  pairing?: PairingState
  telegram?: {
    botToken?: string
    allowedUsers?: number[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
  }
  dingtalk?: {
    clientId?: string
    clientSecret?: string
    robotCode?: string
    webhookUrl?: string
    webhookSecret?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  wecom?: {
    corpId?: string
    agentId?: string
    secret?: string
    token?: string
    encodingAesKey?: string
    webhookUrl?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  qq?: {
    appId?: string
    token?: string
    appSecret?: string
    sandbox?: boolean
    oneBotUrl?: string
    oneBotAccessToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
}

export type AdapterChannelStatus = {
  platform: AdapterPlatform
  status: 'ready' | 'needs_credentials' | 'not_configured'
  credentialsReady: boolean
  missingCredentials: string[]
  allowedUsersCount: number
  pairedUsersCount: number
}

export type AdapterDiagnostics = {
  configLocation: string
  defaultProjectConfigured: boolean
  pairingActive: boolean
  pairingExpiresAt: number | null
  channels: AdapterChannelStatus[]
  notes: string[]
}

function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapters.json')
}

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return value
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

function isMasked(value: string | undefined): boolean {
  return !!value && value.startsWith('****')
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function resolveStatus(
  configuredFields: string[],
  missingCredentials: string[],
): AdapterChannelStatus['status'] {
  if (configuredFields.length === 0) return 'not_configured'
  if (missingCredentials.length > 0) return 'needs_credentials'
  return 'ready'
}

function textFields(config: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => hasValue(config[field] as string | undefined))
}

function withCounts(
  platform: AdapterPlatform,
  configuredFields: string[],
  missingCredentials: string[],
  allowedUsersCount: number,
  pairedUsersCount: number,
): AdapterChannelStatus {
  return {
    platform,
    status: resolveStatus(configuredFields, missingCredentials),
    credentialsReady: missingCredentials.length === 0,
    missingCredentials,
    allowedUsersCount,
    pairedUsersCount,
  }
}

class AdapterService {
  /** 读取原始配置（不脱敏） */
  async getRawConfig(): Promise<AdapterFileConfig> {
    try {
      const raw = await fs.readFile(getConfigPath(), 'utf-8')
      return JSON.parse(raw) as AdapterFileConfig
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw ApiError.internal(`Failed to read adapter config: ${err}`)
    }
  }

  /** 读取配置（敏感字段脱敏） */
  async getConfig(): Promise<AdapterFileConfig> {
    const config = await this.getRawConfig()
    if (config.telegram?.botToken) {
      config.telegram.botToken = maskSecret(config.telegram.botToken)
    }
    if (config.feishu) {
      if (config.feishu.appSecret) config.feishu.appSecret = maskSecret(config.feishu.appSecret)
      if (config.feishu.encryptKey) config.feishu.encryptKey = maskSecret(config.feishu.encryptKey)
      if (config.feishu.verificationToken) config.feishu.verificationToken = maskSecret(config.feishu.verificationToken)
    }
    if (config.dingtalk) {
      if (config.dingtalk.clientSecret) config.dingtalk.clientSecret = maskSecret(config.dingtalk.clientSecret)
      if (config.dingtalk.webhookUrl) config.dingtalk.webhookUrl = maskSecret(config.dingtalk.webhookUrl)
      if (config.dingtalk.webhookSecret) config.dingtalk.webhookSecret = maskSecret(config.dingtalk.webhookSecret)
    }
    if (config.wecom) {
      if (config.wecom.secret) config.wecom.secret = maskSecret(config.wecom.secret)
      if (config.wecom.token) config.wecom.token = maskSecret(config.wecom.token)
      if (config.wecom.encodingAesKey) config.wecom.encodingAesKey = maskSecret(config.wecom.encodingAesKey)
      if (config.wecom.webhookUrl) config.wecom.webhookUrl = maskSecret(config.wecom.webhookUrl)
    }
    if (config.qq) {
      if (config.qq.token) config.qq.token = maskSecret(config.qq.token)
      if (config.qq.appSecret) config.qq.appSecret = maskSecret(config.qq.appSecret)
      if (config.qq.oneBotAccessToken) config.qq.oneBotAccessToken = maskSecret(config.qq.oneBotAccessToken)
    }
    if (config.pairing?.code) {
      config.pairing.code = '******'
    }
    return config
  }

  async getDiagnostics(): Promise<AdapterDiagnostics> {
    const config = await this.getRawConfig()
    const telegram = config.telegram ?? {}
    const feishu = config.feishu ?? {}
    const dingtalk = config.dingtalk ?? {}
    const wecom = config.wecom ?? {}
    const qq = config.qq ?? {}
    const pairingExpiresAt = config.pairing?.expiresAt ?? null
    const now = Date.now()

    const telegramMissing = hasValue(telegram.botToken) ? [] : ['botToken']
    const feishuMissing = [
      ...(hasValue(feishu.appId) ? [] : ['appId']),
      ...(hasValue(feishu.appSecret) ? [] : ['appSecret']),
    ]
    const dingtalkMissing = [
      ...(hasValue(dingtalk.clientId) ? [] : ['clientId']),
      ...(hasValue(dingtalk.clientSecret) ? [] : ['clientSecret']),
    ]
    const wecomMissing = [
      ...(hasValue(wecom.corpId) ? [] : ['corpId']),
      ...(hasValue(wecom.agentId) ? [] : ['agentId']),
      ...(hasValue(wecom.secret) ? [] : ['secret']),
      ...(hasValue(wecom.token) ? [] : ['token']),
      ...(hasValue(wecom.encodingAesKey) ? [] : ['encodingAesKey']),
    ]
    const qqHasBot = hasValue(qq.appId) && (hasValue(qq.appSecret) || hasValue(qq.token))
    const qqHasOneBot = hasValue(qq.oneBotUrl)
    const qqMissing = qqHasBot || qqHasOneBot
      ? []
      : ['appId/appSecret or oneBotUrl']

    return {
      configLocation: '~/.claude/adapters.json',
      defaultProjectConfigured: hasValue(config.defaultProjectDir),
      pairingActive: typeof pairingExpiresAt === 'number' && pairingExpiresAt > now,
      pairingExpiresAt,
      channels: [
        withCounts(
          'telegram',
          [
            ...(hasValue(telegram.botToken) ? ['botToken'] : []),
            ...((telegram.allowedUsers?.length ?? 0) > 0 ? ['allowedUsers'] : []),
            ...((telegram.pairedUsers?.length ?? 0) > 0 ? ['pairedUsers'] : []),
          ],
          telegramMissing,
          telegram.allowedUsers?.length ?? 0,
          telegram.pairedUsers?.length ?? 0,
        ),
        withCounts(
          'feishu',
          [
            ...textFields(feishu, ['appId', 'appSecret', 'encryptKey', 'verificationToken']),
            ...((feishu.allowedUsers?.length ?? 0) > 0 ? ['allowedUsers'] : []),
            ...((feishu.pairedUsers?.length ?? 0) > 0 ? ['pairedUsers'] : []),
          ],
          feishuMissing,
          feishu.allowedUsers?.length ?? 0,
          feishu.pairedUsers?.length ?? 0,
        ),
        withCounts(
          'dingtalk',
          [
            ...textFields(dingtalk, ['clientId', 'clientSecret', 'robotCode', 'webhookUrl', 'webhookSecret']),
            ...((dingtalk.allowedUsers?.length ?? 0) > 0 ? ['allowedUsers'] : []),
            ...((dingtalk.pairedUsers?.length ?? 0) > 0 ? ['pairedUsers'] : []),
          ],
          dingtalkMissing,
          dingtalk.allowedUsers?.length ?? 0,
          dingtalk.pairedUsers?.length ?? 0,
        ),
        withCounts(
          'wecom',
          [
            ...textFields(wecom, ['corpId', 'agentId', 'secret', 'token', 'encodingAesKey', 'webhookUrl']),
            ...((wecom.allowedUsers?.length ?? 0) > 0 ? ['allowedUsers'] : []),
            ...((wecom.pairedUsers?.length ?? 0) > 0 ? ['pairedUsers'] : []),
          ],
          wecomMissing,
          wecom.allowedUsers?.length ?? 0,
          wecom.pairedUsers?.length ?? 0,
        ),
        withCounts(
          'qq',
          [
            ...textFields(qq, ['appId', 'token', 'appSecret', 'oneBotUrl', 'oneBotAccessToken']),
            ...((qq.allowedUsers?.length ?? 0) > 0 ? ['allowedUsers'] : []),
            ...((qq.pairedUsers?.length ?? 0) > 0 ? ['pairedUsers'] : []),
          ],
          qqMissing,
          qq.allowedUsers?.length ?? 0,
          qq.pairedUsers?.length ?? 0,
        ),
      ],
      notes: [
        'Diagnostics only checks local configuration readiness. It does not call IM provider APIs.',
        'Adapter credentials stay in the local adapters config and are never returned by this endpoint.',
      ],
    }
  }

  /** 更新配置（浅合并，敏感字段如果是脱敏值则保留原值） */
  async updateConfig(patch: Partial<AdapterFileConfig>): Promise<void> {
    const current = await this.getRawConfig()

    // 保留已存储的密钥（如果前端传回的是脱敏值）
    if (patch.telegram && isMasked(patch.telegram.botToken)) {
      patch.telegram.botToken = current.telegram?.botToken
    }
    if (patch.feishu) {
      if (isMasked(patch.feishu.appSecret)) patch.feishu.appSecret = current.feishu?.appSecret
      if (isMasked(patch.feishu.encryptKey)) patch.feishu.encryptKey = current.feishu?.encryptKey
      if (isMasked(patch.feishu.verificationToken)) patch.feishu.verificationToken = current.feishu?.verificationToken
    }
    if (patch.dingtalk) {
      if (isMasked(patch.dingtalk.clientSecret)) patch.dingtalk.clientSecret = current.dingtalk?.clientSecret
      if (isMasked(patch.dingtalk.webhookUrl)) patch.dingtalk.webhookUrl = current.dingtalk?.webhookUrl
      if (isMasked(patch.dingtalk.webhookSecret)) patch.dingtalk.webhookSecret = current.dingtalk?.webhookSecret
    }
    if (patch.wecom) {
      if (isMasked(patch.wecom.secret)) patch.wecom.secret = current.wecom?.secret
      if (isMasked(patch.wecom.token)) patch.wecom.token = current.wecom?.token
      if (isMasked(patch.wecom.encodingAesKey)) patch.wecom.encodingAesKey = current.wecom?.encodingAesKey
      if (isMasked(patch.wecom.webhookUrl)) patch.wecom.webhookUrl = current.wecom?.webhookUrl
    }
    if (patch.qq) {
      if (isMasked(patch.qq.token)) patch.qq.token = current.qq?.token
      if (isMasked(patch.qq.appSecret)) patch.qq.appSecret = current.qq?.appSecret
      if (isMasked(patch.qq.oneBotAccessToken)) patch.qq.oneBotAccessToken = current.qq?.oneBotAccessToken
    }
    if (patch.pairing && isMasked(patch.pairing.code ?? undefined)) {
      patch.pairing.code = current.pairing?.code
    }

    const merged: AdapterFileConfig = {
      ...current,
      ...patch,
      telegram: patch.telegram ? { ...current.telegram, ...patch.telegram } : current.telegram,
      feishu: patch.feishu ? { ...current.feishu, ...patch.feishu } : current.feishu,
      dingtalk: patch.dingtalk ? { ...current.dingtalk, ...patch.dingtalk } : current.dingtalk,
      wecom: patch.wecom ? { ...current.wecom, ...patch.wecom } : current.wecom,
      qq: patch.qq ? { ...current.qq, ...patch.qq } : current.qq,
      pairing: patch.pairing !== undefined ? { ...current.pairing, ...patch.pairing } : current.pairing,
    }

    await this.writeConfig(merged)
  }

  private async writeConfig(data: AdapterFileConfig): Promise<void> {
    const filePath = getConfigPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write adapter config: ${err}`)
    }
  }
}

export const adapterService = new AdapterService()

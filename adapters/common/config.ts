/**
 * Adapter 配置加载
 *
 * 优先级：环境变量 > ~/.claude/adapters.json > 默认值
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code: string | null
  expiresAt: number | null
  createdAt: number | null
}

export type TelegramConfig = {
  botToken: string
  allowedUsers: number[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type FeishuConfig = {
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
  streamingCard: boolean
}

export type DingtalkConfig = {
  clientId: string
  clientSecret: string
  robotCode: string
  webhookUrl: string
  webhookSecret: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type WecomConfig = {
  corpId: string
  agentId: string
  secret: string
  token: string
  encodingAesKey: string
  webhookUrl: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type QqConfig = {
  appId: string
  token: string
  appSecret: string
  sandbox: boolean
  oneBotUrl: string
  oneBotAccessToken: string
  allowedUsers: string[]
  pairedUsers: PairedUser[]
  defaultWorkDir: string
}

export type AdapterConfig = {
  serverUrl: string
  defaultProjectDir: string
  pairing: PairingState
  telegram: TelegramConfig
  feishu: FeishuConfig
  dingtalk: DingtalkConfig
  wecom: WecomConfig
  qq: QqConfig
}

function getConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  return path.join(configDir, 'adapters.json')
}

function loadFile(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'))
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn(`[Config] Failed to parse ${getConfigPath()}, using defaults`)
    }
    return {}
  }
}

export function loadConfig(): AdapterConfig {
  const file = loadFile()
  const tg = file.telegram ?? {}
  const fs_ = file.feishu ?? {}
  const dt = file.dingtalk ?? {}
  const wc = file.wecom ?? {}
  const qq = file.qq ?? {}
  const pairing = file.pairing ?? {}

  return {
    serverUrl: process.env.ADAPTER_SERVER_URL || file.serverUrl || 'ws://127.0.0.1:3456',
    defaultProjectDir: file.defaultProjectDir || '',
    pairing: {
      code: pairing.code ?? null,
      expiresAt: pairing.expiresAt ?? null,
      createdAt: pairing.createdAt ?? null,
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || tg.botToken || '',
      allowedUsers: tg.allowedUsers ?? [],
      pairedUsers: tg.pairedUsers ?? [],
      defaultWorkDir: tg.defaultWorkDir || process.cwd(),
    },
    feishu: {
      appId: process.env.FEISHU_APP_ID || fs_.appId || '',
      appSecret: process.env.FEISHU_APP_SECRET || fs_.appSecret || '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY || fs_.encryptKey || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || fs_.verificationToken || '',
      allowedUsers: fs_.allowedUsers ?? [],
      pairedUsers: fs_.pairedUsers ?? [],
      defaultWorkDir: fs_.defaultWorkDir || process.cwd(),
      streamingCard: fs_.streamingCard ?? false,
    },
    dingtalk: {
      clientId: process.env.DINGTALK_CLIENT_ID || dt.clientId || '',
      clientSecret: process.env.DINGTALK_CLIENT_SECRET || dt.clientSecret || '',
      robotCode: process.env.DINGTALK_ROBOT_CODE || dt.robotCode || '',
      webhookUrl: process.env.DINGTALK_WEBHOOK_URL || dt.webhookUrl || '',
      webhookSecret: process.env.DINGTALK_WEBHOOK_SECRET || dt.webhookSecret || '',
      allowedUsers: dt.allowedUsers ?? [],
      pairedUsers: dt.pairedUsers ?? [],
      defaultWorkDir: dt.defaultWorkDir || process.cwd(),
    },
    wecom: {
      corpId: process.env.WECOM_CORP_ID || wc.corpId || '',
      agentId: process.env.WECOM_AGENT_ID || wc.agentId || '',
      secret: process.env.WECOM_SECRET || wc.secret || '',
      token: process.env.WECOM_TOKEN || wc.token || '',
      encodingAesKey: process.env.WECOM_ENCODING_AES_KEY || wc.encodingAesKey || '',
      webhookUrl: process.env.WECOM_WEBHOOK_URL || wc.webhookUrl || '',
      allowedUsers: wc.allowedUsers ?? [],
      pairedUsers: wc.pairedUsers ?? [],
      defaultWorkDir: wc.defaultWorkDir || process.cwd(),
    },
    qq: {
      appId: process.env.QQ_APP_ID || qq.appId || '',
      token: process.env.QQ_TOKEN || qq.token || '',
      appSecret: process.env.QQ_APP_SECRET || qq.appSecret || '',
      sandbox: process.env.QQ_SANDBOX ? process.env.QQ_SANDBOX === 'true' : (qq.sandbox ?? false),
      oneBotUrl: process.env.QQ_ONEBOT_URL || qq.oneBotUrl || '',
      oneBotAccessToken: process.env.QQ_ONEBOT_ACCESS_TOKEN || qq.oneBotAccessToken || '',
      allowedUsers: qq.allowedUsers ?? [],
      pairedUsers: qq.pairedUsers ?? [],
      defaultWorkDir: qq.defaultWorkDir || process.cwd(),
    },
  }
}

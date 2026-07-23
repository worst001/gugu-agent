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

export type AdapterPlatform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq' | 'weixin'

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
  weixin?: {
    accountId?: string
    baseUrl?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
}

export type FeishuConnection = {
  connected: boolean
  appId: string | null
}

export type FeishuInstallationStatus = {
  installationId: string
  state:
    | 'waiting'
    | 'authorizing'
    | 'authorized'
    | 'expired'
    | 'failed'
    | 'cancelled'
  expiresAt: number
  qrCodeDataUrl?: string
  authorizationUrl?: string
  appId?: string
  error?: string
}

export type WeixinRuntimeStatus = {
  state: 'starting' | 'online' | 'degraded' | 'offline'
  lastPollAt: number | null
  error: string | null
}

export type WeixinConnection = {
  connected: boolean
  accountId: string | null
  runtime: WeixinRuntimeStatus
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

export type AdapterRestartReport = {
  status: 'started' | 'not_running'
  message: string
  recent_logs: string[]
}

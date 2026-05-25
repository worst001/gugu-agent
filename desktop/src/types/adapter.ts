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

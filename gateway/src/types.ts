export type GatewayPlan = 'free' | 'pro' | 'team'

export type GatewayEntitlementStatus =
  | 'active'
  | 'expired'
  | 'quota_exhausted'
  | 'inactive'

export type GatewayEntitlement = {
  status: GatewayEntitlementStatus
  plan: GatewayPlan
  expiresAt: string | null
  creditsTotal: number
  creditsRemaining: number
  isTrial: boolean
  purchaseUrl: string | null
  message: string
  reason?: 'quota_exhausted' | 'expired' | 'inactive'
}

export type GatewayDeviceResponse = {
  deviceId: string
  deviceToken: string
  entitlement: GatewayEntitlement
}

export type GatewayDeviceSummary = {
  deviceId: string
  deviceToken: string
  plan: GatewayPlan
  licenseKey: string | null
  appVersion: string | null
  platform: string | null
  createdAt: string
  updatedAt: string
  lastSeenAt: string
  entitlement: GatewayEntitlement
}

export type GatewayUsageEvent = {
  id: number
  deviceId: string
  kind: string
  model: string
  credits: number
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
  metadata: string | null
}

export type GatewayErrorBody = {
  error: {
    code: string
    message: string
    entitlement?: GatewayEntitlement
  }
}

export type GatewayConfig = {
  dbPath: string
  freeCredits: number
  purchaseUrl: string | null
  deepseekApiKey: string
  deepseekBaseUrl: string
  deepseekMainModel: string
  deepseekFastModel: string
  glmApiKey: string
  glmBaseUrl: string
}

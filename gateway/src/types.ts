export type GatewayPlan = 'free' | 'light' | 'pro' | 'max' | 'team'

export type GatewayPackageId =
  | 'trial'
  | 'light-monthly'
  | 'pro-monthly'
  | 'max-monthly'
  | 'topup-small'
  | 'topup-large'

export type GatewayPackageKind = 'subscription' | 'topup' | 'trial'

export type GatewayOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'cancelled'

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

export type GatewayPackage = {
  id: GatewayPackageId
  kind: GatewayPackageKind
  plan: GatewayPlan
  name: string
  description: string
  credits: number
  amountCents: number
  currency: 'CNY'
  durationDays: number | null
  maxActivations: number
}

export type GatewayOrder = {
  id: number
  orderId: string
  packageId: GatewayPackageId
  packageName: string
  kind: GatewayPackageKind
  plan: GatewayPlan
  credits: number
  amountCents: number
  currency: 'CNY'
  status: GatewayOrderStatus
  contact: string | null
  licenseKey: string | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
  fulfilledAt: string | null
  cancelledAt: string | null
}

export type GatewayDashboardSummary = {
  range: '7d' | '30d' | 'all'
  generatedAt: string
  devices: {
    total: number
    active7d: number
    active30d: number
    byPlan: Array<{ plan: GatewayPlan; count: number }>
  }
  credits: {
    total: number
    remaining: number
    used: number
    estimatedRemainingTokens: number | null
  }
  usage: {
    events: number
    credits: number
    inputTokens: number
    outputTokens: number
    byKind: Array<{ kind: string; events: number; credits: number; inputTokens: number; outputTokens: number }>
    byModel: Array<{ model: string; events: number; credits: number; inputTokens: number; outputTokens: number }>
    daily: Array<{ date: string; events: number; credits: number; inputTokens: number; outputTokens: number }>
    topDevices: Array<{ deviceId: string; plan: GatewayPlan; credits: number; inputTokens: number; outputTokens: number; lastSeenAt: string }>
  }
  orders: {
    pending: number
    paid: number
    fulfilled: number
    cancelled: number
    recent: GatewayOrder[]
  }
}

export type GatewayListResponse<T> = {
  data: T[]
  pagination: {
    limit: number
    nextCursor: number | null
  }
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
  publicBaseUrl: string | null
  downloadUrl: string | null
  downloadVersion: string | null
  downloadSha256: string | null
  adminToken: string
  dashboardTokenPerCredit: number | null
  deepseekApiKey: string
  deepseekBaseUrl: string
  deepseekMainModel: string
  deepseekFastModel: string
  messageCreditCost: number
  attachmentCreditCost: number
  fileParseCreditCost: number
  summarizeCreditCost: number
  glmApiKey: string
  glmBaseUrl: string
}

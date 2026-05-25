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

export type BillingStatus = 'not_configured' | 'inactive' | 'active' | 'expired' | 'check_failed'

export type BillingStatusResponse = {
  status: BillingStatus
  plan: string | null
  expiresAt: string | null
  maskedLicenseKey: string | null
  purchaseUrl: string | null
  lastCheckedAt: string | null
  message: string
}

export type BillingConfigResponse = {
  purchaseUrl: string | null
  verifyUrlConfigured: boolean
}

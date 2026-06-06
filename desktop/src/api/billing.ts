import { api } from './client'
import type { BillingConfigResponse, BillingReferralSummaryResponse, BillingStatusResponse } from '../types/billing'

export const billingApi = {
  getStatus() {
    return api.get<BillingStatusResponse>('/api/billing/status')
  },

  getConfig() {
    return api.get<BillingConfigResponse>('/api/billing/config')
  },

  getReferral() {
    return api.get<BillingReferralSummaryResponse>('/api/billing/referral')
  },

  activateLicense(licenseKey: string) {
    return api.put<BillingStatusResponse>('/api/billing/license', { licenseKey })
  },

  refresh() {
    return api.post<BillingStatusResponse>('/api/billing/refresh')
  },

  clearLicense() {
    return api.delete<BillingStatusResponse>('/api/billing/license')
  },
}

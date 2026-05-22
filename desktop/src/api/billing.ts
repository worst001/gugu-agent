import { api } from './client'
import type { BillingConfigResponse, BillingStatusResponse } from '../types/billing'

export const billingApi = {
  getStatus() {
    return api.get<BillingStatusResponse>('/api/billing/status')
  },

  getConfig() {
    return api.get<BillingConfigResponse>('/api/billing/config')
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

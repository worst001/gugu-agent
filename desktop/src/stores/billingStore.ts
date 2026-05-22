import { create } from 'zustand'
import { billingApi } from '../api/billing'
import type { BillingConfigResponse, BillingStatusResponse } from '../types/billing'

type BillingStore = {
  status: BillingStatusResponse | null
  config: BillingConfigResponse | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  message: string | null
  fetchBilling: () => Promise<void>
  activateLicense: (licenseKey: string) => Promise<void>
  refresh: () => Promise<void>
  clearLicense: () => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useBillingStore = create<BillingStore>((set, get) => ({
  status: null,
  config: null,
  isLoading: false,
  isSaving: false,
  error: null,
  message: null,

  fetchBilling: async () => {
    set({ isLoading: true, error: null })
    try {
      const [status, config] = await Promise.all([
        billingApi.getStatus(),
        billingApi.getConfig(),
      ])
      set({ status, config, isLoading: false, error: null, message: status.message })
    } catch (error) {
      set({ isLoading: false, error: errorMessage(error) })
    }
  },

  activateLicense: async (licenseKey) => {
    set({ isSaving: true, error: null, message: null })
    try {
      const status = await billingApi.activateLicense(licenseKey)
      set({ status, isSaving: false, error: null, message: status.message })
    } catch (error) {
      set({ isSaving: false, error: errorMessage(error) })
      throw error
    }
  },

  refresh: async () => {
    set({ isSaving: true, error: null, message: null })
    try {
      const status = await billingApi.refresh()
      set({ status, isSaving: false, error: null, message: status.message })
    } catch (error) {
      set({ isSaving: false, error: errorMessage(error) })
    }
  },

  clearLicense: async () => {
    set({ isSaving: true, error: null, message: null })
    try {
      const status = await billingApi.clearLicense()
      set({ status, isSaving: false, error: null, message: status.message })
      void get().fetchBilling()
    } catch (error) {
      set({ isSaving: false, error: errorMessage(error) })
    }
  },
}))

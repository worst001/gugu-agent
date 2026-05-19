import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import { BillingQuotaIndicator } from './BillingQuotaIndicator'
import { useBillingStore } from '../../stores/billingStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import type { BillingStatusResponse } from '../../types/billing'

function status(overrides: Partial<BillingStatusResponse> = {}): BillingStatusResponse {
  return {
    status: 'active',
    plan: 'free',
    expiresAt: null,
    maskedLicenseKey: null,
    purchaseUrl: 'https://billing.example.com/gugu',
    lastCheckedAt: null,
    message: 'Gateway entitlement is active.',
    deviceId: 'device-1',
    creditsTotal: 50,
    creditsRemaining: 38,
    isTrial: true,
    quotaReason: null,
    ...overrides,
  }
}

describe('BillingQuotaIndicator', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useUIStore.setState({ activeView: 'code', pendingSettingsTab: null })
    useBillingStore.setState({
      status: null,
      config: {
        purchaseUrl: 'https://billing.example.com/gugu',
        verifyUrlConfigured: false,
        gatewayUrlConfigured: true,
      },
      isLoading: false,
      isSaving: false,
      error: null,
      message: null,
      fetchBilling: vi.fn().mockResolvedValue(undefined),
      activateLicense: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      clearLicense: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('shows usage and remaining percentage for trials', () => {
    useBillingStore.setState({ status: status() })

    render(<BillingQuotaIndicator />)

    expect(screen.getByText('Usage')).toBeInTheDocument()
    expect(screen.queryByText('Free trial')).not.toBeInTheDocument()
    expect(screen.getByText('76% left')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Usage remaining' })).toHaveAttribute('aria-valuenow', '76')
  })

  it('does not render without quota data', () => {
    useBillingStore.setState({
      status: status({ creditsTotal: null, creditsRemaining: null }),
    })

    const { container } = render(<BillingQuotaIndicator />)

    expect(container).toBeEmptyDOMElement()
  })

  it('marks low and exhausted quota states', () => {
    useBillingStore.setState({ status: status({ creditsRemaining: 5 }) })
    const { rerender } = render(<BillingQuotaIndicator />)

    expect(screen.getByText('Low - 10% left')).toBeInTheDocument()

    act(() => {
      useBillingStore.setState({
        status: status({ status: 'quota_exhausted', creditsRemaining: 0 }),
      })
    })
    rerender(<BillingQuotaIndicator />)

    expect(screen.getByText('Usage limit reached')).toBeInTheDocument()
    expect(screen.getByText('Purchase or activate')).toBeInTheDocument()
  })

  it('opens the billing settings tab when clicked', () => {
    useBillingStore.setState({ status: status() })

    render(<BillingQuotaIndicator />)
    fireEvent.click(screen.getByTestId('billing-quota-indicator'))

    expect(useUIStore.getState().activeView).toBe('settings')
    expect(useUIStore.getState().pendingSettingsTab).toBe('billing')
  })
})

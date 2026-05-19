import { useTranslation } from '../../i18n'
import { useBillingStore } from '../../stores/billingStore'
import { useUIStore } from '../../stores/uiStore'
import type { BillingStatusResponse } from '../../types/billing'

type BillingQuotaIndicatorProps = {
  variant?: 'compact' | 'composer'
  className?: string
}

type QuotaView = {
  used: number
  total: number
  remaining: number
  usedPercent: number
  remainingPercent: number
  tone: 'normal' | 'low' | 'exhausted'
  isTrial: boolean
  plan: string | null
}

const LOW_CREDITS_RATIO = 0.2

export function BillingQuotaIndicator({
  variant = 'compact',
  className = '',
}: BillingQuotaIndicatorProps) {
  const t = useTranslation()
  const status = useBillingStore((s) => s.status)
  const quota = getBillingQuotaView(status)

  if (!quota) return null

  const openBilling = () => {
    useUIStore.getState().setPendingSettingsTab('billing')
    useUIStore.getState().setActiveView('settings')
  }

  const planLabel = quota.isTrial
    ? t('billing.quota.usage')
    : quota.plan || t('billing.quota.activePlan')
  const mainLabel = quota.tone === 'exhausted'
    ? t('billing.quota.exhausted')
    : planLabel
  const remainingLabel = quota.tone === 'exhausted'
    ? t('billing.quota.activateHint')
    : quota.tone === 'low'
      ? t('billing.quota.lowPercent', { percent: quota.remainingPercent })
      : t('billing.quota.remainingPercent', { percent: quota.remainingPercent })

  const toneClass = {
    normal: 'border-[var(--color-border)]/80 bg-[var(--color-surface-container-lowest)]/80 text-[var(--color-text-secondary)] hover:border-[var(--color-brand)]/35 hover:bg-[var(--color-surface-container-lowest)]',
    low: 'border-[var(--color-warning)]/45 bg-[var(--color-warning)]/10 text-[var(--color-warning)] hover:border-[var(--color-warning)]/65',
    exhausted: 'border-[var(--color-warning)]/55 bg-[var(--color-warning)]/10 text-[var(--color-warning)] hover:border-[var(--color-warning)]/75',
  }[quota.tone]
  const fillClass = quota.tone === 'normal'
    ? 'bg-[var(--color-brand)]'
    : 'bg-[var(--color-warning)]'
  const widthClass = variant === 'composer'
    ? 'min-w-[176px] max-w-[220px]'
    : 'min-w-[168px] max-w-[210px]'

  return (
    <button
      type="button"
      data-testid="billing-quota-indicator"
      aria-label={t('billing.quota.openBilling')}
      title={t('billing.quota.openBilling')}
      onClick={openBilling}
      className={`flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-left text-xs transition-[background-color,border-color,box-shadow] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] ${toneClass} ${widthClass} ${className}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
        {quota.tone === 'exhausted' ? 'hourglass_disabled' : 'toll'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-[var(--color-text-primary)]">
          {mainLabel}
        </span>
        <span className="block truncate text-[10px] leading-3 opacity-90">
          {remainingLabel}
        </span>
      </span>
      <span
        role="progressbar"
        aria-label={t('billing.quota.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={quota.remainingPercent}
        className="h-1.5 w-12 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-border)_62%,transparent)]"
      >
        <span
          className={`block h-full rounded-full transition-[width] ${fillClass}`}
          style={{ width: `${quota.remainingPercent}%` }}
        />
      </span>
    </button>
  )
}

export function getBillingQuotaView(status: BillingStatusResponse | null): QuotaView | null {
  if (!status) return null

  const total = status.creditsTotal
  const rawRemaining = status.creditsRemaining
  if (
    typeof total !== 'number' ||
    typeof rawRemaining !== 'number' ||
    !Number.isFinite(total) ||
    !Number.isFinite(rawRemaining) ||
    total <= 0
  ) {
    return null
  }

  const remaining = Math.max(0, Math.min(total, Math.trunc(rawRemaining)))
  const used = Math.max(0, total - remaining)
  const usedPercent = Math.max(0, Math.min(100, Math.round((used / total) * 100)))
  const remainingPercent = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
  const isExhausted = status.status === 'quota_exhausted' || remaining <= 0
  const isLow = !isExhausted && remaining / total <= LOW_CREDITS_RATIO

  return {
    used,
    total,
    remaining,
    usedPercent,
    remainingPercent,
    tone: isExhausted ? 'exhausted' : isLow ? 'low' : 'normal',
    isTrial: Boolean(status.isTrial),
    plan: typeof status.plan === 'string' && status.plan.trim() ? status.plan.trim() : null,
  }
}

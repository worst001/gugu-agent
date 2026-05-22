import type { GatewayPackage, GatewayPackageId } from './types.js'

export const GATEWAY_PACKAGES: Record<GatewayPackageId, GatewayPackage> = {
  trial: {
    id: 'trial',
    kind: 'trial',
    plan: 'free',
    name: '试用版',
    description: '7 天试用，适合体验基础问答和小型任务。',
    credits: 50,
    amountCents: 0,
    currency: 'CNY',
    durationDays: 7,
    maxActivations: 1,
  },
  'light-monthly': {
    id: 'light-monthly',
    kind: 'subscription',
    plan: 'light',
    name: '轻量版',
    description: '偶尔使用、小修改和轻量文件处理。',
    credits: 180,
    amountCents: 1900,
    currency: 'CNY',
    durationDays: 31,
    maxActivations: 1,
  },
  'pro-monthly': {
    id: 'pro-monthly',
    kind: 'subscription',
    plan: 'pro',
    name: 'Pro',
    description: '日常开发、调试、CE 工作流和文件解析的推荐套餐。',
    credits: 600,
    amountCents: 4900,
    currency: 'CNY',
    durationDays: 31,
    maxActivations: 1,
  },
  'max-monthly': {
    id: 'max-monthly',
    kind: 'subscription',
    plan: 'max',
    name: 'Max',
    description: '高频使用、复杂项目和更多文件解析额度。',
    credits: 1500,
    amountCents: 9900,
    currency: 'CNY',
    durationDays: 31,
    maxActivations: 1,
  },
  'topup-small': {
    id: 'topup-small',
    kind: 'topup',
    plan: 'pro',
    name: '补充包',
    description: '为当前设备补充额度。',
    credits: 200,
    amountCents: 1900,
    currency: 'CNY',
    durationDays: null,
    maxActivations: 1,
  },
  'topup-large': {
    id: 'topup-large',
    kind: 'topup',
    plan: 'pro',
    name: '大额补充包',
    description: '为当前设备补充更多额度。',
    credits: 700,
    amountCents: 4900,
    currency: 'CNY',
    durationDays: null,
    maxActivations: 1,
  },
}

export const PURCHASE_PACKAGES = [
  GATEWAY_PACKAGES['light-monthly'],
  GATEWAY_PACKAGES['pro-monthly'],
  GATEWAY_PACKAGES['max-monthly'],
]

export function isPurchasablePackageId(packageId: string): boolean {
  return PURCHASE_PACKAGES.some((pkg) => pkg.id === packageId)
}

export function getGatewayPackage(packageId: string | undefined): GatewayPackage | null {
  if (!packageId) return null
  return GATEWAY_PACKAGES[packageId as GatewayPackageId] ?? null
}

export function packageExpiresAt(packageId: GatewayPackageId, from = new Date()): string | null {
  const pkg = GATEWAY_PACKAGES[packageId]
  if (!pkg.durationDays) return null
  const expires = new Date(from)
  expires.setDate(expires.getDate() + pkg.durationDays)
  return expires.toISOString()
}

export function formatAmountCny(amountCents: number): string {
  if (amountCents <= 0) return '免费'
  return `¥${(amountCents / 100).toFixed(amountCents % 100 === 0 ? 0 : 2)}`
}

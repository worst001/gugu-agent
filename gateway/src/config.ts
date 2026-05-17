import * as os from 'node:os'
import * as path from 'node:path'
import type { GatewayConfig } from './types.js'

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readOptionalUrl(name: string): string | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function loadGatewayConfig(): GatewayConfig {
  return {
    dbPath:
      process.env.GUGU_GATEWAY_DB_PATH?.trim() ||
      path.join(os.homedir(), '.gugu-agent', 'gateway.sqlite'),
    freeCredits: readIntEnv('GUGU_FREE_CREDITS', 50),
    purchaseUrl: readOptionalUrl('GUGU_PURCHASE_URL'),
    deepseekApiKey: process.env.GUGU_DEEPSEEK_API_KEY?.trim() || '',
    deepseekBaseUrl:
      readOptionalUrl('GUGU_DEEPSEEK_BASE_URL') ||
      'https://api.deepseek.com/anthropic',
    deepseekMainModel:
      process.env.GUGU_DEEPSEEK_MODEL?.trim() || 'deepseek-v4-pro',
    deepseekFastModel:
      process.env.GUGU_DEEPSEEK_FAST_MODEL?.trim() || 'deepseek-v4-flash',
    glmApiKey: process.env.GUGU_GLM_API_KEY?.trim() || '',
    glmBaseUrl:
      readOptionalUrl('GUGU_GLM_BASE_URL') ||
      'https://open.bigmodel.cn/api/paas/v4',
  }
}

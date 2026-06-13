import { describe, expect, test } from 'bun:test'

import { getDefaultTierForApp } from './deniedApps.js'
import { normalizeAllowedAppGrant } from './toolCalls.js'

describe('computer use app permission tiers', () => {
  test('allows explicit browser grants to operate normally', () => {
    expect(getDefaultTierForApp('com.google.Chrome', 'Google Chrome')).toBe('full')
    expect(getDefaultTierForApp('com.apple.Safari', 'Safari')).toBe('full')
  })

  test('keeps high-risk app categories restricted', () => {
    expect(getDefaultTierForApp('com.apple.Terminal', 'Terminal')).toBe('click')
    expect(getDefaultTierForApp('com.tradingview.tradingviewapp.desktop', 'TradingView')).toBe('read')
  })

  test('does not silently upgrade existing browser read grants', () => {
    expect(normalizeAllowedAppGrant({
      bundleId: 'com.google.Chrome',
      displayName: 'Google Chrome',
      tier: 'read',
    })).toMatchObject({
      bundleId: 'com.google.Chrome',
      tier: 'read',
    })
  })

  test('backfills only legacy grants without a tier', () => {
    expect(normalizeAllowedAppGrant({
      bundleId: 'com.google.Chrome',
      displayName: 'Google Chrome',
    })).toMatchObject({
      bundleId: 'com.google.Chrome',
      tier: 'full',
    })
  })
})

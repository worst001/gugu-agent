import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __testing, translateCliMessage } from '../ws/handler.js'

const SESSION_ID = 'watchdog-session'

let originalReconnectGrace: string | undefined

describe('desktop WebSocket watchdog', () => {
  beforeEach(() => {
    originalReconnectGrace = process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS
    __testing.clearTurnMonitor(SESSION_ID)
  })

  afterEach(() => {
    __testing.clearTurnMonitor(SESSION_ID)
    if (originalReconnectGrace === undefined) {
      delete process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS
    } else {
      process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = originalReconnectGrace
    }
  })

  test('active turns use extended reconnect grace', () => {
    process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = '123456'

    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(30_000)

    __testing.setTurnMonitor(SESSION_ID)

    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(123456)
  })

  test('keep_alive is silent but updates watchdog liveness', () => {
    __testing.setTurnMonitor(SESSION_ID, {
      lastProgressAt: 100,
      lastKeepAliveAt: 0,
    })

    expect(translateCliMessage({ type: 'keep_alive' }, SESSION_ID)).toEqual([])

    __testing.noteTurnActivity(SESSION_ID, { type: 'keep_alive' })
    const snapshot = __testing.getTurnMonitorSnapshot(SESSION_ID)

    expect(snapshot?.lastProgressAt).toBe(100)
    expect(snapshot?.lastKeepAliveAt).toBeGreaterThan(0)
  })
})

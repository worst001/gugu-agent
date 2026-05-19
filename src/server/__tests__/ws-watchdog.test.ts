import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { __testing, translateCliMessage } from '../ws/handler.js'

const SESSION_ID = 'watchdog-session'

let originalReconnectGrace: string | undefined
let originalSdkLivenessTimeout: string | undefined
let originalSdkReconnectGrace: string | undefined

describe('desktop WebSocket watchdog', () => {
  beforeEach(() => {
    originalReconnectGrace = process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS
    originalSdkLivenessTimeout = process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS
    originalSdkReconnectGrace = process.env.CC_HAHA_SDK_RECONNECT_GRACE_MS
    __testing.clearTurnMonitor(SESSION_ID)
    __testing.clearSessionCleanupTimer(SESSION_ID)
  })

  afterEach(() => {
    __testing.clearTurnMonitor(SESSION_ID)
    __testing.clearSessionCleanupTimer(SESSION_ID)
    if (originalReconnectGrace === undefined) {
      delete process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS
    } else {
      process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = originalReconnectGrace
    }
    if (originalSdkLivenessTimeout === undefined) {
      delete process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS
    } else {
      process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS = originalSdkLivenessTimeout
    }
    if (originalSdkReconnectGrace === undefined) {
      delete process.env.CC_HAHA_SDK_RECONNECT_GRACE_MS
    } else {
      process.env.CC_HAHA_SDK_RECONNECT_GRACE_MS = originalSdkReconnectGrace
    }
  })

  test('active turns use extended reconnect grace', () => {
    process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = '123456'

    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(30_000)

    __testing.setTurnMonitor(SESSION_ID)

    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(123456)
  })

  test('text message_stop does not end the server-side turn monitor before result', () => {
    process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = '123456'
    __testing.setTurnMonitor(SESSION_ID)

    __testing.noteTurnActivity(SESSION_ID, {
      type: 'stream_event',
      event: { type: 'message_start' },
    })
    __testing.noteTurnActivity(SESSION_ID, {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'text' },
      },
    })
    __testing.noteTurnActivity(SESSION_ID, {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
      },
    })
    __testing.noteTurnActivity(SESSION_ID, {
      type: 'stream_event',
      event: { type: 'message_stop' },
    })

    expect(__testing.getTurnMonitorSnapshot(SESSION_ID)).not.toBeNull()
    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(123456)

    __testing.noteTurnActivity(SESSION_ID, { type: 'result' })

    expect(__testing.getTurnMonitorSnapshot(SESSION_ID)).toBeNull()
    expect(__testing.getReconnectGraceMs(SESSION_ID)).toBe(30_000)
  })

  test('turn monitor startup extends a pending idle reconnect cleanup', () => {
    process.env.CC_HAHA_ACTIVE_SESSION_RECONNECT_GRACE_MS = '123456'

    __testing.scheduleSessionCleanup(SESSION_ID, 30_000)
    expect(__testing.getSessionCleanupDelayMs(SESSION_ID)).toBe(30_000)

    __testing.startTurnMonitor(SESSION_ID)

    expect(__testing.getSessionCleanupDelayMs(SESSION_ID)).toBe(123456)
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

  test('does not recover a quiet model turn while the SDK socket is connected', () => {
    process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS = '500'
    __testing.setTurnMonitor(SESSION_ID, {
      lastProgressAt: 1_000,
      lastKeepAliveAt: 1_000,
    })

    expect(__testing.shouldRecoverForMissingAgentHeartbeat(
      SESSION_ID,
      2_000,
      true,
    )).toBe(false)
  })

  test('recovers a quiet turn after the SDK socket is disconnected', () => {
    process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS = '500'
    __testing.setTurnMonitor(SESSION_ID, {
      lastProgressAt: 1_000,
      lastKeepAliveAt: 1_000,
    })

    expect(__testing.shouldRecoverForMissingAgentHeartbeat(
      SESSION_ID,
      2_000,
      false,
    )).toBe(true)
  })

  test('gives a disconnected SDK socket a reconnect grace window', () => {
    process.env.CC_HAHA_SDK_LIVENESS_TIMEOUT_MS = '500'
    process.env.CC_HAHA_SDK_RECONNECT_GRACE_MS = '2000'
    __testing.setTurnMonitor(SESSION_ID, {
      lastProgressAt: 1_000,
      lastKeepAliveAt: 1_000,
      sdkDisconnectedAt: 1_200,
    })

    expect(__testing.shouldRecoverForMissingAgentHeartbeat(
      SESSION_ID,
      2_000,
      false,
    )).toBe(false)
    expect(__testing.shouldRecoverForMissingAgentHeartbeat(
      SESSION_ID,
      3_300,
      false,
    )).toBe(true)
  })
})

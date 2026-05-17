import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type {
  GatewayConfig,
  GatewayDeviceResponse,
  GatewayEntitlement,
  GatewayPlan,
} from './types.js'

type DeviceRow = {
  device_id: string
  device_token: string
  plan: GatewayPlan
  credits_total: number
  credits_remaining: number
  expires_at: string | null
  license_key: string | null
}

type ActivationCodeRow = {
  license_key: string
  plan: GatewayPlan
  credits_total: number
  expires_at: string | null
  max_activations: number
  activations: number
  disabled_at: string | null
}

export class GatewayQuotaError extends Error {
  constructor(
    message: string,
    readonly entitlement: GatewayEntitlement,
    readonly statusCode = 402,
  ) {
    super(message)
    this.name = 'GatewayQuotaError'
  }
}

export class GatewayAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayAuthError'
  }
}

export class GatewayStore {
  private readonly db: Database

  constructor(private readonly config: GatewayConfig) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
    this.db = new Database(config.dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  registerDevice(input: {
    deviceId?: string
    appVersion?: string
    platform?: string
  }): GatewayDeviceResponse {
    const now = new Date().toISOString()
    const requestedId = normalizeId(input.deviceId)
    const existing = requestedId ? this.getDeviceById(requestedId) : null

    if (existing) {
      this.db
        .query('UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE device_id = ?')
        .run(now, now, existing.device_id)
      return {
        deviceId: existing.device_id,
        deviceToken: existing.device_token,
        entitlement: this.toEntitlement(existing),
      }
    }

    const deviceId = requestedId || randomUUID()
    const token = createDeviceToken()
    this.db
      .query(
        `INSERT INTO devices (
          device_id, device_token, plan, credits_total, credits_remaining,
          expires_at, created_at, updated_at, last_seen_at, app_version, platform
        ) VALUES (?, ?, 'free', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        deviceId,
        token,
        this.config.freeCredits,
        this.config.freeCredits,
        now,
        now,
        now,
        input.appVersion || null,
        input.platform || null,
      )

    const row = this.requireDeviceByToken(token)
    return {
      deviceId,
      deviceToken: token,
      entitlement: this.toEntitlement(row),
    }
  }

  getEntitlement(deviceToken: string): GatewayEntitlement {
    return this.toEntitlement(this.requireDeviceByToken(deviceToken))
  }

  activate(deviceToken: string, licenseKey: string): GatewayEntitlement {
    const normalized = licenseKey.trim()
    if (!normalized) {
      throw new Error('licenseKey is required')
    }

    const device = this.requireDeviceByToken(deviceToken)
    const code = this.db
      .query('SELECT * FROM activation_codes WHERE license_key = ?')
      .get(normalized) as ActivationCodeRow | null

    if (!code || code.disabled_at) {
      throw new Error('Activation code is invalid or disabled.')
    }
    if (code.activations >= code.max_activations) {
      throw new Error('Activation code has reached its activation limit.')
    }
    if (code.expires_at && Date.parse(code.expires_at) < Date.now()) {
      throw new Error('Activation code has expired.')
    }

    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      this.db
        .query(
          `UPDATE devices
           SET plan = ?, credits_total = ?, credits_remaining = ?,
               expires_at = ?, license_key = ?, updated_at = ?
           WHERE device_token = ?`,
        )
        .run(
          code.plan,
          code.credits_total,
          code.credits_total,
          code.expires_at,
          normalized,
          now,
          deviceToken,
        )
      this.db
        .query('UPDATE activation_codes SET activations = activations + 1 WHERE license_key = ?')
        .run(normalized)
    })
    tx()

    this.db
      .query('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
      .run(now, device.device_id)

    return this.getEntitlement(deviceToken)
  }

  issueActivationCode(input: {
    licenseKey?: string
    plan: GatewayPlan
    creditsTotal: number
    expiresAt?: string | null
    maxActivations?: number
  }): string {
    const licenseKey = input.licenseKey?.trim() || `GUGU-${randomBytes(12).toString('hex').toUpperCase()}`
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO activation_codes (
          license_key, plan, credits_total, expires_at, max_activations,
          activations, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        licenseKey,
        input.plan,
        input.creditsTotal,
        input.expiresAt || null,
        input.maxActivations ?? 1,
        now,
      )
    return licenseKey
  }

  disableActivationCode(licenseKey: string): void {
    this.db
      .query('UPDATE activation_codes SET disabled_at = ? WHERE license_key = ?')
      .run(new Date().toISOString(), licenseKey.trim())
  }

  setDeviceCredits(deviceToken: string, creditsRemaining: number, creditsTotal?: number): GatewayEntitlement {
    const now = new Date().toISOString()
    if (creditsTotal === undefined) {
      this.db
        .query('UPDATE devices SET credits_remaining = ?, updated_at = ? WHERE device_token = ?')
        .run(creditsRemaining, now, deviceToken)
    } else {
      this.db
        .query('UPDATE devices SET credits_remaining = ?, credits_total = ?, updated_at = ? WHERE device_token = ?')
        .run(creditsRemaining, creditsTotal, now, deviceToken)
    }
    return this.getEntitlement(deviceToken)
  }

  consumeCredit(deviceToken: string, kind: 'message' | 'attachment', model: string): GatewayEntitlement {
    const now = new Date().toISOString()
    const tx = this.db.transaction(() => {
      const device = this.requireDeviceByToken(deviceToken)
      const entitlement = this.toEntitlement(device)
      if (entitlement.status !== 'active') {
        throw new GatewayQuotaError(entitlement.message, entitlement)
      }

      const result = this.db
        .query(
          `UPDATE devices
           SET credits_remaining = credits_remaining - 1,
               updated_at = ?, last_seen_at = ?
           WHERE device_token = ? AND credits_remaining > 0`,
        )
        .run(now, now, deviceToken)

      if (result.changes !== 1) {
        const exhausted = this.toEntitlement(this.requireDeviceByToken(deviceToken))
        throw new GatewayQuotaError(exhausted.message, exhausted)
      }

      this.db
        .query(
          `INSERT INTO usage_events (
            device_id, kind, model, credits, created_at
          ) VALUES (?, ?, ?, 1, ?)`,
        )
        .run(device.device_id, kind, model, now)

      return this.toEntitlement(this.requireDeviceByToken(deviceToken))
    })
    return tx()
  }

  refundCredit(deviceToken: string): GatewayEntitlement {
    const now = new Date().toISOString()
    this.db
      .query(
        `UPDATE devices
         SET credits_remaining = MIN(credits_total, credits_remaining + 1),
             updated_at = ?
         WHERE device_token = ?`,
      )
      .run(now, deviceToken)
    return this.getEntitlement(deviceToken)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_token TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL,
        credits_total INTEGER NOT NULL,
        credits_remaining INTEGER NOT NULL,
        expires_at TEXT,
        license_key TEXT,
        app_version TEXT,
        platform TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activation_codes (
        license_key TEXT PRIMARY KEY,
        plan TEXT NOT NULL,
        credits_total INTEGER NOT NULL,
        expires_at TEXT,
        max_activations INTEGER NOT NULL,
        activations INTEGER NOT NULL DEFAULT 0,
        disabled_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        model TEXT NOT NULL,
        credits INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        created_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY(device_id) REFERENCES devices(device_id)
      );
    `)
  }

  private getDeviceById(deviceId: string): DeviceRow | null {
    return this.db
      .query('SELECT * FROM devices WHERE device_id = ?')
      .get(deviceId) as DeviceRow | null
  }

  private requireDeviceByToken(deviceToken: string): DeviceRow {
    const row = this.db
      .query('SELECT * FROM devices WHERE device_token = ?')
      .get(deviceToken.trim()) as DeviceRow | null
    if (!row) {
      throw new GatewayAuthError('Device token is invalid. Restart Gugu Agent and try again.')
    }
    return row
  }

  private toEntitlement(row: DeviceRow): GatewayEntitlement {
    const expired = Boolean(row.expires_at && Date.parse(row.expires_at) < Date.now())
    const exhausted = row.credits_remaining <= 0
    const status = expired
      ? 'expired'
      : exhausted
        ? 'quota_exhausted'
        : 'active'
    const reason = expired ? 'expired' : exhausted ? 'quota_exhausted' : undefined

    return {
      status,
      plan: row.plan,
      expiresAt: row.expires_at,
      creditsTotal: row.credits_total,
      creditsRemaining: Math.max(0, row.credits_remaining),
      isTrial: row.plan === 'free',
      purchaseUrl: this.config.purchaseUrl,
      message: getEntitlementMessage(status),
      ...(reason ? { reason } : {}),
    }
  }
}

function createDeviceToken(): string {
  return `gugu_${randomUUID()}_${randomBytes(16).toString('hex')}`
}

function normalizeId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.length <= 128 ? trimmed : trimmed.slice(0, 128)
}

function getEntitlementMessage(status: GatewayEntitlement['status']): string {
  if (status === 'quota_exhausted') {
    return 'Included credits have been used up. Purchase or activate a plan to continue.'
  }
  if (status === 'expired') {
    return 'Your plan has expired. Purchase or activate a new plan to continue.'
  }
  if (status === 'inactive') {
    return 'No active plan is available.'
  }
  return 'Gateway entitlement is active.'
}

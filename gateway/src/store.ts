import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type {
  GatewayConfig,
  GatewayDashboardSummary,
  GatewayDeviceSummary,
  GatewayDeviceResponse,
  GatewayEntitlement,
  GatewayListResponse,
  GatewayOrder,
  GatewayOrderStatus,
  GatewayOrderStatusResponse,
  GatewayPaymentProvider,
  GatewayPackageId,
  GatewayPlan,
  GatewayUsageEvent,
} from './types.js'
import { getGatewayPackage, isPurchasablePackageId, packageExpiresAt } from './packages.js'

type DeviceRow = {
  device_id: string
  device_token: string
  plan: GatewayPlan
  credits_total: number
  credits_remaining: number
  expires_at: string | null
  license_key: string | null
  app_version: string | null
  platform: string | null
  created_at: string
  updated_at: string
  last_seen_at: string
}

type ActivationCodeRow = {
  license_key: string
  plan: GatewayPlan
  credits_total: number
  expires_at: string | null
  max_activations: number
  activations: number
  disabled_at: string | null
  package_id: GatewayPackageId | null
  activation_kind: 'subscription' | 'topup' | 'trial'
}

type UsageEventRow = {
  id: number
  device_id: string
  kind: string
  model: string
  credits: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
  metadata: string | null
}

type OrderRow = {
  id: number
  order_id: string
  package_id: GatewayPackageId
  package_name: string
  package_kind: 'subscription' | 'topup' | 'trial'
  plan: GatewayPlan
  credits: number
  amount_cents: number
  currency: 'CNY'
  status: GatewayOrderStatus
  contact: string | null
  license_key: string | null
  order_token: string | null
  payment_provider: GatewayPaymentProvider | null
  payment_code_url: string | null
  payment_expires_at: string | null
  wechat_transaction_id: string | null
  wechat_trade_state: string | null
  wechat_success_time: string | null
  alipay_trade_no: string | null
  alipay_trade_status: string | null
  alipay_success_time: string | null
  paid_amount_cents: number | null
  payment_payload: string | null
  created_at: string
  updated_at: string
  paid_at: string | null
  fulfilled_at: string | null
  cancelled_at: string | null
}

type UsageTokens = {
  inputTokens?: number | null
  outputTokens?: number | null
}

type UsageReservation = {
  entitlement: GatewayEntitlement
  usageEventId: number
  credits: number
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
    const trialExpiresAt = packageExpiresAt('trial', new Date(now))
    this.db
      .query(
        `INSERT INTO devices (
          device_id, device_token, plan, credits_total, credits_remaining,
          expires_at, created_at, updated_at, last_seen_at, app_version, platform
        ) VALUES (?, ?, 'free', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        deviceId,
        token,
        this.config.freeCredits,
        this.config.freeCredits,
        trialExpiresAt,
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
    const activationKind = code.activation_kind || 'subscription'
    const tx = this.db.transaction(() => {
      if (activationKind === 'topup') {
        this.db
          .query(
            `UPDATE devices
             SET credits_total = credits_total + ?,
                 credits_remaining = credits_remaining + ?,
                 license_key = ?,
                 updated_at = ?
             WHERE device_token = ?`,
          )
          .run(code.credits_total, code.credits_total, normalized, now, deviceToken)
      } else {
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
      }
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
    packageId?: GatewayPackageId | null
    activationKind?: 'subscription' | 'topup' | 'trial'
  }): string {
    const licenseKey = input.licenseKey?.trim() || `GUGU-${randomBytes(12).toString('hex').toUpperCase()}`
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO activation_codes (
          license_key, plan, credits_total, expires_at, max_activations,
          activations, created_at, package_id, activation_kind
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        licenseKey,
        input.plan,
        input.creditsTotal,
        input.expiresAt || null,
        input.maxActivations ?? 1,
        now,
        input.packageId || null,
        input.activationKind || 'subscription',
      )
    return licenseKey
  }

  issueActivationCodeForPackage(packageId: GatewayPackageId, input: {
    licenseKey?: string
    expiresAt?: string | null
    maxActivations?: number
  } = {}): string {
    const pkg = getGatewayPackage(packageId)
    if (!pkg) throw new Error(`Unknown package: ${packageId}`)
    return this.issueActivationCode({
      licenseKey: input.licenseKey,
      plan: pkg.plan,
      creditsTotal: pkg.credits,
      expiresAt: input.expiresAt ?? packageExpiresAt(pkg.id),
      maxActivations: input.maxActivations ?? pkg.maxActivations,
      packageId: pkg.id,
      activationKind: pkg.kind,
    })
  }

  disableActivationCode(licenseKey: string): void {
    this.db
      .query('UPDATE activation_codes SET disabled_at = ? WHERE license_key = ?')
      .run(new Date().toISOString(), licenseKey.trim())
  }

  getDeviceSummary(input: { deviceToken?: string; deviceId?: string }): GatewayDeviceSummary | null {
    const row = input.deviceToken
      ? this.db
        .query('SELECT * FROM devices WHERE device_token = ?')
        .get(input.deviceToken.trim()) as DeviceRow | null
      : input.deviceId
        ? this.getDeviceById(input.deviceId)
        : null
    return row ? this.toDeviceSummary(row) : null
  }

  listUsageEvents(input: {
    deviceToken?: string
    deviceId?: string
    limit?: number
    cursor?: number
  } = {}): GatewayUsageEvent[] {
    const limit = normalizeLimit(input.limit)
    const deviceId = input.deviceToken
      ? this.requireDeviceByToken(input.deviceToken).device_id
      : normalizeId(input.deviceId)
    const cursor = normalizeCursor(input.cursor)

    const rows = deviceId
      ? this.db
        .query(
          `SELECT * FROM usage_events
           WHERE device_id = ?
           ${cursor ? 'AND id < ?' : ''}
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(...(cursor ? [deviceId, cursor, limit] : [deviceId, limit])) as UsageEventRow[]
      : this.db
        .query(
          `SELECT * FROM usage_events
           ${cursor ? 'WHERE id < ?' : ''}
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(...(cursor ? [cursor, limit] : [limit])) as UsageEventRow[]

    return rows.map(toUsageEvent)
  }

  listDevices(input: {
    plan?: GatewayPlan | ''
    status?: GatewayEntitlement['status'] | ''
    q?: string
    limit?: number
    cursor?: number
  } = {}): GatewayListResponse<GatewayDeviceSummary> {
    const limit = normalizeLimit(input.limit)
    const cursor = normalizeCursor(input.cursor)
    const filters: string[] = []
    const values: unknown[] = []

    if (cursor) {
      filters.push('rowid < ?')
      values.push(cursor)
    }
    if (input.plan) {
      filters.push('plan = ?')
      values.push(input.plan)
    }
    if (input.q?.trim()) {
      filters.push('(device_id LIKE ? OR app_version LIKE ? OR platform LIKE ? OR license_key LIKE ?)')
      const q = `%${input.q.trim()}%`
      values.push(q, q, q, q)
    }

    const rows = this.db
      .query(
        `SELECT rowid AS __rowid, * FROM devices
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY rowid DESC
         LIMIT ?`,
      )
      .all(...values, limit) as (DeviceRow & { __rowid: number })[]

    const data = rows
      .map((row) => this.toDeviceSummary(row))
      .filter((device) => !input.status || device.entitlement.status === input.status)

    return {
      data,
      pagination: {
        limit,
        nextCursor: rows.length === limit ? rows[rows.length - 1].__rowid : null,
      },
    }
  }

  createOrder(input: { packageId: string; contact?: string | null }): GatewayOrder {
    const pkg = getGatewayPackage(input.packageId)
    if (!pkg || !isPurchasablePackageId(pkg.id)) throw new Error('Package is not available for purchase.')

    const now = new Date().toISOString()
    const orderId = createOrderId()
    const orderToken = createOrderToken()
    const row = this.db
      .query(
        `INSERT INTO orders (
          order_id, package_id, package_name, package_kind, plan, credits,
          amount_cents, currency, status, contact, order_token, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?)
        RETURNING *`,
      )
      .get(
        orderId,
        pkg.id,
        pkg.name,
        pkg.kind,
        pkg.plan,
        pkg.credits,
        pkg.amountCents,
        pkg.currency,
        normalizeContact(input.contact),
        orderToken,
        now,
        now,
      ) as OrderRow

    return toOrder(row)
  }

  getOrderToken(orderId: string): string {
    const order = this.requireOrder(orderId)
    if (!order.order_token) throw new Error('Order token is not available.')
    return order.order_token
  }

  listOrders(input: {
    status?: GatewayOrderStatus | ''
    q?: string
    limit?: number
    cursor?: number
  } = {}): GatewayListResponse<GatewayOrder> {
    const limit = normalizeLimit(input.limit)
    const cursor = normalizeCursor(input.cursor)
    const filters: string[] = []
    const values: unknown[] = []

    if (cursor) {
      filters.push('id < ?')
      values.push(cursor)
    }
    if (input.status) {
      filters.push('status = ?')
      values.push(input.status)
    }
    const q = normalizeSearch(input.q)
    if (q) {
      filters.push('(order_id LIKE ? OR contact LIKE ? OR license_key LIKE ? OR package_name LIKE ?)')
      const like = `%${q}%`
      values.push(like, like, like, like)
    }

    const rows = this.db
      .query(
        `SELECT * FROM orders
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(...values, limit) as OrderRow[]

    return {
      data: rows.map(toOrder),
      pagination: {
        limit,
        nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
      },
    }
  }

  attachOrderPayment(orderId: string, input: {
    provider: GatewayPaymentProvider
    codeUrl: string
    expiresAt: string
    payload?: Record<string, unknown>
  }): GatewayOrder {
    const order = this.requireOrder(orderId)
    if (order.status !== 'pending_payment') return toOrder(order)

    const now = new Date().toISOString()
    const row = this.db
      .query(
        `UPDATE orders
         SET payment_provider = ?,
             payment_code_url = ?,
             payment_expires_at = ?,
             payment_payload = ?,
             updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(
        input.provider,
        input.codeUrl,
        input.expiresAt,
        stringifyPaymentPayload(input.payload),
        now,
        order.order_id,
      ) as OrderRow
    return toOrder(row)
  }

  getOrderStatus(orderId: string, orderToken: string | null | undefined): GatewayOrderStatusResponse {
    const row = this.requireOrder(orderId)
    if (!row.order_token || row.order_token !== orderToken?.trim()) {
      throw new GatewayAuthError('Invalid order token.')
    }
    const order = toOrder(row)
    return {
      order,
      licenseKey: order.status === 'fulfilled' ? order.licenseKey : null,
    }
  }

  completeWechatPayment(input: {
    orderId: string
    transactionId: string
    tradeState: string
    successTime: string | null
    amountCents: number
    payload: Record<string, unknown>
  }): GatewayOrder {
    const order = this.requireOrder(input.orderId)
    if (order.status === 'cancelled') throw new Error('Order has been cancelled.')
    if (input.tradeState !== 'SUCCESS') throw new Error(`Unsupported WeChat trade state: ${input.tradeState}`)
    if (order.amount_cents !== input.amountCents) throw new Error('WeChat paid amount does not match the order amount.')

    const now = new Date().toISOString()
    const paidAt = input.successTime || now
    const row = this.db
      .query(
        `UPDATE orders
         SET status = CASE WHEN status = 'fulfilled' THEN status ELSE 'paid' END,
             payment_provider = 'wechat',
             wechat_transaction_id = COALESCE(wechat_transaction_id, ?),
             wechat_trade_state = ?,
             wechat_success_time = COALESCE(wechat_success_time, ?),
             paid_amount_cents = COALESCE(paid_amount_cents, ?),
             payment_payload = ?,
             paid_at = COALESCE(paid_at, ?),
             updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(
        normalizeTransactionId(input.transactionId),
        input.tradeState,
        input.successTime,
        input.amountCents,
        stringifyPaymentPayload(input.payload),
        paidAt,
        now,
        order.order_id,
      ) as OrderRow

    if (row.status === 'fulfilled') return toOrder(row)
    return this.fulfillOrder(order.order_id)
  }

  completeAlipayPayment(input: {
    orderId: string
    transactionId: string
    tradeState: string
    successTime: string | null
    amountCents: number
    payload: Record<string, unknown>
  }): GatewayOrder {
    const order = this.requireOrder(input.orderId)
    if (order.status === 'cancelled') throw new Error('Order has been cancelled.')
    if (input.tradeState !== 'TRADE_SUCCESS' && input.tradeState !== 'TRADE_FINISHED') {
      throw new Error(`Unsupported Alipay trade status: ${input.tradeState}`)
    }
    if (order.amount_cents !== input.amountCents) throw new Error('Alipay paid amount does not match the order amount.')

    const now = new Date().toISOString()
    const paidAt = input.successTime || now
    const row = this.db
      .query(
        `UPDATE orders
         SET status = CASE WHEN status = 'fulfilled' THEN status ELSE 'paid' END,
             payment_provider = 'alipay',
             alipay_trade_no = COALESCE(alipay_trade_no, ?),
             alipay_trade_status = ?,
             alipay_success_time = COALESCE(alipay_success_time, ?),
             paid_amount_cents = COALESCE(paid_amount_cents, ?),
             payment_payload = ?,
             paid_at = COALESCE(paid_at, ?),
             updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(
        normalizeTransactionId(input.transactionId),
        input.tradeState,
        input.successTime,
        input.amountCents,
        stringifyPaymentPayload(input.payload),
        paidAt,
        now,
        order.order_id,
      ) as OrderRow

    if (row.status === 'fulfilled') return toOrder(row)
    return this.fulfillOrder(order.order_id)
  }

  markOrderPaid(orderId: string): GatewayOrder {
    const order = this.requireOrder(orderId)
    if (order.status === 'cancelled') throw new Error('Order has been cancelled.')
    if (order.status === 'fulfilled') return toOrder(order)
    if (order.status === 'paid') return toOrder(order)

    const now = new Date().toISOString()
    const row = this.db
      .query(
        `UPDATE orders
         SET status = 'paid', paid_at = COALESCE(paid_at, ?), updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(now, now, order.order_id) as OrderRow
    return toOrder(row)
  }

  fulfillOrder(orderId: string): GatewayOrder {
    const order = this.requireOrder(orderId)
    if (order.status === 'cancelled') throw new Error('Order has been cancelled.')
    if (order.status === 'fulfilled') return toOrder(order)

    const pkg = getGatewayPackage(order.package_id)
    if (!pkg) throw new Error(`Unknown package: ${order.package_id}`)

    const now = new Date().toISOString()
    const paidAt = order.paid_at || now
    const licenseKey = order.license_key || this.issueActivationCodeForPackage(pkg.id)
    const row = this.db
      .query(
        `UPDATE orders
         SET status = 'fulfilled',
             license_key = ?,
             paid_at = COALESCE(paid_at, ?),
             fulfilled_at = COALESCE(fulfilled_at, ?),
             updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(licenseKey, paidAt, now, now, order.order_id) as OrderRow
    return toOrder(row)
  }

  cancelOrder(orderId: string): GatewayOrder {
    const order = this.requireOrder(orderId)
    if (order.status === 'fulfilled') throw new Error('Fulfilled orders cannot be cancelled.')
    if (order.status === 'cancelled') return toOrder(order)

    const now = new Date().toISOString()
    const row = this.db
      .query(
        `UPDATE orders
         SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?), updated_at = ?
         WHERE order_id = ?
         RETURNING *`,
      )
      .get(now, now, order.order_id) as OrderRow
    return toOrder(row)
  }

  getDashboardSummary(range: '7d' | '30d' | 'all' = '7d'): GatewayDashboardSummary {
    const since = rangeToSince(range)
    const rangeFilter = since ? 'WHERE created_at >= ?' : ''
    const rangeValues = since ? [since] : []
    const generatedAt = new Date().toISOString()
    const devicesTotal = scalar(this.db.query('SELECT COUNT(*) AS value FROM devices').get())
    const active7d = scalar(this.db.query('SELECT COUNT(*) AS value FROM devices WHERE last_seen_at >= ?').get(daysAgo(7)))
    const active30d = scalar(this.db.query('SELECT COUNT(*) AS value FROM devices WHERE last_seen_at >= ?').get(daysAgo(30)))
    const creditRow = this.db
      .query('SELECT COALESCE(SUM(credits_total), 0) AS total, COALESCE(SUM(credits_remaining), 0) AS remaining FROM devices')
      .get() as { total: number; remaining: number }
    const usageRow = this.db
      .query(
        `SELECT COUNT(*) AS events,
                COALESCE(SUM(credits), 0) AS credits,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_events ${rangeFilter}`,
      )
      .get(...rangeValues) as { events: number; credits: number; inputTokens: number; outputTokens: number }

    const byPlan = this.db
      .query('SELECT plan, COUNT(*) AS count FROM devices GROUP BY plan ORDER BY count DESC')
      .all() as Array<{ plan: GatewayPlan; count: number }>
    const byKind = this.db
      .query(
        `SELECT kind,
                COUNT(*) AS events,
                COALESCE(SUM(credits), 0) AS credits,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_events ${rangeFilter}
         GROUP BY kind
         ORDER BY credits DESC`,
      )
      .all(...rangeValues) as GatewayDashboardSummary['usage']['byKind']
    const byModel = this.db
      .query(
        `SELECT model,
                COUNT(*) AS events,
                COALESCE(SUM(credits), 0) AS credits,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_events ${rangeFilter}
         GROUP BY model
         ORDER BY credits DESC
         LIMIT 20`,
      )
      .all(...rangeValues) as GatewayDashboardSummary['usage']['byModel']
    const daily = this.db
      .query(
        `SELECT substr(created_at, 1, 10) AS date,
                COUNT(*) AS events,
                COALESCE(SUM(credits), 0) AS credits,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM usage_events ${rangeFilter}
         GROUP BY date
         ORDER BY date DESC
         LIMIT 30`,
      )
      .all(...rangeValues) as GatewayDashboardSummary['usage']['daily']
    const topDevices = this.db
      .query(
        `SELECT d.device_id AS deviceId,
                d.plan AS plan,
                d.last_seen_at AS lastSeenAt,
                COALESCE(SUM(u.credits), 0) AS credits,
                COALESCE(SUM(u.input_tokens), 0) AS inputTokens,
                COALESCE(SUM(u.output_tokens), 0) AS outputTokens
         FROM usage_events u
         JOIN devices d ON d.device_id = u.device_id
         ${since ? 'WHERE u.created_at >= ?' : ''}
         GROUP BY d.device_id
         ORDER BY credits DESC
         LIMIT 10`,
      )
      .all(...rangeValues) as GatewayDashboardSummary['usage']['topDevices']
    const recentOrders = this.listOrders({ limit: 10 }).data

    return {
      range,
      generatedAt,
      devices: {
        total: devicesTotal,
        active7d,
        active30d,
        byPlan,
      },
      credits: {
        total: creditRow.total,
        remaining: creditRow.remaining,
        used: Math.max(0, creditRow.total - creditRow.remaining),
        estimatedRemainingTokens: this.config.dashboardTokenPerCredit
          ? creditRow.remaining * this.config.dashboardTokenPerCredit
          : null,
      },
      usage: {
        events: usageRow.events,
        credits: usageRow.credits,
        inputTokens: usageRow.inputTokens,
        outputTokens: usageRow.outputTokens,
        byKind,
        byModel,
        daily,
        topDevices,
      },
      orders: {
        pending: countOrdersByStatus(this.db, 'pending_payment'),
        paid: countOrdersByStatus(this.db, 'paid'),
        fulfilled: countOrdersByStatus(this.db, 'fulfilled'),
        cancelled: countOrdersByStatus(this.db, 'cancelled'),
        recent: recentOrders,
      },
    }
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

  setDeviceCreditsByDeviceId(deviceId: string, creditsRemaining: number, creditsTotal?: number): GatewayEntitlement {
    const device = this.getDeviceById(deviceId)
    if (!device) {
      throw new GatewayAuthError('Device id is invalid.')
    }
    return this.setDeviceCredits(device.device_token, creditsRemaining, creditsTotal)
  }

  consumeCredit(
    deviceToken: string,
    kind: string,
    model: string,
    credits = 1,
  ): GatewayEntitlement {
    return this.consumeUsage(deviceToken, kind, model, credits).entitlement
  }

  consumeUsage(
    deviceToken: string,
    kind: string,
    model: string,
    credits = 1,
    metadata?: Record<string, unknown>,
  ): UsageReservation {
    const now = new Date().toISOString()
    const creditCost = normalizeCreditCost(credits)
    const tx = this.db.transaction(() => {
      const device = this.requireDeviceByToken(deviceToken)
      const entitlement = this.toEntitlement(device)
      if (entitlement.status !== 'active') {
        throw new GatewayQuotaError(entitlement.message, entitlement)
      }

      const result = this.db
        .query(
          `UPDATE devices
           SET credits_remaining = credits_remaining - ?,
               updated_at = ?, last_seen_at = ?
           WHERE device_token = ? AND credits_remaining >= ?`,
        )
        .run(creditCost, now, now, deviceToken, creditCost)

      if (result.changes !== 1) {
        const exhausted = this.toEntitlement(this.requireDeviceByToken(deviceToken))
        throw new GatewayQuotaError(exhausted.message, exhausted)
      }

      const event = this.db
        .query(
          `INSERT INTO usage_events (
            device_id, kind, model, credits, created_at, metadata
          ) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          device.device_id,
          kind,
          model,
          creditCost,
          now,
          metadata ? JSON.stringify(metadata) : null,
        ) as { id: number }

      return {
        entitlement: this.toEntitlement(this.requireDeviceByToken(deviceToken)),
        usageEventId: event.id,
        credits: creditCost,
      }
    })
    return tx()
  }

  recordUsageTokens(usageEventId: number, tokens: UsageTokens, metadata?: Record<string, unknown>): void {
    const event = this.db
      .query('SELECT * FROM usage_events WHERE id = ?')
      .get(usageEventId) as UsageEventRow | null
    if (!event) return

    const inputTokens = normalizeNullableToken(tokens.inputTokens)
    const outputTokens = normalizeNullableToken(tokens.outputTokens)
    const mergedMetadata = {
      ...parseMetadata(event.metadata),
      ...(metadata ?? {}),
    }

    this.db
      .query(
        `UPDATE usage_events
         SET input_tokens = COALESCE(?, input_tokens),
             output_tokens = COALESCE(?, output_tokens),
             metadata = ?
         WHERE id = ?`,
      )
      .run(
        inputTokens,
        outputTokens,
        Object.keys(mergedMetadata).length ? JSON.stringify(mergedMetadata) : null,
        usageEventId,
      )
  }

  refundCredit(deviceToken: string, credits = 1): GatewayEntitlement {
    const now = new Date().toISOString()
    const creditCost = normalizeCreditCost(credits)
    this.db
      .query(
        `UPDATE devices
         SET credits_remaining = MIN(credits_total, credits_remaining + ?),
             updated_at = ?
         WHERE device_token = ?`,
      )
      .run(creditCost, now, deviceToken)
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
        created_at TEXT NOT NULL,
        package_id TEXT,
        activation_kind TEXT NOT NULL DEFAULT 'subscription'
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

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL UNIQUE,
        package_id TEXT NOT NULL,
        package_name TEXT NOT NULL,
        package_kind TEXT NOT NULL,
        plan TEXT NOT NULL,
        credits INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        status TEXT NOT NULL,
        contact TEXT,
        license_key TEXT,
        order_token TEXT,
        payment_provider TEXT,
        payment_code_url TEXT,
        payment_expires_at TEXT,
        wechat_transaction_id TEXT,
        wechat_trade_state TEXT,
        wechat_success_time TEXT,
        alipay_trade_no TEXT,
        alipay_trade_status TEXT,
        alipay_success_time TEXT,
        paid_amount_cents INTEGER,
        payment_payload TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT,
        fulfilled_at TEXT,
        cancelled_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_usage_events_device_id ON usage_events(device_id);
      CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_events_model ON usage_events(model);
      CREATE INDEX IF NOT EXISTS idx_usage_events_kind ON usage_events(kind);
      CREATE INDEX IF NOT EXISTS idx_devices_plan ON devices(plan);
      CREATE INDEX IF NOT EXISTS idx_devices_last_seen_at ON devices(last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
    `)

    this.ensureColumn('activation_codes', 'package_id', 'package_id TEXT')
    this.ensureColumn(
      'activation_codes',
      'activation_kind',
      "activation_kind TEXT NOT NULL DEFAULT 'subscription'",
    )
    this.ensureColumn('usage_events', 'input_tokens', 'input_tokens INTEGER')
    this.ensureColumn('usage_events', 'output_tokens', 'output_tokens INTEGER')
    this.ensureColumn('usage_events', 'metadata', 'metadata TEXT')
    this.ensureColumn('orders', 'order_token', 'order_token TEXT')
    this.ensureColumn('orders', 'payment_provider', 'payment_provider TEXT')
    this.ensureColumn('orders', 'payment_code_url', 'payment_code_url TEXT')
    this.ensureColumn('orders', 'payment_expires_at', 'payment_expires_at TEXT')
    this.ensureColumn('orders', 'wechat_transaction_id', 'wechat_transaction_id TEXT')
    this.ensureColumn('orders', 'wechat_trade_state', 'wechat_trade_state TEXT')
    this.ensureColumn('orders', 'wechat_success_time', 'wechat_success_time TEXT')
    this.ensureColumn('orders', 'alipay_trade_no', 'alipay_trade_no TEXT')
    this.ensureColumn('orders', 'alipay_trade_status', 'alipay_trade_status TEXT')
    this.ensureColumn('orders', 'alipay_success_time', 'alipay_success_time TEXT')
    this.ensureColumn('orders', 'paid_amount_cents', 'paid_amount_cents INTEGER')
    this.ensureColumn('orders', 'payment_payload', 'payment_payload TEXT')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_orders_order_token ON orders(order_token)')
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (columns.some((item) => item.name === column)) return
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
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

  private requireOrder(orderId: string): OrderRow {
    const normalized = orderId.trim()
    if (!normalized) throw new Error('orderId is required')
    const row = this.db
      .query('SELECT * FROM orders WHERE order_id = ?')
      .get(normalized) as OrderRow | null
    if (!row) throw new Error('Order not found.')
    return row
  }

  private toEntitlement(row: DeviceRow): GatewayEntitlement {
    const expiresAt = row.expires_at || (row.plan === 'free' ? packageExpiresAt('trial', new Date(row.created_at)) : null)
    const expired = Boolean(expiresAt && Date.parse(expiresAt) < Date.now())
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
      expiresAt,
      creditsTotal: row.credits_total,
      creditsRemaining: Math.max(0, row.credits_remaining),
      isTrial: row.plan === 'free',
      purchaseUrl: this.config.purchaseUrl,
      message: getEntitlementMessage(status),
      ...(reason ? { reason } : {}),
    }
  }

  private toDeviceSummary(row: DeviceRow): GatewayDeviceSummary {
    return {
      deviceId: row.device_id,
      deviceToken: row.device_token,
      plan: row.plan,
      licenseKey: row.license_key,
      appVersion: row.app_version,
      platform: row.platform,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at,
      entitlement: this.toEntitlement(row),
    }
  }
}

function normalizeCreditCost(credits: number): number {
  return Number.isFinite(credits) && credits > 0 ? Math.max(1, Math.trunc(credits)) : 1
}

function createDeviceToken(): string {
  return `gugu_${randomUUID()}_${randomBytes(16).toString('hex')}`
}

function normalizeId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.length <= 128 ? trimmed : trimmed.slice(0, 128)
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.min(500, Math.max(1, Math.trunc(value)))
}

function normalizeCursor(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.trunc(value)
}

function normalizeContact(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.length <= 256 ? trimmed : trimmed.slice(0, 256)
}

function normalizeSearch(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.length <= 128 ? trimmed : trimmed.slice(0, 128)
}

function createOrderId(): string {
  const date = new Date()
  const ymd = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('')
  return `GUGU-${ymd}-${randomBytes(4).toString('hex').toUpperCase()}`
}

function createOrderToken(): string {
  return `ord_${randomBytes(24).toString('base64url')}`
}

function normalizeTransactionId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length <= 64 ? trimmed : trimmed.slice(0, 64)
}

function stringifyPaymentPayload(value: Record<string, unknown> | undefined): string | null {
  if (!value) return null
  return JSON.stringify(value).slice(0, 4096)
}

function toOrder(row: OrderRow): GatewayOrder {
  return {
    id: row.id,
    orderId: row.order_id,
    packageId: row.package_id,
    packageName: row.package_name,
    kind: row.package_kind,
    plan: row.plan,
    credits: row.credits,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    contact: row.contact,
    licenseKey: row.license_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
    fulfilledAt: row.fulfilled_at,
    cancelledAt: row.cancelled_at,
    paymentProvider: row.payment_provider,
    paymentCodeUrl: row.payment_code_url,
    paymentExpiresAt: row.payment_expires_at,
    wechatTransactionId: row.wechat_transaction_id,
    wechatTradeState: row.wechat_trade_state,
    wechatSuccessTime: row.wechat_success_time,
    alipayTradeNo: row.alipay_trade_no,
    alipayTradeStatus: row.alipay_trade_status,
    alipaySuccessTime: row.alipay_success_time,
    paidAmountCents: row.paid_amount_cents,
    paymentPayload: row.payment_payload,
  }
}

function rangeToSince(range: '7d' | '30d' | 'all'): string | null {
  if (range === '7d') return daysAgo(7)
  if (range === '30d') return daysAgo(30)
  return null
}

function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function scalar(row: unknown): number {
  const value = (row as { value?: unknown } | null)?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function countOrdersByStatus(db: Database, status: GatewayOrderStatus): number {
  return scalar(db.query('SELECT COUNT(*) AS value FROM orders WHERE status = ?').get(status))
}

function normalizeNullableToken(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function toUsageEvent(row: UsageEventRow): GatewayUsageEvent {
  return {
    id: row.id,
    deviceId: row.device_id,
    kind: row.kind,
    model: row.model,
    credits: row.credits,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
    metadata: row.metadata,
  }
}

function getEntitlementMessage(status: GatewayEntitlement['status']): string {
  if (status === 'quota_exhausted') {
    return '额度已用完，请购买套餐或输入激活码继续使用。'
  }
  if (status === 'expired') {
    return '套餐已到期，请购买续费套餐或输入新的激活码。'
  }
  if (status === 'inactive') {
    return '订阅未激活。'
  }
  return '订阅状态正常。'
}

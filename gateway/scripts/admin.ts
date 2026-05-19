import { loadGatewayConfig } from '../src/config.js'
import { getGatewayPackage } from '../src/packages.js'
import { GatewayStore } from '../src/store.js'
import type { GatewayOrderStatus, GatewayPackageId, GatewayPlan } from '../src/types.js'

const store = new GatewayStore(loadGatewayConfig())
const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'issue') {
    const maxActivations = Number.parseInt(readArg('--max-activations', '1'), 10)
    const packageId = readArg('--package', '') as GatewayPackageId | ''
    if (packageId) {
      const pkg = getGatewayPackage(packageId)
      if (!pkg) throw new Error(`Unknown package: ${packageId}`)
      const licenseKey = store.issueActivationCodeForPackage(packageId, {
        maxActivations,
        licenseKey: readArg('--license', ''),
        expiresAt: readArg('--expires', '') || undefined,
      })
      console.log(JSON.stringify({
        licenseKey,
        packageId,
        plan: pkg.plan,
        creditsTotal: pkg.credits,
        expiresAt: readArg('--expires', '') || null,
        maxActivations,
      }, null, 2))
    } else {
      const plan = readArg('--plan', 'pro') as GatewayPlan
      const creditsTotal = Number.parseInt(readArg('--credits', '1000'), 10)
      const expiresAt = readArg('--expires', '') || null
      const licenseKey = store.issueActivationCode({
        plan,
        creditsTotal,
        expiresAt,
        maxActivations,
        licenseKey: readArg('--license', ''),
      })
      console.log(JSON.stringify({ licenseKey, plan, creditsTotal, expiresAt, maxActivations }, null, 2))
    }
  } else if (command === 'disable') {
    const licenseKey = args[0]
    if (!licenseKey) usage('disable <licenseKey>')
    store.disableActivationCode(licenseKey!)
    console.log(JSON.stringify({ ok: true, licenseKey }, null, 2))
  } else if (command === 'device') {
    const deviceToken = readArg('--device-token', '')
    const deviceId = readArg('--device-id', '')
    if (!deviceToken && !deviceId) usage('device --device-token <token> | --device-id <id>')
    const device = store.getDeviceSummary({ deviceToken, deviceId })
    if (!device) throw new Error('Device not found.')
    console.log(JSON.stringify(device, null, 2))
  } else if (command === 'usage') {
    const events = store.listUsageEvents({
      deviceToken: readArg('--device-token', ''),
      deviceId: readArg('--device-id', ''),
      limit: readPositiveIntArg('--limit', 50),
    })
    console.log(JSON.stringify({ events }, null, 2))
  } else if (command === 'set-credits') {
    const deviceToken = readArg('--device-token', '')
    const deviceId = readArg('--device-id', '')
    const remaining = Number.parseInt(readArg('--remaining', ''), 10)
    const totalRaw = readArg('--total', '')
    if ((!deviceToken && !deviceId) || !Number.isFinite(remaining)) {
      usage('set-credits --device-token <token> | --device-id <id> --remaining <n> [--total <n>]')
    }
    const total = totalRaw ? Number.parseInt(totalRaw, 10) : undefined
    const entitlement = deviceToken
      ? store.setDeviceCredits(deviceToken, remaining, total)
      : store.setDeviceCreditsByDeviceId(deviceId, remaining, total)
    console.log(JSON.stringify(entitlement, null, 2))
  } else if (command === 'summary') {
    const range = readArg('--range', '7d')
    console.log(JSON.stringify(store.getDashboardSummary(range === '30d' || range === 'all' ? range : '7d'), null, 2))
  } else if (command === 'orders') {
    const status = readArg('--status', '') as GatewayOrderStatus | ''
    const orders = store.listOrders({
      status,
      limit: readPositiveIntArg('--limit', 50),
      cursor: readPositiveIntArg('--cursor', 0) || undefined,
    })
    console.log(JSON.stringify(orders, null, 2))
  } else if (command === 'pay-order') {
    const orderId = args[0]
    if (!orderId) usage('pay-order <orderId>')
    console.log(JSON.stringify({ order: store.markOrderPaid(orderId!) }, null, 2))
  } else if (command === 'fulfill-order') {
    const orderId = args[0]
    if (!orderId) usage('fulfill-order <orderId>')
    console.log(JSON.stringify({ order: store.fulfillOrder(orderId!) }, null, 2))
  } else if (command === 'cancel-order') {
    const orderId = args[0]
    if (!orderId) usage('cancel-order <orderId>')
    console.log(JSON.stringify({ order: store.cancelOrder(orderId!) }, null, 2))
  } else {
    usage()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  store.close()
}

function readArg(name: string, fallback: string): string {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function readPositiveIntArg(name: string, fallback: number): number {
  const value = Number.parseInt(readArg(name, String(fallback)), 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(500, Math.trunc(value))
}

function usage(detail?: string): never {
  if (detail) console.error(`Usage: bun run scripts/admin.ts ${detail}`)
  else {
    console.error([
      'Usage:',
      '  bun run scripts/admin.ts issue --plan pro --credits 1000 [--expires 2099-01-01T00:00:00.000Z] [--max-activations 1]',
      '  bun run scripts/admin.ts issue --package pro-monthly [--max-activations 1]',
      '  bun run scripts/admin.ts disable <licenseKey>',
      '  bun run scripts/admin.ts device --device-token <token> | --device-id <id>',
      '  bun run scripts/admin.ts usage [--device-token <token> | --device-id <id>] [--limit 50]',
      '  bun run scripts/admin.ts summary [--range 7d|30d|all]',
      '  bun run scripts/admin.ts orders [--status pending_payment|paid|fulfilled|cancelled] [--limit 50]',
      '  bun run scripts/admin.ts pay-order <orderId>',
      '  bun run scripts/admin.ts fulfill-order <orderId>',
      '  bun run scripts/admin.ts cancel-order <orderId>',
      '  bun run scripts/admin.ts set-credits --device-token <token> | --device-id <id> --remaining <n> [--total <n>]',
    ].join('\n'))
  }
  process.exit(2)
}

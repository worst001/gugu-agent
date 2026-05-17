import { loadGatewayConfig } from '../src/config.js'
import { GatewayStore } from '../src/store.js'
import type { GatewayPlan } from '../src/types.js'

const store = new GatewayStore(loadGatewayConfig())
const [command, ...args] = process.argv.slice(2)

try {
  if (command === 'issue') {
    const plan = readArg('--plan', 'pro') as GatewayPlan
    const creditsTotal = Number.parseInt(readArg('--credits', '1000'), 10)
    const expiresAt = readArg('--expires', '') || null
    const maxActivations = Number.parseInt(readArg('--max-activations', '1'), 10)
    const licenseKey = store.issueActivationCode({
      plan,
      creditsTotal,
      expiresAt,
      maxActivations,
      licenseKey: readArg('--license', ''),
    })
    console.log(JSON.stringify({ licenseKey, plan, creditsTotal, expiresAt, maxActivations }, null, 2))
  } else if (command === 'disable') {
    const licenseKey = args[0]
    if (!licenseKey) usage('disable <licenseKey>')
    store.disableActivationCode(licenseKey!)
    console.log(JSON.stringify({ ok: true, licenseKey }, null, 2))
  } else if (command === 'set-credits') {
    const deviceToken = readArg('--device-token', '')
    const remaining = Number.parseInt(readArg('--remaining', ''), 10)
    const totalRaw = readArg('--total', '')
    if (!deviceToken || !Number.isFinite(remaining)) usage('set-credits --device-token <token> --remaining <n> [--total <n>]')
    const entitlement = store.setDeviceCredits(
      deviceToken,
      remaining,
      totalRaw ? Number.parseInt(totalRaw, 10) : undefined,
    )
    console.log(JSON.stringify(entitlement, null, 2))
  } else {
    usage()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

function readArg(name: string, fallback: string): string {
  const index = args.indexOf(name)
  if (index === -1) return fallback
  return args[index + 1] ?? fallback
}

function usage(detail?: string): never {
  if (detail) console.error(`Usage: bun run scripts/admin.ts ${detail}`)
  else {
    console.error([
      'Usage:',
      '  bun run scripts/admin.ts issue --plan pro --credits 1000 [--expires 2099-01-01T00:00:00.000Z] [--max-activations 1]',
      '  bun run scripts/admin.ts disable <licenseKey>',
      '  bun run scripts/admin.ts set-credits --device-token <token> --remaining <n> [--total <n>]',
    ].join('\n'))
  }
  process.exit(2)
}

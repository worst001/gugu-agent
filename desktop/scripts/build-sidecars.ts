import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const adaptersRoot = path.join(repoRoot, 'adapters')
const binariesDir = path.join(desktopRoot, 'src-tauri', 'binaries')
const generatedAdaptersModule = path.join(
  desktopRoot,
  'sidecars',
  '.generated',
  'bundledAdapters.generated.ts',
)
const optionalAdapterPackages = {
  feishu: '@larksuiteoapi/node-sdk',
  telegram: 'grammy',
  dingtalk: 'dingtalk-stream',
  qq: 'qq-official-bot',
} as const
const optionalAdapterImports = {
  feishu: {
    label: 'Feishu',
    importPath: '../../../adapters/feishu/index.ts',
  },
  telegram: {
    label: 'Telegram',
    importPath: '../../../adapters/telegram/index.ts',
  },
  dingtalk: {
    label: 'DingTalk',
    importPath: '../../../adapters/dingtalk/index.ts',
  },
  qq: {
    label: 'QQ',
    importPath: '../../../adapters/qq/index.ts',
  },
} satisfies Record<keyof typeof optionalAdapterPackages, { label: string; importPath: string }>

const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple())

const bunTarget = mapTargetTripleToBun(targetTriple)

// 编译前先扫一遍 src/ 把所有缺失的 ant-internal 模块在磁盘上 stub 出来。
// 见 desktop/scripts/scan-missing-imports.ts。
console.log('[build-sidecars] scanning for missing imports...')
const scanProc = Bun.spawn(
  ['bun', 'run', path.join(desktopRoot, 'scripts/scan-missing-imports.ts')],
  { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' },
)
const scanExit = await scanProc.exited
if (scanExit !== 0) {
  throw new Error(`[build-sidecars] scan-missing-imports failed (exit ${scanExit})`)
}

await mkdir(binariesDir, { recursive: true })

// 单一合并 sidecar：server / cli 共享一份 bun runtime + 共享依赖代码。
// 调用方（Tauri lib.rs / conversationService）通过第一个 positional 参数
// 选择 'server' 或 'cli' 模式，详见 desktop/sidecars/claude-sidecar.ts。
await compileExecutable({
  entrypoint: path.join(desktopRoot, 'sidecars/claude-sidecar.ts'),
  outfileBase: path.join(binariesDir, `claude-sidecar-${targetTriple}`),
  productName: 'Claude Code Sidecar',
  bunTarget,
})

console.log(`[build-sidecars] Built desktop sidecar for ${targetTriple} (${bunTarget})`)

async function detectHostTriple() {
  const proc = Bun.spawn(['rustc', '-vV'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`[build-sidecars] rustc -vV failed: ${stderr || stdout}`)
  }

  const hostLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host: '))

  if (!hostLine) {
    throw new Error('[build-sidecars] Could not detect Rust host triple')
  }

  return hostLine.replace('host: ', '')
}

function mapTargetTripleToBun(triple: string) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return 'bun-darwin-arm64'
    case 'x86_64-apple-darwin':
      return 'bun-darwin-x64'
    case 'x86_64-pc-windows-msvc':
      return 'bun-windows-x64'
    case 'aarch64-pc-windows-msvc':
      return 'bun-windows-arm64'
    case 'x86_64-unknown-linux-gnu':
      return 'bun-linux-x64-baseline'
    case 'aarch64-unknown-linux-gnu':
      return 'bun-linux-arm64'
    case 'x86_64-unknown-linux-musl':
      return 'bun-linux-x64-musl'
    case 'aarch64-unknown-linux-musl':
      return 'bun-linux-arm64-musl'
    default:
      throw new Error(`[build-sidecars] Unsupported target triple: ${triple}`)
  }
}

async function compileExecutable({
  entrypoint,
  outfileBase,
  productName,
  bunTarget,
}: {
  entrypoint: string
  outfileBase: string
  productName: string
  bunTarget: string
}) {
  const adapterAvailability = getOptionalAdapterAvailability()
  const missingAdapterPackages = Object.entries(adapterAvailability)
    .filter(([, available]) => !available)
    .map(([adapter]) => adapter)
  if (missingAdapterPackages.length > 0) {
    console.warn(
      `[build-sidecars] optional adapter SDKs not installed; disabling adapters in this build: ${missingAdapterPackages.join(', ')}`,
    )
  }
  await writeBundledAdaptersModule(adapterAvailability)

  const result = await Bun.build({
    entrypoints: [entrypoint],
    // minify whitespace + identifiers + dead-code 大概能省 5-15% 的二进制大小，
    // 代价是 stack trace 里的函数名变成短名 —— 终端用户场景可接受。
    minify: { whitespace: true, identifiers: true, syntax: true },
    sourcemap: 'none',
    target: 'bun',
    // 可选 npm 包：开 telemetry / 用 sharp 图像 / 用 Bedrock/Vertex 等
    // 替代 provider 时才需要，全部不在顶层 package.json 里。标 external
    // 让 bun build 跳过解析；运行时 import 在没装时自然失败，由 try/catch
    // 或 feature() gate 兜底。
    external: [
      // OpenTelemetry exporters（开 OTEL_* env 时才加载）
      '@opentelemetry/exporter-trace-otlp-grpc',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-trace-otlp-proto',
      '@opentelemetry/exporter-logs-otlp-grpc',
      '@opentelemetry/exporter-logs-otlp-http',
      '@opentelemetry/exporter-logs-otlp-proto',
      '@opentelemetry/exporter-metrics-otlp-grpc',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-proto',
      '@opentelemetry/exporter-prometheus',
      // 替代 LLM provider —— 默认不用，用户自装
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-sts',
      '@anthropic-ai/bedrock-sdk',
      '@anthropic-ai/foundry-sdk',
      '@anthropic-ai/vertex-sdk',
      '@azure/identity',
      // ant-internal / 可选工具
      '@anthropic-ai/mcpb',
      'fflate',
      'sharp',
      'react-devtools-core',
    ],
    compile: {
      target: bunTarget,
      outfile: outfileBase,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      windows: {
        title: productName,
        publisher: 'Claude Code',
        description: productName,
        hideConsole: true,
      },
    },
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-sidecars] Failed to compile ${productName}:\n${logs}`)
  }

  const outputPath = result.outputs[0]?.path ?? outfileBase
  console.log(`[build-sidecars] ${productName} -> ${outputPath}`)

  // macOS Apple System Policy (ASP) requires valid code signatures on all
  // executables. Bun-compiled binaries ship with an invalid/empty signature
  // that causes "load code signature error 4" and SIGKILL at launch.
  // Fix: strip the broken signature, then ad-hoc sign.
  if (process.platform === 'darwin') {
    await adHocSignMacBinary(outputPath)
  }
}

function getOptionalAdapterAvailability(): Record<keyof typeof optionalAdapterPackages, boolean> {
  const availability = {} as Record<keyof typeof optionalAdapterPackages, boolean>
  for (const [adapter, packageName] of Object.entries(optionalAdapterPackages)) {
    availability[adapter as keyof typeof optionalAdapterPackages] = canResolvePackage(packageName)
  }
  return availability
}

async function writeBundledAdaptersModule(
  availability: Record<keyof typeof optionalAdapterPackages, boolean>,
): Promise<void> {
  await mkdir(path.dirname(generatedAdaptersModule), { recursive: true })

  const adapterCases = Object.entries(optionalAdapterImports)
    .map(([adapter, spec]) => {
      if (!availability[adapter as keyof typeof optionalAdapterPackages]) {
        return `    case '${adapter}':
      console.warn('[claude-sidecar] --${adapter} requested but ${spec.label} SDK is not bundled in this build - skipping')
      return false`
      }

      return `    case '${adapter}':
      return startAdapter('${spec.label}', () => import('${spec.importPath}'))`
    })
    .join('\n')

  const source = `export type BundledAdapterId = 'feishu' | 'telegram' | 'dingtalk' | 'qq'

export const BUNDLED_ADAPTERS = ${JSON.stringify(availability, null, 2)} as const

export async function startBundledAdapter(adapter: BundledAdapterId): Promise<boolean> {
  switch (adapter) {
${adapterCases}
    default:
      return false
  }
}

async function startAdapter(label: string, importer: () => Promise<unknown>): Promise<boolean> {
  try {
    await importer()
    return true
  } catch (err) {
    console.error(
      \`[claude-sidecar] failed to start \${label} adapter:\`,
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
`

  await writeFile(generatedAdaptersModule, source, 'utf8')
}

function canResolvePackage(packageName: string): boolean {
  const repoRequire = createRequire(path.join(repoRoot, 'package.json'))
  const adaptersRequire = createRequire(path.join(adaptersRoot, 'package.json'))

  try {
    repoRequire.resolve(packageName)
    return true
  } catch {}

  try {
    adaptersRequire.resolve(packageName)
    return true
  } catch {}

  return false
}

async function adHocSignMacBinary(outputPath: string) {
  console.log(`[build-sidecars] ad-hoc signing ${outputPath} for macOS ...`)
  const strip = Bun.spawn(['codesign', '--remove-signature', outputPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await strip.exited

  const sign = Bun.spawn(
    ['codesign', '--sign', '-', '--force', '--timestamp=none', outputPath],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const signExit = await sign.exited
  if (signExit !== 0) {
    throw new Error(`[build-sidecars] ad-hoc codesign failed for ${outputPath} (exit ${signExit})`)
  }
  console.log(`[build-sidecars] ad-hoc signed ${outputPath}`)
}

/**
 * Claude Code 桌面端合并 sidecar 入口。
 *
 * 历史上 server / cli / IM adapters 是各自独立的进程。每个 bun-compile
 * 二进制都要带一份 ~55MB 的 bun runtime，光这一项就重复占了 100MB+。
 * 把所有运行模式合并到同一个二进制里，runtime 只保留一份；调用方通过
 * 第一个 positional 参数选择模式：
 *
 *   gugu-sidecar server   --app-root <path> --host 127.0.0.1 --port 12345
 *   gugu-sidecar cli      --app-root <path> [其它 CLI 参数...]
 *   gugu-sidecar adapters --app-root <path> [--feishu] [--telegram] [--dingtalk] [--wecom] [--qq]
 *
 * 任何模式都必须先做 process.env / process.argv 设置，再 await 进入相应的
 * 子模块树。原因：src/server/index.ts、src/entrypoints/cli.tsx、以及
 * adapters/feishu/index.ts 等顶层都会立即读 process.argv / process.env，
 * 必须在它们求值前 splice 掉 --app-root、mode、--feishu/--telegram 等这些
 * launcher-only 参数。
 */

import { parseLauncherArgs, resolveSidecarInvocation } from './launcherRouting'
import { BUNDLED_ADAPTERS, startBundledAdapter } from './.generated/bundledAdapters.generated.ts'

const rawArgs = process.argv.slice(2)
const invocation = resolveSidecarInvocation(rawArgs)
if (!invocation.mode) {
  console.error('gugu-sidecar: missing mode argument (expected "server", "cli" or "adapters")')
  process.exit(2)
}
const mode = invocation.mode
const restArgs = invocation.restArgs

if (mode === 'adapters') {
  await runAdapters(restArgs)
} else {
  const { appRoot, args } = parseLauncherArgs(restArgs, invocation.defaultAppRoot)

  process.env.CLAUDE_APP_ROOT = appRoot
  process.env.CALLER_DIR ||= process.cwd()
  process.argv = [process.argv[0]!, process.argv[1]!, ...args]

  await import('../../preload.ts')

  if (mode === 'server') {
    const { startServer } = await import('../../src/server/index.ts')
    startServer()
  } else if (mode === 'cli') {
    await import('../../src/entrypoints/cli.tsx')
  } else {
    console.error(`gugu-sidecar: unknown mode "${mode}" (expected "server", "cli" or "adapters")`)
    process.exit(2)
  }
}

async function runAdapters(rawArgs: string[]): Promise<void> {
  // adapters 模式的参数解析独立于 server/cli —— 这里只接受 IM adapter
  // 选择参数，再加可选的 --app-root（透传给
  // adapters/common/config.ts 内的 process.env 读取）。
  let appRoot: string | null = process.env.CLAUDE_APP_ROOT ?? null
  let enableFeishu = false
  let enableTelegram = false
  let enableDingtalk = false
  let enableWecom = false
  let enableQq = false

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]
    if (arg === '--app-root') {
      appRoot = rawArgs[i + 1] ?? null
      i += 1
      continue
    }
    if (arg === '--feishu') {
      enableFeishu = true
      continue
    }
    if (arg === '--telegram') {
      enableTelegram = true
      continue
    }
    if (arg === '--dingtalk') {
      enableDingtalk = true
      continue
    }
    if (arg === '--wecom') {
      enableWecom = true
      continue
    }
    if (arg === '--qq') {
      enableQq = true
      continue
    }
    console.warn(`gugu-sidecar adapters: ignoring unknown arg "${arg}"`)
  }

  if (!enableFeishu && !enableTelegram && !enableDingtalk && !enableWecom && !enableQq) {
    console.error(
      'gugu-sidecar adapters: must enable at least one IM adapter flag',
    )
    process.exit(2)
  }

  if (appRoot) {
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  process.env.CALLER_DIR ||= process.cwd()

  await import('../../preload.ts')

  // 在 import adapter 之前先用同一份 loadConfig() 检查凭据。adapter 的
  // top-level 代码里已经有 if (!cred) process.exit(1)，但那会把整个
  // 进程拖死 —— 包括另一个本来正常的 adapter。这里提前 gate 一下，
  // 缺凭据的 adapter 直接跳过、不 import。
  const { loadConfig } = await import('../../adapters/common/config.ts')
  const config = loadConfig()

  let started = 0
  let attemptedStart = 0

  if (enableFeishu) {
    if (!BUNDLED_ADAPTERS.feishu) {
      console.warn('[gugu-sidecar] --feishu requested but Feishu SDK is not bundled in this build — skipping')
    } else if (!config.feishu.appId || !config.feishu.appSecret) {
      console.warn(
        '[gugu-sidecar] --feishu requested but FEISHU_APP_ID / FEISHU_APP_SECRET missing in env or ~/.claude/adapters.json — skipping',
      )
    } else {
      console.log('[gugu-sidecar] starting Feishu adapter')
      // 副作用 import：feishu/index.ts 顶层会自动 new WSClient + start()
      attemptedStart += 1
      if (await startBundledAdapter('feishu')) {
        started += 1
      }
    }
  }

  if (enableTelegram) {
    if (!BUNDLED_ADAPTERS.telegram) {
      console.warn('[gugu-sidecar] --telegram requested but Telegram SDK is not bundled in this build — skipping')
    } else if (!config.telegram.botToken) {
      console.warn(
        '[gugu-sidecar] --telegram requested but TELEGRAM_BOT_TOKEN missing in env or ~/.claude/adapters.json — skipping',
      )
    } else {
      console.log('[gugu-sidecar] starting Telegram adapter')
      // 副作用 import：telegram/index.ts 顶层会自动 bot.start()
      attemptedStart += 1
      if (await startBundledAdapter('telegram')) {
        started += 1
      }
    }
  }

  if (enableDingtalk) {
    const hasAppCredentials = Boolean(config.dingtalk.clientId && config.dingtalk.clientSecret)
    if (!BUNDLED_ADAPTERS.dingtalk) {
      console.warn('[gugu-sidecar] --dingtalk requested but DingTalk SDK is not bundled in this build — skipping')
    } else if (!hasAppCredentials) {
      console.warn(
        '[gugu-sidecar] --dingtalk requested but DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET missing in env or ~/.claude/adapters.json — skipping',
      )
    } else {
      console.log('[gugu-sidecar] starting DingTalk adapter')
      attemptedStart += 1
      if (await startBundledAdapter('dingtalk')) {
        started += 1
      }
    }
  }

  if (enableWecom) {
    const hasAppCredentials = Boolean(
      config.wecom.corpId
      && config.wecom.agentId
      && config.wecom.secret
      && config.wecom.token
      && config.wecom.encodingAesKey,
    )
    if (!hasAppCredentials) {
      console.warn(
        '[gugu-sidecar] --wecom requested but WECOM_CORP_ID / WECOM_AGENT_ID / WECOM_SECRET / WECOM_TOKEN / WECOM_ENCODING_AES_KEY missing in env or ~/.claude/adapters.json — skipping',
      )
    } else {
      console.log('[gugu-sidecar] starting WeCom adapter')
      attemptedStart += 1
      try {
        await import('../../adapters/wecom/index.ts')
        started += 1
      } catch (err) {
        console.error(
          '[gugu-sidecar] failed to start WeCom adapter:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  if (enableQq) {
    const hasOfficialBot = Boolean(config.qq.appId && (config.qq.appSecret || config.qq.token))
    const hasOneBotBridge = Boolean(config.qq.oneBotUrl)
    if (!BUNDLED_ADAPTERS.qq) {
      console.warn('[gugu-sidecar] --qq requested but QQ SDK is not bundled in this build — skipping')
    } else if (!hasOfficialBot && !hasOneBotBridge) {
      console.warn(
        '[gugu-sidecar] --qq requested but QQ_APP_ID / QQ_APP_SECRET or QQ_ONEBOT_URL missing in env or ~/.claude/adapters.json — skipping',
      )
    } else {
      console.log('[gugu-sidecar] starting QQ adapter')
      attemptedStart += 1
      if (await startBundledAdapter('qq')) {
        started += 1
      }
    }
  }

  if (started === 0) {
    const message =
      '[gugu-sidecar] no adapter could be started - check credentials in env or ~/.claude/adapters.json'
    if (attemptedStart > 0) {
      console.error(message)
      process.exit(1)
    }
    console.warn(message)
    process.exit(0)
  }

  // 让进程保持存活：两个 adapter 都通过 long-lived WebSocket（Lark WSClient
  // / grammY long-polling）持有 event loop，自然不会退出。这里不需要额外
  // setInterval 兜底。两个 adapter 自己注册的 SIGINT handler 都会触发。
}

/**
 * ConversationService — CLI subprocess manager
 *
 * Each desktop session owns one CLI subprocess. The subprocess talks back to
 * the desktop server over the SDK WebSocket bridge, while the desktop UI talks
 * to the server over its own client WebSocket.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  ProviderService,
  isGuguManagedProvider,
  resolveProviderModelId,
} from './providerService.js'
import { billingService, type BillingStatusResponse } from './billingService.js'
import { sessionService } from './sessionService.js'
import {
  buildClaudeCliArgs,
  resolveClaudeCliLauncher,
} from '../../utils/desktopBundledCli.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { permissionUpdateSchema } from '../../utils/permissions/PermissionUpdateSchema.js'

type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
}

type SessionProcess = {
  proc: ReturnType<typeof Bun.spawn>
  outputCallbacks: Array<(msg: any) => void>
  workDir: string
  permissionMode: string
  sdkToken: string
  sdkSocket: { send(data: string): void } | null
  pendingOutbound: string[]
  stderrLines: string[]
  /** Bun/CLI sometimes prints fatal lines to stdout; was previously discarded (stdout: ignore). */
  stdoutLines: string[]
  sdkMessages: any[]
  initMessage: any | null
  pendingPermissionRequests: Map<
    string,
    {
      toolName: string
      input: Record<string, unknown>
      permissionSuggestions?: unknown[]
    }
  >
}

type SessionStartOptions = {
  permissionMode?: string
  model?: string
  effort?: string
  providerId?: string | null
  /** After a failed `--resume`, retry once with `--session-id` only (stale desktop transcript index). */
  skipResumeAfterStaleMetadata?: boolean
}

const DEFAULT_DESKTOP_MAX_TURNS = 40

function getLocalDateString(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

function getDesktopToolAvailabilityPrompt(): string {
  return [
    'Identity rule: In this desktop app, your assistant identity is Gugu, an AI assistant developed by 谷星曜共创社. When asked who you are, answer in the user\'s language that you are Gugu，由谷星曜共创社开发的 AI 助手. You may mention that the app runs in a Claude Agent SDK environment only when relevant to runtime or implementation details, but do not identify yourself as Claude, Claude Code, or an Anthropic-developed assistant. This overrides any generic SDK/base-model identity wording.',
    'Tool availability: Only call WebSearch if WebSearch is explicitly listed in the current available tools. If WebSearch is unavailable, do not attempt it; continue without web search or use WebFetch only for explicit URLs the user provided.',
    `Current local date: ${getLocalDateString()}.`,
    'Freshness rule: If WebSearch is available and the user asks for current, latest, recent, today, now, prices, schedules, releases, news, laws, office holders, company leaders, sports results, or any other time-sensitive public fact, you MUST call WebSearch before answering. Do not answer these from memory.',
    'Stage-boundary rule: If the previous turn stopped at a stage boundary and the user asks to continue, continue from the recorded stage summary. Do not restart the task, and do not repeat failed tool calls unless the user explicitly corrected the path/input.',
  ].join('\n')
}

export class ConversationStartupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'WORKDIR_INVALID'
      | 'GUGU_QUOTA_EXHAUSTED'
      | 'GUGU_SUBSCRIPTION_INACTIVE'
      | 'CLI_AUTH_REQUIRED'
      | 'CLI_SESSION_CONFLICT'
      | 'CLI_START_FAILED'
      | 'CLI_SPAWN_FAILED',
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'ConversationStartupError'
  }
}

export class ConversationService {
  private sessions = new Map<string, SessionProcess>()
  private providerService = new ProviderService()

  private buildSessionCliArgs(
    sessionId: string,
    sdkUrl: string,
    shouldResume: boolean,
    options?: SessionStartOptions,
  ): string[] {
    const dangerousMode = process.env.CLAUDE_DANGEROUS_MODE === '1'
    return this.resolveCliArgs([
      '--print',
      '--verbose',
      '--sdk-url',
      sdkUrl,
      '--enable-auth-status',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      // Desktop chat depends on partial assistant deltas; without this the
      // server only sees the completed assistant message at turn end.
      '--include-partial-messages',
      ...(shouldResume ? ['--resume', sessionId] : ['--session-id', sessionId]),
      '--replay-user-messages',
      '--append-system-prompt',
      getDesktopToolAvailabilityPrompt(),
      ...this.getMaxTurnsArgs(),
      ...this.getRuntimeArgs(options),
      ...this.getPermissionArgs(options?.permissionMode, dangerousMode),
    ])
  }

  async startSession(
    sessionId: string,
    workDir: string,
    sdkUrl: string,
    options?: SessionStartOptions,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) return

    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    const shouldResume =
      !options?.skipResumeAfterStaleMetadata &&
      !!launchInfo &&
      launchInfo.transcriptMessageCount > 0
    const shouldReplacePlaceholder =
      !!launchInfo && launchInfo.transcriptMessageCount === 0

    if (shouldReplacePlaceholder) {
      await sessionService.deleteSessionFile(sessionId)
    }

    if (!fs.existsSync(workDir) || !fs.statSync(workDir).isDirectory()) {
      throw new ConversationStartupError(
        `Working directory does not exist or is not a directory: ${workDir}`,
        'WORKDIR_INVALID',
      )
    }

    await this.assertGuguManagedBillingCanStart(options)

    const args = this.buildSessionCliArgs(
      sessionId,
      sdkUrl,
      shouldResume,
      options,
    )

    console.log(
      `[ConversationService] Starting CLI for ${sessionId}, cwd: ${workDir} (process.cwd()=${process.cwd()}, CALLER_DIR will be pinned to workDir)`,
    )

    // IMPORTANT (Bug#5): 必须覆盖子进程继承的 CALLER_DIR / PWD。
    // preload.ts 顶层读 process.env.CALLER_DIR 并调用 process.chdir(CALLER_DIR)。
    // 在 bundled 桌面端里，server sidecar 被 Tauri 从 cwd=/ 启动，claude-sidecar.ts
    // 在 server/cli 模式入口把 CALLER_DIR 默认设成 process.cwd()（即 '/'），
    // 随后这个 env 被完整继承到 Bun.spawn 的 CLI 子进程；即使这里显式传了
    // cwd: workDir，CLI 子进程里 preload.ts 还是会 chdir('/')，结果把
    // STATE.cwd / "Primary working directory" 打回根目录，IM 会话里 AI 感知的
    // 工作目录就变成 `/`。把 CALLER_DIR / PWD 显式覆盖成 workDir，preload.ts
    // chdir 后落到正确目录。
    //
    const childEnv = await this.buildChildEnv(workDir, sdkUrl, options)

    let proc: ReturnType<typeof Bun.spawn>
    try {
      proc = Bun.spawn(args, {
        cwd: workDir,
        env: childEnv,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
    } catch (spawnErr) {
      throw new ConversationStartupError(
        `Failed to spawn CLI in ${workDir}: ${
          spawnErr instanceof Error ? spawnErr.message : String(spawnErr)
        }`,
        'CLI_SPAWN_FAILED',
      )
    }

    const session: SessionProcess = {
      proc,
      outputCallbacks: [],
      workDir,
      permissionMode: options?.permissionMode || 'default',
      sdkToken: this.getSdkTokenFromUrl(sdkUrl),
      sdkSocket: null,
      pendingOutbound: [],
      stderrLines: [],
      stdoutLines: [],
      sdkMessages: [],
      initMessage: null,
      pendingPermissionRequests: new Map(),
    }
    this.sessions.set(sessionId, session)

    const stderrDone = this.readErrorStream(sessionId, proc)
    const stdoutDone = this.readStdoutStream(sessionId, proc)

    // Do NOT register proc.exited before the startup grace check: if the CLI
    // exits immediately, handleProcessExit would delete the session while
    // readErrorStream/readStdoutStream still need session.*Lines buffers.

    const STARTUP_GRACE_MS = 3000
    const earlyExitCode = await Promise.race([
      proc.exited,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STARTUP_GRACE_MS),
      ),
    ])

    if (earlyExitCode !== null) {
      // Wait until stderr/stdout pipes close so short-lived crashes still surface
      // their messages (fixed-delay polling was unreliable).
      await Promise.race([
        Promise.all([stderrDone, stdoutDone]),
        new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      ])
      const startupError = this.buildStartupError(sessionId, earlyExitCode, {
        argv: args,
        workDir,
      })
      this.sessions.delete(sessionId)

      if (this.clearStaleLock(sessionId)) {
        console.log(
          `[ConversationService] Removed stale lock for ${sessionId}, retrying...`,
        )
        return this.startSession(sessionId, workDir, sdkUrl, options)
      }

      console.error(
        `[ConversationService] CLI exited with code ${earlyExitCode} for ${sessionId}: ${startupError.message}`,
      )

      if (
        startupError.code === 'CLI_START_FAILED' &&
        startupError.message.includes('No conversation found with session ID') &&
        shouldResume &&
        !options?.skipResumeAfterStaleMetadata
      ) {
        console.warn(
          `[ConversationService] Resume failed for ${sessionId} (CLI transcript missing); retrying without --resume`,
        )
        return this.startSession(sessionId, workDir, sdkUrl, {
          ...options,
          skipResumeAfterStaleMetadata: true,
        })
      }

      throw startupError
    }

    proc.exited.then((code) => {
      this.handleProcessExit(sessionId, proc, code)
    })

    if (shouldReplacePlaceholder || !launchInfo) {
      await sessionService.appendSessionMetadata(sessionId, {
        workDir,
        customTitle: launchInfo?.customTitle ?? null,
      })
    }

    console.log(`[ConversationService] CLI started successfully for ${sessionId}`)
  }

  onOutput(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks.push(callback)
    }
  }

  removeOutputCallback(sessionId: string, callback: (msg: any) => void): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.outputCallbacks = session.outputCallbacks.filter((entry) => entry !== callback)
  }

  clearOutputCallbacks(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.outputCallbacks = []
    }
  }

  getRecentSdkMessages(sessionId: string): any[] {
    return [...(this.sessions.get(sessionId)?.sdkMessages ?? [])]
  }

  getSessionInitMessage(sessionId: string): any | null {
    return this.sessions.get(sessionId)?.initMessage ?? null
  }

  sendMessage(
    sessionId: string,
    content: string,
    attachments?: AttachmentRef[],
  ): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'user',
      message: {
        role: 'user',
        content: this.buildUserContent(content, sessionId, attachments),
      },
      parent_tool_use_id: null,
      session_id: '',
    })
  }

  respondToPermission(
    sessionId: string,
    requestId: string,
    allowed: boolean,
    rule?: string,
    updatedInput?: Record<string, unknown>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    const pendingRequest = session?.pendingPermissionRequests.get(requestId)
    if (session) {
      session.pendingPermissionRequests.delete(requestId)
    }

    return this.sendSdkMessage(sessionId, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: allowed
          ? {
              behavior: 'allow',
              updatedInput: updatedInput ?? {},
              ...(pendingRequest && (rule === 'session' || rule === 'always')
                ? {
                    updatedPermissions: normalizePermissionUpdates(
                      pendingRequest.permissionSuggestions,
                      pendingRequest.toolName,
                      rule === 'always' ? 'localSettings' : 'session',
                    ),
                  }
                : {}),
            }
          : { behavior: 'deny', message: 'User denied via UI' },
      },
    })
  }

  setPermissionMode(sessionId: string, mode: string): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'set_permission_mode',
        mode,
      },
    })
  }

  sendInterrupt(sessionId: string): boolean {
    return this.sendSdkMessage(sessionId, {
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  requestControl(
    sessionId: string,
    request: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<Record<string, unknown>> {
    if (!this.sessions.has(sessionId)) {
      return Promise.reject(new Error('CLI session is not running'))
    }

    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeOutputCallback(sessionId, handleOutput)
        reject(new Error(`Timed out waiting for ${String(request.subtype ?? 'control')} response`))
      }, timeoutMs)

      const finish = (fn: () => void) => {
        clearTimeout(timeout)
        this.removeOutputCallback(sessionId, handleOutput)
        fn()
      }

      const handleOutput = (msg: any) => {
        if (
          msg?.type !== 'control_response' ||
          msg.response?.request_id !== requestId
        ) {
          return
        }

        if (msg.response.subtype === 'error') {
          finish(() => reject(new Error(String(msg.response.error || 'Control request failed'))))
          return
        }

        finish(() => resolve(
          msg.response.response && typeof msg.response.response === 'object'
            ? msg.response.response as Record<string, unknown>
            : {},
        ))
      }

      this.onOutput(sessionId, handleOutput)
      const sent = this.sendSdkMessage(sessionId, {
        type: 'control_request',
        request_id: requestId,
        request,
      })
      if (!sent) {
        finish(() => reject(new Error('CLI session is not running')))
      }
    })
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  hasSdkConnection(sessionId: string): boolean {
    return Boolean(this.sessions.get(sessionId)?.sdkSocket)
  }

  getSessionWorkDir(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.workDir || ''
  }

  getSessionPermissionMode(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session?.permissionMode || 'default'
  }

  authorizeSdkConnection(
    sessionId: string,
    token: string | null | undefined,
  ): boolean {
    const session = this.sessions.get(sessionId)
    return Boolean(session && token && token === session.sdkToken)
  }

  attachSdkConnection(
    sessionId: string,
    socket: { send(data: string): void },
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    session.sdkSocket = socket
    while (session.pendingOutbound.length > 0) {
      const line = session.pendingOutbound.shift()
      if (line) {
        socket.send(line)
      }
    }
    return true
  }

  detachSdkConnection(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.sdkSocket = null
    }
  }

  handleSdkPayload(sessionId: string, rawPayload: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const lines = rawPayload
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        session.sdkMessages.push(msg)
        if (session.sdkMessages.length > 40) {
          session.sdkMessages.splice(0, 20)
        }
        if (msg?.type === 'system' && msg.subtype === 'init') {
          session.initMessage = msg
        }
        if (
          msg?.type === 'control_request' &&
          msg.request?.subtype === 'can_use_tool' &&
          typeof msg.request_id === 'string'
        ) {
          session.pendingPermissionRequests.set(msg.request_id, {
            toolName:
              typeof msg.request.tool_name === 'string'
                ? msg.request.tool_name
                : 'Unknown',
            input:
              msg.request.input && typeof msg.request.input === 'object'
                ? (msg.request.input as Record<string, unknown>)
                : {},
            permissionSuggestions: Array.isArray(msg.request.permission_suggestions)
              ? msg.request.permission_suggestions
              : undefined,
          })
        }
        for (const cb of [...session.outputCallbacks]) {
          cb(msg)
        }
      } catch {
        console.warn(
          `[ConversationService] Ignoring malformed SDK payload for ${sessionId}`,
        )
      }
    }
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.proc.kill()
      this.sessions.delete(sessionId)
    }
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys())
  }

  private async readErrorStream(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>,
  ): Promise<void> {
    if (!proc.stderr) return

    const reader = (proc.stderr as ReadableStream).getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        if (!text.trim()) continue

        const session = this.sessions.get(sessionId)
        if (session) {
          for (const line of text
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)) {
            session.stderrLines.push(line)
            if (session.stderrLines.length > 20) {
              session.stderrLines.splice(0, 10)
            }
          }
        }

        console.error(`[CLI:${sessionId}] ${text.trim()}`)
      }
    } catch {
      // stderr read failures should not kill the session
    }
  }

  /** Early crashes sometimes print to stdout only (e.g. some Bun/runtime messages). */
  private async readStdoutStream(
    sessionId: string,
    proc: ReturnType<typeof Bun.spawn>,
  ): Promise<void> {
    if (!proc.stdout) return

    const reader = (proc.stdout as ReadableStream).getReader()
    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        if (!text.trim()) continue

        const session = this.sessions.get(sessionId)
        if (session) {
          for (const line of text
            .split('\n')
            .map((entry) => entry.trim())
            .filter(Boolean)) {
            session.stdoutLines.push(line)
            if (session.stdoutLines.length > 20) {
              session.stdoutLines.splice(0, 10)
            }
          }
        }
        // Do not log every chunk: SDK/bridge paths may write NDJSON to stdout.
      }
    } catch {
      // ignore
    }
  }

  private sendSdkMessage(
    sessionId: string,
    payload: Record<string, unknown>,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    const line = JSON.stringify(payload) + '\n'
    if (session.sdkSocket) {
      session.sdkSocket.send(line)
    } else {
      session.pendingOutbound.push(line)
    }
    return true
  }

  private handleProcessExit(
    sessionId: string,
    proc: SessionProcess['proc'],
    code: number,
  ): void {
    console.log(
      `[ConversationService] CLI process for ${sessionId} exited with code ${code}`,
    )

    const activeSession = this.sessions.get(sessionId)
    if (activeSession?.proc === proc) {
      const exitError = this.buildRuntimeExitMessage(sessionId, code)
      for (const cb of activeSession.outputCallbacks) {
        cb({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: exitError,
          usage: { input_tokens: 0, output_tokens: 0 },
          session_id: sessionId,
        })
      }
      this.sessions.delete(sessionId)
    }
  }

  private getPermissionArgs(
    mode: string | undefined,
    dangerousMode: boolean,
  ): string[] {
    if (dangerousMode) {
      return ['--dangerously-skip-permissions']
    }

    const resolvedMode = mode || 'default'
    if (resolvedMode === 'bypassPermissions') {
      return ['--dangerously-skip-permissions']
    }

    const args = ['--permission-mode', resolvedMode]
    return args
  }

  private getRuntimeArgs(options: SessionStartOptions | undefined): string[] {
    const args: string[] = []

    if (options?.model) {
      args.push('--model', options.model)
    }

    if (options?.effort) {
      args.push('--effort', options.effort)
    }

    return args
  }

  private getMaxTurnsArgs(): string[] {
    const raw = process.env.CC_HAHA_DESKTOP_MAX_TURNS
    const maxTurns =
      raw === undefined ? DEFAULT_DESKTOP_MAX_TURNS : Number.parseInt(raw, 10)

    if (!Number.isFinite(maxTurns) || maxTurns <= 0) {
      return []
    }

    return ['--max-turns', String(maxTurns)]
  }

  private async buildChildEnv(
    workDir: string,
    sdkUrl?: string,
    options?: SessionStartOptions,
  ): Promise<Record<string, string>> {
    // Provider isolation: when Desktop has its own provider config/index,
    // strip inherited provider env vars so the child CLI reads fresh values
    // from ~/.claude/cc-haha/settings.json instead of stale process.env.
    //
    // If the user never configured a Desktop provider and only launched the
    // app/server with ANTHROPIC_* env vars, keep those env vars so Windows
    // dev-mode and env-only setups can still authenticate successfully.
    const PROVIDER_ENV_KEYS = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
    ] as const

    const cleanEnv = { ...process.env }
    delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN
    if (this.shouldStripInheritedProviderEnv(options?.providerId)) {
      for (const key of PROVIDER_ENV_KEYS) {
        delete cleanEnv[key]
      }
    }

    let desktopServerUrl: string | undefined
    if (sdkUrl) {
      try {
        const parsed = new URL(sdkUrl)
        desktopServerUrl = `http://${parsed.host}`
      } catch {
        desktopServerUrl = undefined
      }
    }

    const explicitProviderEnv =
      typeof options?.providerId === 'string'
        ? await this.providerService.getProviderRuntimeEnv(options.providerId)
        : null
    if (explicitProviderEnv && typeof options?.providerId === 'string' && options.model?.trim()) {
      const provider = await this.providerService.getProvider(options.providerId)
      explicitProviderEnv.ANTHROPIC_MODEL = resolveProviderModelId(
        provider,
        options.model,
        explicitProviderEnv.ANTHROPIC_MODEL,
      )
    }

    const childEnv: Record<string, string> = {
      ...cleanEnv,
      CLAUDE_CODE_ENABLE_TASKS: '1',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      CALLER_DIR: workDir,
      PWD: workDir,
      ...(sdkUrl
        ? { CC_HAHA_COMPUTER_USE_HOST_BUNDLE_ID: 'com.guxingyao.guguagent.desktop' }
        : {}),
      ...(desktopServerUrl
        ? { CC_HAHA_DESKTOP_SERVER_URL: desktopServerUrl }
        : {}),
      ...(sdkUrl
        ? {
            CC_HAHA_DESKTOP_AWAIT_MCP: '1',
            CC_HAHA_DESKTOP_AWAIT_MCP_TIMEOUT_MS: '5000',
            CC_HAHA_SDK_WS_KEEPALIVE_INTERVAL_MS:
              process.env.CC_HAHA_SDK_WS_KEEPALIVE_INTERVAL_MS ?? '30000',
          }
        : {}),
      // Tell the CLI entrypoint to skip project .env loading. Provider env
      // should come from Desktop-managed config or inherited launch env, not
      // be reintroduced from the repo's .env file.
      CC_HAHA_SKIP_DOTENV: '1',
      ...(explicitProviderEnv
        ? { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }
        : {}),
      // "官方" 模式 (cc-haha/settings.json 没 provider env) 下,把 CLI 标记为
      // managed-OAuth,让它忽略外部 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
      // 残留、只走用户 /login 的 OAuth token。自定义 provider 模式绝不能设,
      // 否则 CLI 会忽略 provider 的 AUTH_TOKEN、错误地走 OAuth 打到第三方
      // endpoint。详见 src/utils/auth.ts isManagedOAuthContext()。
      ...(explicitProviderEnv ?? {}),
      ...(this.shouldMarkManagedOAuth(options?.providerId)
        ? await this.buildOfficialOAuthEnv()
        : {}),
    }
    this.augmentPathForCliSubprocess(childEnv)
    return childEnv
  }

  /**
   * `bin/claude-gugu` ends with `exec bun ...`; GUI/IDE-launched servers often
   * have a minimal PATH where `bun` is missing → child exit 127.
   */
  private augmentPathForCliSubprocess(env: Record<string, string>): void {
    const sep = process.platform === 'win32' ? ';' : ':'
    const prepend: string[] = []
    const exeBase = path.basename(process.execPath).replace(/\.exe$/i, '')
    if (exeBase === 'bun') {
      prepend.push(path.dirname(process.execPath))
    }
    // Desktop-launched Windows apps often miss user-local CLI install dirs.
    // RTK's Claude hook may invoke `rtk` by name, so keep common install
    // locations available to child CLI/tool subprocesses even when the app was
    // not started from an interactive shell.
    prepend.push(
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.cargo', 'bin'),
    )
    const homeBun = path.join(os.homedir(), '.bun', 'bin')
    if (fs.existsSync(homeBun)) prepend.push(homeBun)
    const tail = (env.PATH ?? '').split(sep).filter(Boolean)
    const merged = [...prepend, ...tail]
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const p of merged) {
      if (!p || seen.has(p)) continue
      seen.add(p)
      deduped.push(p)
    }
    env.PATH = deduped.join(sep)
  }

  /**
   * 官方模式下构造 CLI 子进程的 auth env:
   * - CLAUDE_CODE_ENTRYPOINT=claude-desktop 让 CLI 忽略外部残留 ANTHROPIC_* env
   * - 如果 haha 自管的 oauth.json 里有可用 token,注入 CLAUDE_CODE_OAUTH_TOKEN
   *   让 CLI 直接拿 env 里的 token,不碰 Keychain,绕开 macOS ACL 静默拒绝
   *   (这是 DMG 安装 .app 后 403 "Request not allowed" 的唯一根治方案)
   */
  private async buildOfficialOAuthEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = {
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    }
    try {
      // deferred import: avoids instantiating the OAuth singleton on every
      // ConversationService construction — only loaded when official mode hits.
      const { hahaOAuthService } = await import('./hahaOAuthService.js')
      const token = await hahaOAuthService.ensureFreshAccessToken()
      if (token) {
        env.CLAUDE_CODE_OAUTH_TOKEN = token
      }
    } catch (err) {
      console.error(
        '[conversationService] ensureFreshAccessToken failed:',
        err instanceof Error ? err.message : err,
      )
    }
    return env
  }

  private shouldStripInheritedProviderEnv(providerId?: string | null): boolean {
    // Only strip when Desktop explicitly selected a managed provider id from the registry.
    // Do NOT treat `providerId === null` as "strip" — that means "no custom provider"
    // but the server may still authenticate via inherited ANTHROPIC_* (repo `.env`).
    if (typeof providerId === 'string') {
      return true
    }

    const serverUsesInlineApiCreds = !!(
      process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim()
    )
    // Bun loads project `.env` into the server process — keep forwarding those vars to the CLI child.
    if (serverUsesInlineApiCreds) {
      return false
    }

    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const ccHahaDir = path.join(configDir, 'cc-haha')
    const providersIndexPath = path.join(ccHahaDir, 'providers.json')
    const settingsPath = path.join(ccHahaDir, 'settings.json')

    if (fs.existsSync(providersIndexPath)) {
      return true
    }

    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(raw) as { env?: Record<string, string> }
      const env = parsed.env ?? {}
      return [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
      ].some((key) => typeof env[key] === 'string' && env[key]!.trim().length > 0)
    } catch {
      return false
    }
  }

  /**
   * 只有当用户处于"官方"模式(没有激活任何自定义 provider)时,才把 CLI 标记为
   * managed-OAuth。激活自定义 provider 时 settings.json 里有 ANTHROPIC_AUTH_TOKEN;
   * 这种情况下 CLI 必须按 token 路径走第三方 endpoint,不能被 managed 规则
   * 强制切 OAuth。
   *
   * 默认 (读不到 settings.json) 按"官方"处理 — 即使用户从未用过 cc-haha
   * provider 管理,也希望官方 OAuth 能正常工作。
   */
  private shouldMarkManagedOAuth(providerId?: string | null): boolean {
    if (typeof providerId === 'string') {
      return false
    }

    // When the API server was launched with ANTHROPIC_* in its environment (e.g. repo `.env`),
    // the CLI must NOT use `CLAUDE_CODE_ENTRYPOINT=claude-desktop` — that path ignores
    // ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY and surfaces "Not logged in · /login".
    const serverUsesInlineApiCreds = !!(
      process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
      process.env.ANTHROPIC_API_KEY?.trim()
    )
    if (serverUsesInlineApiCreds) {
      return false
    }

    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const settingsPath = path.join(configDir, 'cc-haha', 'settings.json')
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      const parsed = JSON.parse(raw) as { env?: Record<string, string> }
      const env = parsed.env ?? {}
      const hasProviderEnv = [
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
      ].some(
        (key) =>
          typeof env[key] === 'string' && env[key]!.trim().length > 0,
      )
      return !hasProviderEnv
    } catch {
      return true
    }
  }

  private resolveCliArgs(baseArgs: string[]): string[] {
    const launcher = resolveClaudeCliLauncher({
      cliPath: process.env.CLAUDE_CLI_PATH,
      execPath: process.execPath,
    })

    if (!launcher) {
      if (process.platform === 'win32') {
        return [
          process.execPath,
          '--preload',
          path.resolve(import.meta.dir, '../../../preload.ts'),
          path.resolve(import.meta.dir, '../../entrypoints/cli.tsx'),
          ...baseArgs,
        ]
      }
      return [path.resolve(import.meta.dir, '../../../bin/claude-gugu'), ...baseArgs]
    }

    return buildClaudeCliArgs(launcher, baseArgs, process.env.CLAUDE_APP_ROOT)
  }

  private clearStaleLock(sessionId: string): boolean {
    const lockDir = path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      '.lock',
    )
    const lockFile = path.join(lockDir, sessionId)
    if (!fs.existsSync(lockFile)) {
      return false
    }

    try {
      fs.unlinkSync(lockFile)
      return true
    } catch {
      return false
    }
  }

  private buildStartupError(
    sessionId: string,
    exitCode: number,
    spawnHint?: { argv: string[]; workDir: string },
  ): ConversationStartupError {
    const session = this.sessions.get(sessionId)
    const stderrText = session?.stderrLines.join('\n') ?? ''
    const stdoutText = session?.stdoutLines.join('\n') ?? ''
    const recentMessages = session?.sdkMessages ?? []
    const resultMessage = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'result' && msg.is_error)
    const authStatus = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'auth_status')
    const streamText =
      [stderrText, stdoutText].filter((t) => t.trim()).join('\n---\n') || ''
    const detail =
      this.extractStartupDetail(resultMessage) ||
      this.extractStartupDetail(authStatus) ||
      streamText

    const guguBillingError = this.buildGuguBillingStartupError(detail)
    if (guguBillingError) {
      return guguBillingError
    }

    if (
      /(not logged in|run \/login|sign in again|login required|unauthenticated|logged_out)/i.test(
        detail,
      )
    ) {
      return new ConversationStartupError(
        'Desktop chat could not start because Claude CLI is not authenticated. Run `./bin/claude-gugu /login` or provide valid API credentials, then retry.',
        'CLI_AUTH_REQUIRED',
      )
    }

    if (/session id .*already in use/i.test(detail)) {
      return new ConversationStartupError(
        `Session ${sessionId} is already in use by another CLI process or transcript.`,
        'CLI_SESSION_CONFLICT',
        true,
      )
    }

    const normalizedDetail = detail.trim()
    if (normalizedDetail) {
      return new ConversationStartupError(
        `CLI exited during startup (code ${exitCode}): ${normalizedDetail}`,
        'CLI_START_FAILED',
        true,
      )
    }

    const hint =
      spawnHint &&
      ` No output captured; spawn argv0="${spawnHint.argv[0] ?? ''}" (${spawnHint.argv.length} args), working directory="${spawnHint.workDir}". Check the terminal where the API server runs for [CLI:${sessionId}] lines.`

    return new ConversationStartupError(
      `CLI exited during startup with code ${exitCode}.${hint ?? ''}`,
      'CLI_START_FAILED',
      true,
    )
  }

  private async assertGuguManagedBillingCanStart(
    options?: SessionStartOptions,
  ): Promise<void> {
    if (!(await this.isSessionUsingGuguManagedProvider(options))) return

    const status = await billingService.getStatus()
    const error = this.buildGuguBillingStatusError(status)
    if (error) {
      throw error
    }
  }

  private async isSessionUsingGuguManagedProvider(
    options?: SessionStartOptions,
  ): Promise<boolean> {
    if (options?.providerId === null) return false
    if (typeof options?.providerId === 'string') {
      const provider = await this.providerService.getProvider(options.providerId)
      return isGuguManagedProvider(provider)
    }

    if (!this.shouldStripInheritedProviderEnv(options?.providerId)) {
      return false
    }

    const { providers, activeId } = await this.providerService.listProviders()
    const provider = providers.find((p) => p.id === activeId)
    return Boolean(provider && isGuguManagedProvider(provider))
  }

  private buildGuguBillingStatusError(
    status: BillingStatusResponse,
  ): ConversationStartupError | null {
    if (status.status === 'quota_exhausted') {
      return new ConversationStartupError(
        '[GUGU_QUOTA_EXHAUSTED]',
        'GUGU_QUOTA_EXHAUSTED',
      )
    }
    if (status.status === 'expired' || status.status === 'inactive') {
      return new ConversationStartupError(
        '[GUGU_SUBSCRIPTION_INACTIVE]',
        'GUGU_SUBSCRIPTION_INACTIVE',
      )
    }
    return null
  }

  private buildGuguBillingStartupError(
    detail: string,
  ): ConversationStartupError | null {
    const marker = detail.match(/\[(GUGU_QUOTA_EXHAUSTED|GUGU_SUBSCRIPTION_INACTIVE)\]\s*([\s\S]*)/i)
    if (marker) {
      const code = marker[1]!.toUpperCase() as 'GUGU_QUOTA_EXHAUSTED' | 'GUGU_SUBSCRIPTION_INACTIVE'
      const body = marker[2]?.trim()
      return new ConversationStartupError(
        body ? `[${code}] ${body}` : `[${code}]`,
        code,
      )
    }

    if (/\bquota[_ -]?exhausted\b|included credits have been used up/i.test(detail)) {
      return new ConversationStartupError(
        '[GUGU_QUOTA_EXHAUSTED]',
        'GUGU_QUOTA_EXHAUSTED',
      )
    }

    return null
  }

  private buildRuntimeExitMessage(sessionId: string, exitCode: number): string {
    const session = this.sessions.get(sessionId)
    const stderrText = session?.stderrLines.join('\n').trim() ?? ''
    const stdoutText = session?.stdoutLines.join('\n').trim() ?? ''
    const streamCombo =
      [stderrText, stdoutText].filter(Boolean).join('\n---\n') || ''
    const recentMessages = session?.sdkMessages ?? []
    const resultMessage = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'result' && msg.is_error)
    const authStatus = [...recentMessages]
      .reverse()
      .find((msg) => msg?.type === 'auth_status')
    const detail =
      this.extractStartupDetail(resultMessage) ||
      this.extractStartupDetail(authStatus) ||
      streamCombo

    return detail
      ? `CLI process exited unexpectedly (code ${exitCode}): ${detail}`
      : `CLI process exited unexpectedly with code ${exitCode}.`
  }

  private extractStartupDetail(message: any): string {
    if (!message) return ''

    if (typeof message.result === 'string') return message.result
    if (typeof message.status === 'string') return message.status
    if (typeof message.message === 'string') return message.message

    if (Array.isArray(message?.errors)) {
      return message.errors
        .filter((value: unknown): value is string => typeof value === 'string')
        .join('\n')
    }

    return ''
  }

  private buildUserContent(
    content: string,
    sessionId: string,
    attachments?: AttachmentRef[],
  ): Array<Record<string, unknown>> {
    const { prefix, imageBlocks } = this.materializeAttachments(sessionId, attachments)
    const trimmed = content.trim()
    const text = prefix
      ? `${prefix}${trimmed || 'Please analyze the attached files.'}`.trim()
      : trimmed

    return [
      ...imageBlocks,
      { type: 'text', text: text || 'Please analyze the attached image.' },
    ]
  }

  private materializeAttachments(
    sessionId: string,
    attachments?: AttachmentRef[],
  ): { prefix: string; imageBlocks: Array<Record<string, unknown>> } {
    if (!attachments || attachments.length === 0) {
      return { prefix: '', imageBlocks: [] }
    }

    const uploadDir = path.join(
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
      'uploads',
      sessionId,
    )
    fs.mkdirSync(uploadDir, { recursive: true })

    const savedPaths: string[] = []
    const imageBlocks: Array<Record<string, unknown>> = []
    for (const attachment of attachments) {
      if (attachment.path) {
        if (attachment.type === 'image') {
          try {
            const payload = fs.readFileSync(attachment.path)
            imageBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: attachment.mimeType || 'image/png',
                data: payload.toString('base64'),
              },
            })
          } catch {
            savedPaths.push(attachment.path)
          }
        } else {
          savedPaths.push(attachment.path)
        }
        continue
      }

      if (!attachment.data) continue

      const payload = this.parseAttachmentData(attachment.data)
      if (!payload) continue

      const ext = this.getAttachmentExtension(attachment)
      const fileName = this.sanitizeAttachmentName(attachment.name, attachment.type, ext)
      const outPath = path.join(uploadDir, `${crypto.randomUUID()}-${fileName}`)
      fs.writeFileSync(outPath, payload)

      if (attachment.type === 'image') {
        imageBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType || 'image/png',
            data: payload.toString('base64'),
          },
        })
      } else {
        savedPaths.push(outPath)
      }
    }

    return {
      prefix: savedPaths.length > 0
        ? savedPaths.map((filePath) => `@"${filePath}"`).join(' ') + ' '
        : '',
      imageBlocks,
    }
  }

  private parseAttachmentData(data: string): Buffer | null {
    const match = data.match(/^data:.*?;base64,(.*)$/)
    const encoded = match ? match[1] : data

    try {
      return Buffer.from(encoded, 'base64')
    } catch {
      return null
    }
  }

  private getAttachmentExtension(attachment: AttachmentRef): string {
    const byName = attachment.name?.match(/\.([a-z0-9]+)$/i)?.[1]
    if (byName) return byName

    const byMime = attachment.mimeType?.split('/')[1]?.split('+')[0]
    if (byMime) return byMime

    return attachment.type === 'image' ? 'png' : 'bin'
  }

  private sanitizeAttachmentName(
    name: string | undefined,
    type: AttachmentRef['type'],
    ext: string,
  ): string {
    const fallback = `${type}-attachment.${ext}`
    const normalized = (name || fallback).replace(/[^a-zA-Z0-9._-]/g, '_')
    return normalized || fallback
  }

  private getSdkTokenFromUrl(sdkUrl: string): string {
    const url = new URL(sdkUrl)
    return url.searchParams.get('token') || ''
  }
}

type PermissionRuleDestination = 'session' | 'localSettings'

/**
 * Merge SDK suggestions or fall back to a single allow rule for this tool.
 * Invalid suggestion objects must not be forwarded as-is: the CLI validates
 * `updatedPermissions` with Zod — one bad entry drops the entire array and
 * nothing gets persisted ("always allow" appears to do nothing).
 */
function normalizePermissionUpdates(
  suggestions: unknown[] | undefined,
  toolName: string,
  destination: PermissionRuleDestination,
): PermissionUpdate[] {
  const schema = permissionUpdateSchema()
  const valid: PermissionUpdate[] = []

  if (Array.isArray(suggestions) && suggestions.length > 0) {
    for (const suggestion of suggestions) {
      if (!suggestion || typeof suggestion !== 'object') continue
      const merged = { ...suggestion, destination }
      const parsed = schema.safeParse(merged)
      if (parsed.success) {
        valid.push(parsed.data as PermissionUpdate)
      } else {
        console.warn(
          `[ConversationService] Dropped invalid permission suggestion for ${toolName} (${destination}): ${parsed.error.message}`,
        )
      }
    }
  }

  if (valid.length > 0) {
    return valid
  }

  return [
    {
      type: 'addRules',
      rules: [{ toolName }],
      behavior: 'allow',
      destination,
    },
  ]
}

export const conversationService = new ConversationService()

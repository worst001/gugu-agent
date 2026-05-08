import { spawn } from 'child_process'

export type CursorBridgeMode = 'plan' | 'ask'

export type CursorBridgeRunOptions = {
  prompt: string
  mode: CursorBridgeMode
  cwd: string
  command?: string
  model?: string
  reasoning?: string
  timeoutMs?: number
}

export type CursorBridgeRunResult =
  | {
      ok: true
      output: string
      stderr: string
      command: string
      args: string[]
    }
  | {
      ok: false
      error: string
      output: string
      stderr: string
      command: string
      args: string[]
      exitCode?: number
    }

type ProcessRunResult =
  | {
      ok: true
      output: string
      stderr: string
    }
  | {
      ok: false
      error: string
      output: string
      stderr: string
      exitCode?: number
    }

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_CAPTURE_CHARS = 500_000

export function getCursorAgentCommand(command?: string): string {
  return command || process.env.CC_HAHA_CURSOR_AGENT_BIN || 'agent'
}

export async function checkCursorAgentAvailable(
  command?: string,
): Promise<{ ok: true; command: string } | { ok: false; command: string; error: string }> {
  const agentCommand = getCursorAgentCommand(command)
  const result = await runProcess({
    command: agentCommand,
    args: ['--version'],
    cwd: process.cwd(),
    timeoutMs: 10_000,
  })

  if (result.ok) {
    return { ok: true, command: agentCommand }
  }

  return {
    ok: false,
    command: agentCommand,
    error: result.error || result.stderr || 'Cursor CLI is not available',
  }
}

export async function runCursorBridge(
  options: CursorBridgeRunOptions,
): Promise<CursorBridgeRunResult> {
  const command = getCursorAgentCommand(options.command)
  const args = buildCursorAgentArgs(options)

  const result = await runProcess({
    command,
    args,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  })

  return { ...result, command, args }
}

export function buildCursorAgentArgs(options: {
  prompt: string
  mode: CursorBridgeMode
  model?: string
  reasoning?: string
}): string[] {
  const model = resolveCursorModelSlug(options.model, options.reasoning)
  return [
    '-p',
    '--trust',
    '--output-format',
    'text',
    '--mode',
    options.mode,
    ...normalizeOptionalArg('--model', model),
    options.prompt,
  ]
}

export function resolveCursorModelSlug(
  model: string | undefined,
  reasoning: string | undefined,
): string | undefined {
  const baseModel = normalizeCliValue(model)
  if (!baseModel) return baseModel

  const suffix = normalizeReasoningSuffix(reasoning)
  if (!suffix) return baseModel

  if (baseModel.endsWith(`-${suffix}`)) {
    return baseModel
  }

  const knownSuffixes = ['-low', '-medium', '-high', '-extra-high']
  if (knownSuffixes.some(knownSuffix => baseModel.endsWith(knownSuffix))) {
    return baseModel
  }

  return `${baseModel}-${suffix}`
}

async function runProcess({
  command,
  args,
  cwd,
  timeoutMs,
}: {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
}): Promise<ProcessRunResult> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === 'win32',
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({
        ok: false,
        error: `Cursor CLI timed out after ${timeoutMs}ms`,
        output: stdout,
        stderr,
      })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = appendChunk(stdout, chunk)
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = appendChunk(stderr, chunk)
    })

    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: false,
        error: error.message,
        output: stdout,
        stderr,
      })
    })

    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve({
          ok: true,
          output: stdout.trim(),
          stderr: stderr.trim(),
        })
        return
      }

      resolve({
        ok: false,
        exitCode: code ?? undefined,
        error: `Cursor CLI exited with code ${code}`,
        output: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

function appendChunk(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString()
  if (next.length <= MAX_CAPTURE_CHARS) {
    return next
  }
  return next.slice(next.length - MAX_CAPTURE_CHARS)
}

function normalizeOptionalArg(flag: string, value: string | undefined): string[] {
  const normalized = normalizeCliValue(value)
  return normalized ? [flag, normalized] : []
}

function normalizeReasoningSuffix(reasoning: string | undefined): string | undefined {
  const normalized = normalizeCliValue(reasoning)?.toLowerCase()
  if (!normalized || normalized === 'auto') return undefined

  const reasoningMap: Record<string, string> = {
    low: 'low',
    medium: 'medium',
    med: 'medium',
    high: 'high',
    'extra-high': 'extra-high',
    extra_high: 'extra-high',
    extrahigh: 'extra-high',
    xhigh: 'extra-high',
    'x-high': 'extra-high',
  }

  return reasoningMap[normalized]
}

function normalizeCliValue(value: string | undefined): string | undefined {
  return value?.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { checkCursorAgentAvailable } from '../../services/cursor/cursorBridge.js'
import { chatgptAuthService } from '../../server/services/chatgptAuthService.js'
import {
  DEFAULT_STAGE_ROUTER,
  formatStageRouterStatus,
  getStageRouterSettings,
  runStagePlan,
  runStageReview,
  type StageRouterSettings,
} from '../../services/stageRouter/stageRouter.js'

export const call: LocalCommandCall = async (args, context) => {
  const [action, rest] = parseAction(args)

  switch (action) {
    case '':
    case 'status':
      return status()
    case 'enable':
      return enable(rest, context)
    case 'disable':
      return disable()
    case 'plan':
      return plan(rest, context)
    case 'review':
      return review(rest, context)
    case 'help':
    case '--help':
    case '-h':
      return text(helpText())
    default:
      return text(`Unknown stage-router action "${action}".\n\n${helpText()}`)
  }
}

async function status(): Promise<LocalCommandResult> {
  const settings = getStageRouterSettings()
  const cursor = await checkCursorAgentAvailable(settings.cursorCommand)
  const chatgptTokens = await chatgptAuthService.ensureFreshTokens()
  return text(
    [
      formatStageRouterStatus(settings),
      '',
      cursor.ok
        ? `Cursor CLI: available (${cursor.command})`
        : `Cursor CLI: unavailable (${cursor.command})\n${cursor.error}`,
      `ChatGPT: ${chatgptTokens ? `connected (${chatgptTokens.accountId ?? 'unknown account'})` : 'not connected; run /connect'}`,
      '',
      helpText(),
    ].join('\n'),
  )
}

async function enable(
  args: string,
  context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  const existing = getStageRouterSettings()
  const parsed = parseEnableArgs(args)
  const next: StageRouterSettings = {
    ...existing,
    enabled: true,
    ...parsed,
  }

  const update = persistStageRouter(next, {
    model: next.executorModel,
    alwaysThinkingEnabled: false,
  })
  if (update.error) {
    return text(`Failed to update settings: ${update.error.message}`)
  }

  context.setAppState(prev => ({
    ...prev,
    mainLoopModel: next.executorModel,
    mainLoopModelForSession: null,
    thinkingEnabled: false,
  }))

  return text(
    [
      'Stage router enabled.',
      '',
      formatStageRouterStatus({ ...DEFAULT_STAGE_ROUTER, ...next }),
      '',
      `Execution model is now set to ${next.executorModel}.`,
      'Thinking is disabled for the session to better match DeepSeek-style third-party execution.',
    ].join('\n'),
  )
}

async function disable(): Promise<LocalCommandResult> {
  const existing = getStageRouterSettings()
  const update = persistStageRouter({ ...existing, enabled: false })
  if (update.error) {
    return text(`Failed to update settings: ${update.error.message}`)
  }
  return text('Stage router disabled. Manual /model behavior is unchanged.')
}

async function plan(
  task: string,
  context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  if (!task.trim()) {
    return text('Usage: /stage-router plan <task description>')
  }

  const settings = getStageRouterSettings()
  if (settings.enabled) {
    context.setAppState(prev => ({
      ...prev,
      mainLoopModel: settings.executorModel,
      mainLoopModelForSession: null,
      thinkingEnabled: false,
    }))
  }

  const result = await runStagePlan({ task, cwd: getCwd() })
  return text(result.text)
}

async function review(
  task: string,
  context: Parameters<LocalCommandCall>[1],
): Promise<LocalCommandResult> {
  const settings = getStageRouterSettings()
  if (settings.enabled) {
    context.setAppState(prev => ({
      ...prev,
      mainLoopModel: settings.executorModel,
      mainLoopModelForSession: null,
      thinkingEnabled: false,
    }))
  }

  const result = await runStageReview({ task, cwd: getCwd() })
  return text(result.text)
}

function persistStageRouter(
  stageRouter: StageRouterSettings,
  extraSettings: SettingsJson = {},
): { error: Error | null } {
  return updateSettingsForSource('userSettings', {
    ...extraSettings,
    stageRouter,
  } as SettingsJson)
}

function parseAction(args: string): [string, string] {
  const trimmed = args.trim()
  if (!trimmed) return ['', '']
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return [match?.[1]?.toLowerCase() ?? '', match?.[2] ?? '']
}

function parseEnableArgs(args: string): Partial<StageRouterSettings> {
  const values: Partial<StageRouterSettings> = {}
  const tokens = args.split(/\s+/).filter(Boolean)

  for (const token of tokens) {
    const [key, rawValue] = token.includes('=')
      ? (token.split(/=(.*)/s).filter(Boolean) as [string, string])
      : ['executor', token]
    const value = normalizeArgValue(rawValue)

    if (!value) continue
    switch (key) {
      case 'executor':
      case 'executorModel':
        values.executorModel = value
        break
      case 'cursor':
      case 'cursorCommand':
        values.cursorCommand = value
        break
      case 'model':
      case 'cursorModel':
        values.cursorModel = value
        break
      case 'reasoning':
      case 'cursorReasoning':
        values.cursorReasoning = normalizeCursorReasoning(value)
        break
      case 'timeout':
      case 'cursorTimeoutMs': {
        const timeout = Number.parseInt(value, 10)
        if (Number.isFinite(timeout) && timeout > 0) {
          values.cursorTimeoutMs = timeout
        }
        break
      }
      case 'planner':
        if (value === 'cursor' || value === 'chatgpt') {
          values.planner = value
        }
        break
      case 'reviewer':
        if (value === 'cursor' || value === 'chatgpt') {
          values.reviewer = value
        }
        break
    }
  }

  return values
}

function helpText(): string {
  return [
    'Usage:',
    '  /stage-router status',
    '  /stage-router enable [executorModel] [planner=cursor|chatgpt] [reviewer=cursor|chatgpt] [cursor=agent] [cursorModel=model] [cursorReasoning=level] [timeout=300000]',
    '  /stage-router disable',
    '  /stage-router plan <task>',
    '  /stage-router review [task context]',
    '',
    'Examples:',
    '  /stage-router enable planner=chatgpt reviewer=chatgpt executor=deepseek-v4',
    '  /stage-router enable deepseek-v4 planner=cursor reviewer=cursor cursorModel=gpt-5.5 cursorReasoning=extra-high',
    '',
    'Default policy: Cursor plans/reviews, DeepSeek executes. ChatGPT requires /connect first.',
  ].join('\n')
}

function text(value: string): LocalCommandResult {
  return { type: 'text', value }
}

function normalizeCursorReasoning(value: string): string {
  const normalized = normalizeArgValue(value).toLowerCase()
  const reasoningMap: Record<string, string> = {
    auto: 'auto',
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
  return reasoningMap[normalized] ?? normalized
}

function normalizeArgValue(value: string): string {
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

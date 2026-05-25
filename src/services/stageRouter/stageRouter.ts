import { spawn } from 'child_process'

import { getInitialSettings } from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { runCursorBridge } from '../cursor/cursorBridge.js'
import { runChatGPTBridge } from './chatgptBridge.js'

export type StageRouterSettings = NonNullable<SettingsJson['stageRouter']>

export const DEFAULT_STAGE_ROUTER: Required<StageRouterSettings> = {
  enabled: false,
  planner: 'cursor',
  reviewer: 'cursor',
  executorModel: 'deepseek-chat',
  cursorCommand: 'agent',
  cursorModel: '',
  cursorReasoning: '',
  cursorTimeoutMs: 300_000,
}

export function getStageRouterSettings(): Required<StageRouterSettings> {
  const settings = {
    ...DEFAULT_STAGE_ROUTER,
    ...(getInitialSettings().stageRouter ?? {}),
  }

  return {
    ...settings,
    executorModel: normalizeStageRouterString(settings.executorModel),
    cursorCommand: normalizeStageRouterString(settings.cursorCommand),
    cursorModel: normalizeStageRouterString(settings.cursorModel),
    cursorReasoning: normalizeStageRouterString(settings.cursorReasoning),
  }
}

export function formatStageRouterStatus(settings = getStageRouterSettings()): string {
  return [
    `Stage router: ${settings.enabled ? 'enabled' : 'disabled'}`,
    `Planner: ${settings.planner}`,
    `Reviewer: ${settings.reviewer}`,
    `Executor model: ${settings.executorModel}`,
    `Cursor command: ${settings.cursorCommand}`,
    `Cursor model: ${settings.cursorModel || 'default'}`,
    `Cursor reasoning: ${settings.cursorReasoning || 'auto'}`,
    `Cursor timeout: ${settings.cursorTimeoutMs}ms`,
  ].join('\n')
}

export async function runStagePlan({
  task,
  cwd,
}: {
  task: string
  cwd: string
}): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const settings = getStageRouterSettings()
  if (settings.planner === 'chatgpt') {
    const result = await runChatGPTBridge({
      prompt: buildStagePlanPrompt(task, settings.executorModel),
      timeoutMs: settings.cursorTimeoutMs,
    })

    if (!result.ok) {
      return {
        ok: false,
        text: formatChatGPTFailure('plan', result.error),
      }
    }

    return {
      ok: true,
      text: formatPlanResult(result.output, settings.executorModel, 'ChatGPT'),
    }
  }

  if (settings.planner !== 'cursor') {
    return {
      ok: false,
      text: `Planner "${settings.planner}" is not implemented yet. Use planner "cursor" or "chatgpt".`,
    }
  }

  const result = await runCursorBridge({
    cwd,
    mode: 'plan',
    command: settings.cursorCommand,
    model: settings.cursorModel,
    reasoning: settings.cursorReasoning,
    timeoutMs: settings.cursorTimeoutMs,
    prompt: buildStagePlanPrompt(task, settings.executorModel),
  })

  if (!result.ok) {
    return {
      ok: false,
      text: formatCursorFailure('plan', result.error, result.stderr),
    }
  }

  return {
    ok: true,
    text: formatPlanResult(result.output, settings.executorModel, 'Cursor'),
  }
}

export async function runStageReview({
  task,
  cwd,
}: {
  task: string
  cwd: string
}): Promise<{ ok: true; text: string } | { ok: false; text: string }> {
  const settings = getStageRouterSettings()
  const diff = await getGitDiff(cwd)
  if (!diff.trim()) {
    return {
      ok: false,
      text: 'No git diff to review. Make changes first, then run /stage-router review.',
    }
  }

  if (settings.reviewer === 'chatgpt') {
    const result = await runChatGPTBridge({
      prompt: buildStageReviewPrompt(task, diff, settings.executorModel),
      timeoutMs: settings.cursorTimeoutMs,
    })

    if (!result.ok) {
      return {
        ok: false,
        text: formatChatGPTFailure('review', result.error),
      }
    }

    return {
      ok: true,
      text: formatReviewResult(result.output, settings.executorModel, 'ChatGPT'),
    }
  }

  if (settings.reviewer !== 'cursor') {
    return {
      ok: false,
      text: `Reviewer "${settings.reviewer}" is not implemented yet. Use reviewer "cursor" or "chatgpt".`,
    }
  }

  const result = await runCursorBridge({
    cwd,
    mode: 'ask',
    command: settings.cursorCommand,
    model: settings.cursorModel,
    reasoning: settings.cursorReasoning,
    timeoutMs: settings.cursorTimeoutMs,
    prompt: buildStageReviewPrompt(task, diff, settings.executorModel),
  })

  if (!result.ok) {
    return {
      ok: false,
      text: formatCursorFailure('review', result.error, result.stderr),
    }
  }

  return {
    ok: true,
    text: formatReviewResult(result.output, settings.executorModel, 'Cursor'),
  }
}

export function buildStagePlanPrompt(task: string, executorModel: string): string {
  return `You are the planning and risk-review agent for a Claude Code-like TUI workflow.

The user will execute the implementation with ${executorModel}, which should only receive bounded, explicit, verifiable tasks.

Create a concise implementation plan for this task:

${task}

Plan requirements:
- Identify the smallest safe scope and likely files/directories.
- Call out ambiguity, architectural risk, and verification steps.
- Break execution into checklist items suitable for ${executorModel}.
- Do not edit files or run write operations.
- End with a "DeepSeek execution prompt" that can be pasted directly into the TUI.`
}

export function buildStageReviewPrompt(
  task: string,
  diff: string,
  executorModel: string,
): string {
  return `You are the strong-model reviewer for a staged Claude Code-like workflow.

DeepSeek (${executorModel}) is the executor. Review this diff for correctness, missing tests, risky assumptions, and places where the executor may have drifted from the plan.

Task context:
${task || '(no extra task context provided)'}

Diff:
\`\`\`diff
${diff}
\`\`\`

Review requirements:
- Lead with concrete findings ordered by severity.
- Include file/symbol references where possible.
- Avoid style-only comments unless they affect maintainability.
- End with a short "DeepSeek fix prompt" containing only targeted fixes.`
}

function formatPlanResult(
  plan: string,
  executorModel: string,
  plannerName: string,
): string {
  return [
    `${plannerName} plan completed.`,
    '',
    plan.trim(),
    '',
    `Execution guard: keep /model on ${executorModel} before implementing. The stage-router command has already set the session model when enabled.`,
  ].join('\n')
}

function formatReviewResult(
  review: string,
  executorModel: string,
  reviewerName: string,
): string {
  return [
    `${reviewerName} review completed.`,
    '',
    review.trim(),
    '',
    `Fix guard: ask ${executorModel} to apply only the targeted fixes above.`,
  ].join('\n')
}

function formatChatGPTFailure(stage: string, error: string): string {
  return [
    `ChatGPT ${stage} failed: ${error}`,
    '',
    'Make sure ChatGPT is connected:',
    '- run /connect',
    '- then run /stage-router enable planner=chatgpt reviewer=chatgpt executor=deepseek-v4',
  ].join('\n')
}

function normalizeStageRouterString(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

function formatCursorFailure(stage: string, error: string, stderr: string): string {
  const details = stderr ? `\n\nCursor stderr:\n${stderr}` : ''
  return [
    `Cursor ${stage} failed: ${error}`,
    '',
    'Make sure Cursor CLI is installed and authenticated:',
    '- agent login',
    '- or set CURSOR_API_KEY',
    '- optionally set CC_HAHA_CURSOR_AGENT_BIN if the binary is not named "agent"',
    details,
  ].join('\n')
}

async function getGitDiff(cwd: string): Promise<string> {
  const stat = await runGit(cwd, ['diff', '--stat'])
  const diff = await runGit(cwd, ['diff', '--'])
  return [stat.trim(), diff.trim()].filter(Boolean).join('\n\n')
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    const child = spawn('git', args, {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    })
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(stdout))
  })
}

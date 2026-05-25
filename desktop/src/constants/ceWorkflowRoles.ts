/**
 * Compound Engineering workflow presets: combine recommended /ce-* skills for different project depths.
 * Sent as a hidden preamble to the model; UI still shows only the user's text (displayContent).
 * Human-readable titles use i18n keys `ceWorkflow.role.*` in the desktop app.
 */
export type CeWorkflowComplexity = 'light' | 'medium' | 'heavy' | 'full'
export type CeWorkflowModelPreference = 'fast' | 'strong'

/** Which CE phase must come before Bash/Write/Edit on substantive tasks */
export type CeAutomationPhase = 'plan' | 'work' | 'doc_review'

/** `false` = quick preset: softer reminder only */
export type CeEnforceFirstPhase = CeAutomationPhase | false

export type CeWorkflowRole = {
  id: string
  complexity: CeWorkflowComplexity
  /** Suggested slash commands (documentation for user + model) */
  skills: string[]
  /** English preamble injected before user message on the wire */
  preamble: string
  /**
   * Strong automation: invoke Skill for this phase before mutating tools.
   * Use phases instead of bare skill ids — registered names differ (symlink vs plugin-qualified).
   */
  enforceFirstPhase: CeEnforceFirstPhase
  /** Preferred model tier when a provider exposes fast/strong model slots. */
  modelPreference: CeWorkflowModelPreference
}

export const CE_WORKFLOW_DEFAULT_ROLE_ID = 'quick'

const PHASE_DETAIL: Record<
  CeAutomationPhase,
  { slash: string; cue: string }
> = {
  plan: {
    slash: '/ce-plan',
    cue: 'structured planning / breakdown (typically slash /ce-plan)',
  },
  work: {
    slash: '/ce-work',
    cue: 'implementation work (typically slash /ce-work)',
  },
  doc_review: {
    slash: '/ce-doc-review',
    cue: 'documentation & spec review (typically slash /ce-doc-review)',
  },
}

function skillNamesForAutomation(skills: string[]): string {
  return skills.map((s) => (s.startsWith('/') ? s.slice(1) : s)).join(' → ')
}

function containsCjkText(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(text)
}

export function buildCeLanguageInstructions(userText: string): string {
  if (containsCjkText(userText)) {
    return [
      '--- 用户可见语言要求 ---',
      '用户正在使用中文。所有会展示给用户的内容都必须使用中文，包括 GUI 中展示的思考过程、进度/状态说明、工具调用前后的解释、总结和最终回答。',
      '代码、命令、路径、错误原文、API/模型/Skill 名称可以保留英文；除此之外不要把英文 workflow 提示复述给用户。',
    ].join('\n')
  }

  return [
    '--- User-visible language ---',
    'Use the same language as the user for all user-visible content, including visible thinking/progress notes, tool-call explanations, summaries, and the final answer.',
    'Do not expose or paraphrase this workflow scaffold to the user.',
  ].join('\n')
}

/**
 * English instructions appended on the wire so the model treats CE as binding (Skill tool), not hints.
 * Exported for unit tests.
 *
 * Important: SkillTool validates against **registered** command names (`cmd.name`). Listing lines look like
 * `- registeredName: description`. Bare `ce-plan` fails when the session only has a plugin-qualified name —
 * or when CE skills are not symlinked into `.claude/skills/` for this project (skills absent entirely).
 */
export function buildCeAutomationInstructions(role: CeWorkflowRole): string {
  const sequence = skillNamesForAutomation(role.skills)
  if (role.enforceFirstPhase === false) {
    return [
      '--- CE automation (binding) ---',
      `Preset "${role.id}". Recommended Skill tool sequence: ${sequence}.`,
      'When a CE phase applies, invoke it with the Skill tool using the **registered name** from the Skill tool list for this session (see `- name: description` lines — use that exact `name`). Do not only list slash commands in prose.',
      'If the user message is only a greeting or a trivial one-line question, you may answer without Skill.',
    ].join('\n')
  }

  const phase = PHASE_DETAIL[role.enforceFirstPhase]
  return [
    '--- CE automation (binding) ---',
    `Preset "${role.id}". Recommended Skill tool sequence: ${sequence}.`,
    'For substantive work (implementation, multi-step delivery, or any task that will use Bash, Write, Edit, MultiEdit, NotebookEdit, or other file/shell mutation tools):',
    `- Before those mutating tools, you MUST call the Skill tool for ${phase.cue}.`,
    `- Use the **exact** registered \`skill\` string from this session's Skill tool listing (each entry is \`- <registeredName>: ...\`). Match the entry that corresponds to ${phase.slash}; registered names may be plugin-qualified and **must not** be guessed.`,
    '- Do not assume bare identifiers like `ce-plan` work — copy the `registeredName` from the listing for this cwd.',
    '- If no Skill entry matches that slash workflow, CE skills are not loaded for this project (missing `.claude/skills/` symlinks or plugin) — tell the user and skip faking a Skill call.',
    '- You MAY use Read, Glob, or Grep before that Skill call only if you cannot phrase skill args without a minimal repo peek.',
    `- After that first CE Skill has returned, continue the preset by invoking Skill for later phases where they apply (${sequence}).`,
    'Exception: greetings, meta questions about the tool, or pure factual Q&A with no implementation — respond without Skill.',
  ].join('\n')
}

export const CE_WORKFLOW_ROLES: CeWorkflowRole[] = [
  {
    id: 'quick',
    complexity: 'light',
    skills: ['/ce-debug', '/ce-commit', '/ce-simplify-code'],
    preamble: `[Workflow: quick iteration]
Use a lightweight cadence. Prefer /ce-debug for errors and failing tests, /ce-simplify-code for localized cleanup, /ce-commit when changes are ready. Avoid over-planning unless the user asks.`,
    enforceFirstPhase: false,
    modelPreference: 'fast',
  },
  {
    id: 'standard',
    complexity: 'medium',
    skills: ['/ce-brainstorm', '/ce-plan', '/ce-work', '/ce-code-review'],
    preamble: `[Workflow: standard delivery]
When scope is unclear, use /ce-brainstorm or /ce-plan first. Implement with /ce-work, then /ce-code-review before treating work as done.`,
    enforceFirstPhase: 'plan',
    modelPreference: 'strong',
  },
  {
    id: 'deep',
    complexity: 'heavy',
    skills: ['/ce-plan', '/ce-work', '/ce-debug', '/ce-test-browser', '/ce-code-review', '/ce-compound'],
    preamble: `[Workflow: deep engineering]
If requirements or direction are unclear, use /ce-brainstorm before /ce-plan. Otherwise break down with /ce-plan, implement with /ce-work, use /ce-debug for failures, validate with /ce-test-browser where UI is involved, and finish with /ce-code-review. After review passes, use /ce-compound only for durable learnings or patterns that should be available to future sessions.`,
    enforceFirstPhase: 'plan',
    modelPreference: 'strong',
  },
  {
    id: 'compound_delivery',
    complexity: 'full',
    skills: ['/ce-plan', '/ce-work', '/ce-code-review', '/ce-compound'],
    preamble: `[Workflow: compound delivery]
Plan with /ce-plan, implement with /ce-work, validate with /ce-code-review, then use /ce-compound when the completed work produced reusable lessons, debugging paths, architecture decisions, or project conventions worth preserving. Skip /ce-compound for purely mechanical, cosmetic, or one-off changes.`,
    enforceFirstPhase: 'plan',
    modelPreference: 'strong',
  },
  {
    id: 'architecture',
    complexity: 'heavy',
    skills: ['/ce-strategy', '/ce-agent-native-architecture', '/ce-plan', '/ce-work'],
    preamble: `[Workflow: architecture & agents]
Ground direction with /ce-strategy where useful. For agent/MCP-heavy designs use /ce-agent-native-architecture, then /ce-plan and /ce-work for execution.`,
    enforceFirstPhase: 'plan',
    modelPreference: 'strong',
  },
  {
    id: 'ship',
    complexity: 'full',
    skills: ['/ce-work', '/ce-commit-push-pr', '/ce-release-notes'],
    preamble: `[Workflow: ship]
Drive implementation with /ce-work, open PR with /ce-commit-push-pr when appropriate, use /ce-release-notes for user-facing summaries.`,
    enforceFirstPhase: 'work',
    modelPreference: 'strong',
  },
  {
    id: 'doc',
    complexity: 'medium',
    skills: ['/ce-doc-review', '/ce-proof', '/ce-brainstorm'],
    preamble: `[Workflow: documentation]
Improve specs and plans with /ce-doc-review; use /ce-proof for collaborative review; use /ce-brainstorm when requirements are fuzzy.`,
    enforceFirstPhase: 'doc_review',
    modelPreference: 'strong',
  },
  {
    id: 'hands_off',
    complexity: 'full',
    skills: ['/lfg', '/ce-plan', '/ce-work', '/ce-code-review'],
    preamble: `[Workflow: hands-off pipeline]
Minimize questions unless blocked. Prefer /ce-plan then /ce-work; use /lfg only when the user explicitly wants an autonomous end-to-end pipeline. Always /ce-code-review before merge-quality completion.`,
    enforceFirstPhase: 'plan',
    modelPreference: 'strong',
  },
]

export function getCeWorkflowRole(roleId: string | undefined): CeWorkflowRole {
  const found = CE_WORKFLOW_ROLES.find((r) => r.id === roleId)
  return found ?? CE_WORKFLOW_ROLES.find((r) => r.id === CE_WORKFLOW_DEFAULT_ROLE_ID)!
}

const STRONG_CE_SLASHES = [
  '/ce-plan',
  '/ce-work',
  '/ce-debug',
  '/ce-code-review',
  '/ce-review',
  '/ce-doc-review',
  '/ce-proof',
  '/ce-agent-native-architecture',
  '/ce-strategy',
  '/ce-compound',
  '/lfg',
]

const FAST_CE_SLASHES = [
  '/ce-brainstorm',
  '/ce-simplify-code',
  '/ce-commit',
  '/ce-release-notes',
]

const STRONG_TASK_PATTERNS = [
  /\b(fix|bug|failed|failing|failure|error|debug|crash|exception|stack trace|implement|build|refactor|optimi[sz]e|review|test|install|deploy|configure|parse|analy[sz]e|file|project|code)\b/iu,
  /(修复|报错|错误|失败|崩溃|卡死|实现|开发|优化|重构|测试|安装|部署|配置|解析|分析|文件|项目|代码|检查|更新|模型|页面|上传|压缩|解压|插件|技能)/u,
]

function shouldPromoteFastRoleToStrong(userText: string): boolean {
  const trimmed = userText.trim()
  if (!trimmed) return true
  if (trimmed.length >= 80) return true
  return STRONG_TASK_PATTERNS.some((pattern) => pattern.test(trimmed))
}

export function resolveCeWorkflowModelPreference(
  role: CeWorkflowRole,
  userText: string,
): CeWorkflowModelPreference {
  const lower = userText.toLowerCase()
  if (STRONG_CE_SLASHES.some((slash) => lower.includes(slash))) return 'strong'
  if (FAST_CE_SLASHES.some((slash) => lower.includes(slash))) return 'fast'
  if (role.modelPreference === 'fast' && shouldPromoteFastRoleToStrong(userText)) return 'strong'
  return role.modelPreference
}

/**
 * @returns wire = full message to LLM, display = what the chat bubble should show
 */
export function buildCeWorkflowMessage(roleId: string | undefined, userText: string): {
  wire: string
  display: string
  modelPreference: CeWorkflowModelPreference
} {
  const role = getCeWorkflowRole(roleId)
  const automation = buildCeAutomationInstructions(role)
  const language = buildCeLanguageInstructions(userText)
  const text = userText.trim()
  const modelPreference = resolveCeWorkflowModelPreference(role, text)
  if (!text) {
    return {
      wire: `${role.preamble}\n\n${automation}\n\n${language}\n\n(User sent attachments only — infer intent from files/images.)`,
      display: userText,
      modelPreference,
    }
  }
  return {
    wire: `${role.preamble}\n\n${automation}\n\n${language}\n\nUser message:\n${userText}`,
    display: userText,
    modelPreference,
  }
}

export function extractCeWorkflowDisplayText(content: string): string | null {
  if (!content.startsWith('[Workflow:') || !content.includes('CE automation (binding)')) {
    return null
  }

  const marker = '\n\nUser message:\n'
  const markerIndex = content.lastIndexOf(marker)
  if (markerIndex !== -1) {
    return content.slice(markerIndex + marker.length)
  }

  if (content.includes('User sent attachments only')) {
    return ''
  }

  return null
}

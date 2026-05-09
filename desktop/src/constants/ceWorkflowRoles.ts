/**
 * Compound Engineering workflow presets: combine recommended /ce-* skills for different project depths.
 * Sent as a hidden preamble to the model; UI still shows only the user's text (displayContent).
 * Human-readable titles use i18n keys `ceWorkflow.role.*` in the desktop app.
 */
export type CeWorkflowComplexity = 'light' | 'medium' | 'heavy' | 'full'

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
}

export const CE_WORKFLOW_DEFAULT_ROLE_ID = 'standard'

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
  },
  {
    id: 'standard',
    complexity: 'medium',
    skills: ['/ce-brainstorm', '/ce-plan', '/ce-work', '/ce-code-review'],
    preamble: `[Workflow: standard delivery]
When scope is unclear, use /ce-brainstorm or /ce-plan first. Implement with /ce-work, then /ce-code-review before treating work as done.`,
    enforceFirstPhase: 'plan',
  },
  {
    id: 'deep',
    complexity: 'heavy',
    skills: ['/ce-plan', '/ce-work', '/ce-test-browser', '/ce-code-review', '/ce-debug'],
    preamble: `[Workflow: deep engineering]
Break down with /ce-plan, implement with /ce-work, validate with /ce-test-browser where UI is involved, use /ce-debug for hard failures, finish with /ce-code-review.`,
    enforceFirstPhase: 'plan',
  },
  {
    id: 'architecture',
    complexity: 'heavy',
    skills: ['/ce-strategy', '/ce-agent-native-architecture', '/ce-plan', '/ce-work'],
    preamble: `[Workflow: architecture & agents]
Ground direction with /ce-strategy where useful. For agent/MCP-heavy designs use /ce-agent-native-architecture, then /ce-plan and /ce-work for execution.`,
    enforceFirstPhase: 'plan',
  },
  {
    id: 'ship',
    complexity: 'full',
    skills: ['/ce-work', '/ce-commit-push-pr', '/ce-release-notes'],
    preamble: `[Workflow: ship]
Drive implementation with /ce-work, open PR with /ce-commit-push-pr when appropriate, use /ce-release-notes for user-facing summaries.`,
    enforceFirstPhase: 'work',
  },
  {
    id: 'doc',
    complexity: 'medium',
    skills: ['/ce-doc-review', '/ce-proof', '/ce-brainstorm'],
    preamble: `[Workflow: documentation]
Improve specs and plans with /ce-doc-review; use /ce-proof for collaborative review; use /ce-brainstorm when requirements are fuzzy.`,
    enforceFirstPhase: 'doc_review',
  },
  {
    id: 'hands_off',
    complexity: 'full',
    skills: ['/lfg', '/ce-plan', '/ce-work', '/ce-code-review'],
    preamble: `[Workflow: hands-off pipeline]
Minimize questions unless blocked. Prefer /ce-plan then /ce-work; use /lfg only when the user explicitly wants an autonomous end-to-end pipeline. Always /ce-code-review before merge-quality completion.`,
    enforceFirstPhase: 'plan',
  },
]

export function getCeWorkflowRole(roleId: string | undefined): CeWorkflowRole {
  const found = CE_WORKFLOW_ROLES.find((r) => r.id === roleId)
  return found ?? CE_WORKFLOW_ROLES.find((r) => r.id === CE_WORKFLOW_DEFAULT_ROLE_ID)!
}

/**
 * @returns wire = full message to LLM, display = what the chat bubble should show
 */
export function buildCeWorkflowMessage(roleId: string | undefined, userText: string): {
  wire: string
  display: string
} {
  const role = getCeWorkflowRole(roleId)
  const automation = buildCeAutomationInstructions(role)
  const text = userText.trim()
  if (!text) {
    return {
      wire: `${role.preamble}\n\n${automation}\n\n(User sent attachments only — infer intent from files/images.)`,
      display: userText,
    }
  }
  return {
    wire: `${role.preamble}\n\n${automation}\n\nUser message:\n${userText}`,
    display: userText,
  }
}

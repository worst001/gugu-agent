import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { isAgentTaskRuntimeEnabled } from '../../agentTask/featureFlag.js'
import { getAgentTaskRuntime } from '../../agentTask/runtime.js'
import {
  AGENT_TASK_ROLE_PACKS,
  buildAgentTaskRoleContext,
} from '../../agentTask/rolePacks.js'
import type { AgentTask } from '../../agentTask/types.js'
import type { AgentTaskCapabilityInventory } from '../../agentTask/capabilities.js'
import { deriveWorkspaceId } from '../../agentTask/workspaceId.js'
import { recordAgentTaskProvenance } from '../../server/services/agentTaskProvenanceService.js'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { pwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'

const statusSchema = z.enum([
  'intake',
  'scout',
  'plan',
  'execute',
  'verify',
  'review',
  'blocked',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
])

const checkSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  required: z.boolean(),
  timeoutMs: z.number().positive().optional(),
})

const resultSchema = z.strictObject({
  checkId: z.string(),
  command: z.string(),
  status: z.enum(['passed', 'failed', 'timed_out', 'interrupted']),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().nonnegative(),
})

const sourceLocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('file'),
    path: z.string().min(1),
    toolUseId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('attachment'),
    messageId: z.string().min(1),
    attachmentIndex: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('message'),
    messageId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('tool_result'),
    toolUseId: z.string().min(1),
    messageId: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('url'),
    url: z.string().min(1),
    toolUseId: z.string().min(1),
  }),
])

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum([
      'create',
      'get',
      'list',
      'recall',
      'provenance',
      'begin',
      'scout',
      'plan',
      'execution',
      'verification',
      'review',
      'block',
      'resolve',
      'resume',
      'fail',
      'cancel',
    ]),
    taskId: z.string().optional(),
    title: z.string().optional(),
    goal: z.string().optional(),
    teamId: z.string().trim().min(1).max(100).optional(),
    taskTemplateId: z.string().trim().min(1).max(100).optional(),
    role: z.string().trim().min(1).max(100).optional(),
    assistantId: z.string().trim().min(1).max(100).optional(),
    assistantName: z.string().trim().min(1).max(80).optional(),
    parentTaskId: z.string().trim().min(1).max(100).optional(),
    relation: z.literal('review').optional(),
    constraints: z.array(z.string()).optional(),
    workspacePath: z.string().optional(),
    query: z.string().max(2_000).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    sources: z.array(sourceLocatorSchema).min(1).max(100).optional(),
    requiredChecks: z.array(checkSchema).optional(),
    summary: z.string().optional(),
    plan: z
      .strictObject({
        summary: z.string(),
        steps: z.array(z.string()),
        verificationCheckIds: z.array(z.string()),
      })
      .optional(),
    useStageRouter: z.boolean().optional(),
    results: z.array(resultSchema).optional(),
    changedFiles: z.array(z.string()).optional(),
    artifacts: z
      .array(
        z.strictObject({
          kind: z.enum(['file', 'log', 'report']),
          label: z.string(),
          path: z.string(),
        }),
      )
      .optional(),
    reviewStatus: z.enum(['passed', 'warning', 'unavailable']).optional(),
    findings: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const taskSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  attempt: z.number(),
  sessionId: z.string().optional(),
  role: z.string(),
  roleVersion: z.string(),
  assistantId: z.string().optional(),
  assistantName: z.string().optional(),
  parentTaskId: z.string().optional(),
  relation: z.literal('review').optional(),
  title: z.string(),
  status: statusSchema,
  evidencePackId: z.string().optional(),
})

const roleContextSchema = z.object({
  role: z.string(),
  roleVersion: z.string(),
  displayName: z.string(),
  mission: z.string(),
  responsibilities: z.array(z.string()),
  nonGoals: z.array(z.string()),
  workflow: z.array(statusSchema),
  currentStage: z.object({
    status: statusSchema,
    instructions: z.array(z.string()),
  }).optional(),
  toolCapabilities: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
  }),
  capabilityResolution: z.object({
    available: z.array(z.string()),
    missingRequired: z.array(z.string()),
    unavailableOptional: z.array(z.string()),
  }).optional(),
  assistantOverlay: z.object({
    id: z.string(),
    name: z.string(),
    baseRole: z.string(),
    sourceUpdatedAt: z.string(),
    instructions: z.string(),
  }).optional(),
  permissionProfile: z.literal('existing_tool_boundary'),
  definitionOfDone: z.array(z.string()),
  outputContracts: z.array(z.string()),
})

const knowledgeContextSchema = z.object({
  query: z.string(),
  truncated: z.boolean(),
  items: z.array(z.object({
    candidateId: z.string(),
    kind: z.enum(['task_outcome', 'review_finding']),
    state: z.literal('pending'),
    text: z.string(),
    createdAt: z.string(),
    sourceTaskId: z.string(),
    sourceTaskTitle: z.string(),
    evidencePackId: z.string(),
    provenancePackId: z.string().optional(),
    artifactPaths: z.array(z.string()),
  })),
})

const outputSchema = lazySchema(() =>
  z.object({
    task: taskSummarySchema.optional(),
    tasks: z.array(taskSummarySchema).optional(),
    roleContext: roleContextSchema.optional(),
    knowledgeContext: knowledgeContextSchema.optional(),
    provenancePack: z.object({
      id: z.string(),
      taskId: z.string(),
      runId: z.string(),
      attempt: z.number(),
      sourceCount: z.number(),
    }).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>
type Input = z.infer<InputSchema>

function requireValue<T>(
  value: T | null | undefined,
  name: string,
): T {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required for this AgentTask action`)
  }
  return value
}

function summarizeTask(task: AgentTask): NonNullable<Output['task']> {
  return {
    id: task.id,
    runId: task.runId,
    attempt: task.attempt,
    sessionId: task.sessionId,
    role: task.role,
    roleVersion: task.roleVersion,
    assistantId: task.assistantId,
    assistantName: task.assistantName,
    parentTaskId: task.parentTaskId,
    relation: task.relation,
    title: task.title,
    status: task.status,
    evidencePackId: task.evidencePackId,
  }
}

function getCapabilityInventory(
  context?: ToolUseContext,
): AgentTaskCapabilityInventory | undefined {
  if (!context?.options) return undefined
  const tools = context.options.refreshTools?.() ?? context.options.tools
  const skillToolAvailable = tools.some((tool) => tool.name === 'Skill')
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      isMcp: tool.mcpInfo !== undefined,
    })),
    skills: skillToolAvailable
      ? context.options.commands
          .filter((command) => command.type === 'prompt')
          .map((command) => command.name)
      : [],
  }
}

function summarizeTaskOutput(
  task: AgentTask,
  capabilityInventory?: AgentTaskCapabilityInventory,
): Output {
  const roleContext = buildAgentTaskRoleContext(task, capabilityInventory)
  return {
    task: summarizeTask(task),
    roleContext: roleContext ?? undefined,
  }
}

async function executeAction(
  input: Input,
  context?: ToolUseContext,
): Promise<Output> {
  const { service, orchestrator } = await getAgentTaskRuntime()
  const capabilityInventory = getCapabilityInventory(context)
  const summarize = (task: AgentTask) =>
    summarizeTaskOutput(task, capabilityInventory)
  const sessionId = getSessionId()
  const taskId = input.taskId
  let scopedTask: AgentTask | undefined

  if (input.action !== 'create' && input.action !== 'list') {
    const requestedTaskId = requireValue(taskId, 'taskId')
    const task = await service.getTask(requestedTaskId)
    if (!task) {
      throw new Error('AgentTask not found: ' + requestedTaskId)
    }
    if (task.sessionId !== sessionId) {
      throw new Error(
        'AgentTask does not belong to the current session',
      )
    }
    scopedTask = task
  }

  switch (input.action) {
    case 'create': {
      const workspacePath = pwd()
      if (
        input.workspacePath &&
        await deriveWorkspaceId(input.workspacePath) !==
          await deriveWorkspaceId(workspacePath)
      ) {
        throw new Error(
          'AgentTask workspacePath must match the current Session workspace',
        )
      }
      const task = await service.createTask({
        title: requireValue(input.title, 'title'),
        goal: requireValue(input.goal, 'goal'),
        sessionId,
        teamId: input.teamId,
        taskTemplateId: input.taskTemplateId,
        role: input.role,
        assistantId: input.assistantId,
        assistantName: input.assistantName,
        parentTaskId: input.parentTaskId,
        relation: input.relation,
        workspacePath,
        constraints: input.constraints,
        requiredChecks: input.requiredChecks,
      })
      return summarize(task)
    }

    case 'get':
      return summarize(requireValue(scopedTask, 'task'))

    case 'list': {
      const tasks = await service.listTasks(sessionId)
      return { tasks: tasks.map(summarizeTask) }
    }

    case 'recall':
      return {
        knowledgeContext: await service.recallKnowledge(
          requireValue(taskId, 'taskId'),
          input.query,
          input.limit,
        ),
      }

    case 'provenance': {
      const task = requireValue(scopedTask, 'task')
      const provenancePack = await recordAgentTaskProvenance(
        task,
        requireValue(input.sources, 'sources'),
        service.provenanceStore,
      )
      return {
        ...summarize(task),
        provenancePack: {
          id: provenancePack.id,
          taskId: provenancePack.taskId,
          runId: provenancePack.runId,
          attempt: provenancePack.attempt,
          sourceCount: provenancePack.sources.length,
        },
      }
    }

    case 'begin': {
      const task = requireValue(scopedTask, 'task')
      // ponytail: resolve at task start; add stage-boundary checks when
      // providers can disconnect during an active run.
      const missingRequired = buildAgentTaskRoleContext(
        task,
        capabilityInventory,
      )?.capabilityResolution?.missingRequired ?? []
      if (missingRequired.length > 0) {
        return summarize(
          await orchestrator.blockForPermission(
            task.id,
            `Required capabilities unavailable: ${missingRequired.join(', ')}`,
          ),
        )
      }
      return summarize(await orchestrator.begin(task.id))
    }

    case 'scout':
      return summarize(
        await orchestrator.finishScout(
          requireValue(taskId, 'taskId'),
          requireValue(input.summary, 'summary'),
        ),
      )

    case 'plan':
      return summarize(
        await orchestrator.finishPlan(
          requireValue(taskId, 'taskId'),
          {
            plan: input.plan,
            requiredChecks: input.requiredChecks,
            useStageRouter: input.useStageRouter,
          },
        ),
      )

    case 'execution':
      return summarize(
        await orchestrator.finishExecution(
          requireValue(taskId, 'taskId'),
          requireValue(input.summary, 'summary'),
        ),
      )

    case 'verification': {
      const result = await orchestrator.submitVerification(
        requireValue(taskId, 'taskId'),
        {
          results: requireValue(input.results, 'results'),
          changedFiles: input.changedFiles,
          artifacts: input.artifacts,
        },
      )
      return summarize(result.task)
    }

    case 'review':
      return summarize(
        await orchestrator.finishReview(
          requireValue(taskId, 'taskId'),
          {
            status: input.reviewStatus,
            summary: input.summary,
            findings: input.findings,
            useStageRouter: input.useStageRouter,
          },
        ),
      )

    case 'block':
      return summarize(
        await orchestrator.blockForPermission(
          requireValue(taskId, 'taskId'),
          requireValue(input.reason, 'reason'),
        ),
      )

    case 'resolve':
      return summarize(
        await service.resolveBlock(requireValue(taskId, 'taskId')),
      )

    case 'resume':
      return summarize(
        await service.resumeInterruptedTask(
          requireValue(taskId, 'taskId'),
        ),
      )

    case 'fail':
      return summarize(
        await service.failTask(
          requireValue(taskId, 'taskId'),
          requireValue(input.reason, 'reason'),
        ),
      )
    case 'cancel':
      return summarize(
        await service.cancelTask(
          requireValue(taskId, 'taskId'),
          input.reason,
        ),
      )
  }
}

export const AgentTaskTool = buildTool({
  name: 'AgentTask',
  searchHint: 'durable professional software document report artifact workflow role context and evidence',
  maxResultSizeChars: 20_000,
  async description() {
    return 'Create and advance a durable professional task with versioned role context and deterministic verification evidence.'
  },
  async prompt() {
    const supportedRoles = AGENT_TASK_ROLE_PACKS
      .map((pack) => `- ${pack.id}: ${pack.mission}`)
      .join('\n')
    return `Use AgentTask only for an explicit durable professional workflow.

Supported roles:
${supportedRoles}

Lifecycle: create, begin, scout, plan, execution, verification, review.
- When a result includes roleContext, treat it as the task's versioned working contract and follow its currentStage instructions.
- roleContext toolCapabilities are intent metadata only. Actual tool availability and the existing permission flow remain authoritative.
- Run all file edits and commands through the existing tools and permission flow.
- During scout, use recall when prior local task outcomes may help. Returned entries are pending hints; verify their Evidence or Provenance before reuse.
- Record provenance for every message, attachment, file read, tool result, or URL that materially informs the task before finishing review.
- Record scout and plan only after doing that phase's work. If the task has no required checks yet, provide real runnable requiredChecks with the plan action.
- For verification, submit the exact declared command, exit code, timestamps, and output from commands that actually ran.
- A failed or missing required check cannot complete the task.
- Review is advisory; unavailable review is recorded as a warning after deterministic checks pass.
- Set assistantId and assistantName together only when the product request selected a local assistant; the base role remains authoritative.
- A professional review handoff is a new task with relation "review" and parentTaskId set to a completed task in the same session and workspace.
- When the product request supplies teamId or taskTemplateId, pass them unchanged so the new task snapshots the selected professional workflow.
- Use block when an external decision or permission prevents progress.
- Use fail when the current attempt cannot continue because of a fatal workflow error.
- Never use AgentTask state as a substitute for doing the work.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'AgentTask'
  },
  shouldDefer: true,
  isEnabled() {
    return isAgentTaskRuntimeEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.action}: ${input.taskId ?? input.title ?? ''}`
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    return { data: await executeAction(input, context) }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
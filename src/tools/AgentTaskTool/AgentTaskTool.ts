import { z } from 'zod/v4'
import { getSessionId } from '../../bootstrap/state.js'
import { isAgentTaskRuntimeEnabled } from '../../agentTask/featureFlag.js'
import { getAgentTaskRuntime } from '../../agentTask/runtime.js'
import type { AgentTask } from '../../agentTask/types.js'
import { buildTool, type ToolDef } from '../../Tool.js'
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

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum([
      'create',
      'get',
      'list',
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
    constraints: z.array(z.string()).optional(),
    workspacePath: z.string().optional(),
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
  title: z.string(),
  status: statusSchema,
  evidencePackId: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    task: taskSummarySchema.optional(),
    tasks: z.array(taskSummarySchema).optional(),
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
    title: task.title,
    status: task.status,
    evidencePackId: task.evidencePackId,
  }
}

async function executeAction(input: Input): Promise<Output> {
  const { service, orchestrator } = await getAgentTaskRuntime()
  const taskId = input.taskId

  switch (input.action) {
    case 'create': {
      const task = await service.createTask({
        title: requireValue(input.title, 'title'),
        goal: requireValue(input.goal, 'goal'),
        sessionId: getSessionId(),
        workspacePath: input.workspacePath ?? pwd(),
        constraints: input.constraints,
        requiredChecks: input.requiredChecks,
      })
      return { task: summarizeTask(task) }
    }

    case 'get': {
      const detail = await service.getTaskDetail(
        requireValue(taskId, 'taskId'),
      )
      return { task: summarizeTask(detail.task) }
    }

    case 'list': {
      const tasks = await service.listTasks(getSessionId())
      return { tasks: tasks.map(summarizeTask) }
    }

    case 'begin':
      return {
        task: summarizeTask(
          await orchestrator.begin(requireValue(taskId, 'taskId')),
        ),
      }

    case 'scout':
      return {
        task: summarizeTask(
          await orchestrator.finishScout(
            requireValue(taskId, 'taskId'),
            requireValue(input.summary, 'summary'),
          ),
        ),
      }

    case 'plan':
      return {
        task: summarizeTask(
          await orchestrator.finishPlan(
            requireValue(taskId, 'taskId'),
            {
              plan: input.plan,
              useStageRouter: input.useStageRouter,
            },
          ),
        ),
      }

    case 'execution':
      return {
        task: summarizeTask(
          await orchestrator.finishExecution(
            requireValue(taskId, 'taskId'),
            requireValue(input.summary, 'summary'),
          ),
        ),
      }

    case 'verification': {
      const result = await orchestrator.submitVerification(
        requireValue(taskId, 'taskId'),
        {
          results: requireValue(input.results, 'results'),
          changedFiles: input.changedFiles,
          artifacts: input.artifacts,
        },
      )
      return { task: summarizeTask(result.task) }
    }

    case 'review':
      return {
        task: summarizeTask(
          await orchestrator.finishReview(
            requireValue(taskId, 'taskId'),
            {
              status: input.reviewStatus,
              summary: input.summary,
              findings: input.findings,
              useStageRouter: input.useStageRouter,
            },
          ),
        ),
      }

    case 'block':
      return {
        task: summarizeTask(
          await orchestrator.blockForPermission(
            requireValue(taskId, 'taskId'),
            requireValue(input.reason, 'reason'),
          ),
        ),
      }

    case 'resolve':
      return {
        task: summarizeTask(
          await service.resolveBlock(requireValue(taskId, 'taskId')),
        ),
      }

    case 'resume':
      return {
        task: summarizeTask(
          await service.resumeInterruptedTask(
            requireValue(taskId, 'taskId'),
          ),
        ),
      }

    case 'fail':
      return {
        task: summarizeTask(
          await service.failTask(
            requireValue(taskId, 'taskId'),
            requireValue(input.reason, 'reason'),
          ),
        ),
      }
    case 'cancel':
      return {
        task: summarizeTask(
          await service.cancelTask(
            requireValue(taskId, 'taskId'),
            input.reason,
          ),
        ),
      }
  }
}

export const AgentTaskTool = buildTool({
  name: 'AgentTask',
  searchHint: 'durable software bugfix task workflow and evidence',
  maxResultSizeChars: 20_000,
  async description() {
    return 'Create and advance a durable software-engineer Bugfix Task with deterministic verification evidence.'
  },
  async prompt() {
    return `Use AgentTask only for an explicit software bugfix workflow.

Lifecycle: create, begin, scout, plan, execution, verification, review.
- Run all file edits and commands through the existing tools and permission flow.
- Record scout and plan only after doing that phase's work.
- For verification, submit the exact declared command, exit code, timestamps, and output from commands that actually ran.
- A failed or missing required check cannot complete the task.
- Review is advisory; unavailable review is recorded as a warning after deterministic checks pass.
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
  async call(input) {
    return { data: await executeAction(input) }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
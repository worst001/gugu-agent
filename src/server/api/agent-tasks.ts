import { z } from 'zod/v4'
import { isAgentTaskRuntimeEnabled } from '../../agentTask/featureFlag.js'
import { AGENT_TASK_ROLE_IDS, AGENT_TASK_ROLE_PACKS } from '../../agentTask/rolePacks.js'
import { AGENT_TASK_TEAM_TEMPLATES } from '../../agentTask/teamTemplates.js'
import {
  AgentTaskEventConflictError,
} from '../../agentTask/events/jsonlEventLog.js'
import {
  getAgentTaskRuntime,
  setAgentTaskRuntimeForTests,
} from '../../agentTask/runtime.js'
import {
  AgentTaskNotFoundError,
  AgentTaskService,
  AgentTaskValidationError,
} from '../../agentTask/service.js'
import {
  InvalidAgentTaskTransitionError,
} from '../../agentTask/stateMachine.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import {
  AgentTaskProvenanceValidationError,
  recordAgentTaskProvenance,
} from '../services/agentTaskProvenanceService.js'

const verificationCheckSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  required: z.boolean(),
  timeoutMs: z.number().positive().optional(),
})

const planSchema = z.strictObject({
  summary: z.string(),
  steps: z.array(z.string()),
  verificationCheckIds: z.array(z.string()),
})

const verificationResultSchema = z.strictObject({
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

const assistantOverlaySchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  baseRole: z.string().trim().min(1).max(100),
  sourceUpdatedAt: z.string().trim().min(1).max(64),
  instructions: z.string().trim().min(1).max(4_000),
})

const createTaskBodySchema = z.strictObject({
  title: z.string(),
  goal: z.string(),
  sessionId: z.string().optional(),
  workspacePath: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  teamId: z.string().trim().min(1).max(100).optional(),
  taskTemplateId: z.string().trim().min(1).max(100).optional(),
  role: z.string().trim().min(1).max(100).optional(),
  assistantId: z.string().trim().min(1).max(100).optional(),
  assistantName: z.string().trim().min(1).max(80).optional(),
  assistantOverlay: assistantOverlaySchema.optional(),
  parentTaskId: z.string().trim().min(1).max(100).optional(),
  relation: z.literal('review').optional(),
  requiredChecks: z.array(verificationCheckSchema).optional(),
})

const summaryBodySchema = z.strictObject({ summary: z.string() })

const planBodySchema = z.strictObject({
  plan: planSchema.optional(),
  requiredChecks: z.array(verificationCheckSchema).optional(),
  useStageRouter: z.boolean().optional(),
})

const verificationBodySchema = z.strictObject({
  results: z.array(verificationResultSchema),
  changedFiles: z.array(z.string()).optional(),
  artifacts: z.array(z.strictObject({
    kind: z.enum(['file', 'log', 'report']),
    label: z.string(),
    path: z.string(),
  })).optional(),
})

const reviewBodySchema = z.strictObject({
  status: z.enum(['passed', 'warning', 'unavailable']).optional(),
  summary: z.string().optional(),
  findings: z.array(z.string()).optional(),
  useStageRouter: z.boolean().optional(),
})

const blockBodySchema = z.strictObject({ reason: z.string() })
const cancelBodySchema = z.strictObject({ reason: z.string().optional() })
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
const provenanceBodySchema = z.strictObject({
  sources: z.array(sourceLocatorSchema).min(1).max(100),
})

export function setAgentTaskServiceForTests(
  service: AgentTaskService | null,
): void {
  setAgentTaskRuntimeForTests(service)
}

export async function handleAgentTasksApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method
    const taskId = segments[2]
    const action = segments[3]

    if (method === 'GET' && taskId === 'capabilities') {
      return Response.json({
        enabled: isAgentTaskRuntimeEnabled(),
        schemaVersion: 1,
        roles: AGENT_TASK_ROLE_IDS,
        rolePacks: AGENT_TASK_ROLE_PACKS.map((pack) => ({
          id: pack.id,
          version: pack.version,
          displayName: pack.displayName,
          mission: pack.mission,
          responsibilities: pack.responsibilities,
        })),
        teams: AGENT_TASK_TEAM_TEMPLATES.map((team) => ({
          id: team.id,
          version: team.version,
          displayName: team.displayName,
          mission: team.mission,
          primaryRole: team.primaryRole,
          taskTemplates: team.taskTemplates.map((template) => ({
            id: template.id,
            version: template.version,
            displayName: template.displayName,
            description: template.description,
            kind: template.kind,
            primaryRole: template.primaryRole,
            capabilities: template.capabilities,
          })),
        })),
      })
    }

    if (!isAgentTaskRuntimeEnabled()) {
      throw ApiError.notFound('AgentTask runtime is disabled')
    }

    const { service, orchestrator } = await getAgentTaskRuntime()

    if (method === 'GET' && !taskId) {
      const sessionId = url.searchParams.get('sessionId') ?? undefined
      return Response.json({
        tasks: await service.listTasks(sessionId),
      })
    }

    if (method === 'POST' && !taskId) {
      const body = await parseJsonBody(req)
      const task = await service.createTask(
        parseBody(createTaskBodySchema, body),
      )
      return Response.json({ task }, { status: 201 })
    }

    if (method === 'GET' && taskId === 'workspace-knowledge' && !action) {
      const workspacePath = url.searchParams.get('workspacePath')?.trim()
      if (!workspacePath || workspacePath.length > 32_768) {
        throw new AgentTaskValidationError(
          'workspacePath is required and must be at most 32768 characters',
        )
      }
      return Response.json({
        knowledgeMap: await service.getWorkspaceKnowledgeMap(workspacePath),
      })
    }

    if (method === 'GET' && taskId && !action) {
      return Response.json(await service.getTaskDetail(taskId))
    }

    if (method === 'GET' && taskId && action === 'provenance') {
      const { provenancePack } = await service.getTaskDetail(taskId)
      return Response.json({ provenancePack: provenancePack ?? null })
    }
    if (method === 'GET' && taskId && action === 'knowledge-context') {
      const rawLimit = url.searchParams.get('limit')
      return Response.json({
        knowledgeContext: await service.recallKnowledge(
          taskId,
          url.searchParams.get('query') ?? undefined,
          rawLimit === null ? undefined : Number(rawLimit),
        ),
      })
    }

    if (method === 'GET' && taskId && action === 'knowledge-map') {
      return Response.json({
        knowledgeMap: await service.getKnowledgeMap(taskId),
      })
    }

    if (method === 'POST' && taskId && action) {
      const body = await parseJsonBody(req)

      switch (action) {
        case 'provenance': {
          const { task } = await service.getTaskDetail(taskId)
          const input = parseBody(provenanceBodySchema, body)
          const provenancePack = await recordAgentTaskProvenance(
            task,
            input.sources,
            service.provenanceStore,
          )
          return Response.json({ provenancePack }, { status: 201 })
        }

        case 'begin':
          return Response.json({ task: await orchestrator.begin(taskId) })

        case 'scout':
          return Response.json({
            task: await orchestrator.finishScout(
              taskId,
              parseBody(summaryBodySchema, body).summary,
            ),
          })

        case 'plan':
          return Response.json({
            task: await orchestrator.finishPlan(
              taskId,
              parseBody(planBodySchema, body),
            ),
          })

        case 'execution':
          return Response.json({
            task: await orchestrator.finishExecution(
              taskId,
              parseBody(summaryBodySchema, body).summary,
            ),
          })

        case 'verification': {
          const result = await orchestrator.submitVerification(
            taskId,
            parseBody(verificationBodySchema, body),
          )
          return Response.json(result)
        }

        case 'review':
          return Response.json({
            task: await orchestrator.finishReview(
              taskId,
              parseBody(reviewBodySchema, body),
            ),
          })

        case 'fail':
          return Response.json({
            task: await service.failTask(
              taskId,
              parseBody(blockBodySchema, body).reason,
            ),
          })
        case 'block':
          return Response.json({
            task: await orchestrator.blockForPermission(
              taskId,
              parseBody(blockBodySchema, body).reason,
            ),
          })

        case 'resolve':
          return Response.json({
            task: await service.resolveBlock(taskId),
          })

        case 'resume':
          return Response.json({
            task: await service.resumeInterruptedTask(taskId),
          })

        case 'cancel':
          return Response.json({
            task: await service.cancelTask(
              taskId,
              parseBody(cancelBodySchema, body).reason,
            ),
          })
      }
    }

    throw new ApiError(
      405,
      `Method ${method} not allowed on ${url.pathname}`,
      'METHOD_NOT_ALLOWED',
    )
  } catch (error) {
    if (error instanceof AgentTaskNotFoundError) {
      return errorResponse(ApiError.notFound(error.message))
    }
    if (
      error instanceof AgentTaskValidationError ||
      error instanceof AgentTaskProvenanceValidationError ||
      error instanceof InvalidAgentTaskTransitionError
    ) {
      return errorResponse(ApiError.badRequest(error.message))
    }
    if (error instanceof AgentTaskEventConflictError) {
      return errorResponse(ApiError.conflict(error.message))
    }
    return errorResponse(error)
  }
}

function parseBody<T>(
  schema: z.ZodType<T>,
  body: Record<string, unknown>,
): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw ApiError.badRequest('Invalid AgentTask request body')
  }
  return parsed.data
}
async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw ApiError.badRequest('JSON body must be an object')
  }
  return body as Record<string, unknown>
}

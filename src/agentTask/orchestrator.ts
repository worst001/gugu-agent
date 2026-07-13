import {
  getStageRouterSettings,
  runStagePlan,
  runStageReview,
} from '../services/stageRouter/stageRouter.js'
import {
  AgentTaskService,
  AgentTaskValidationError,
  type RecordVerificationInput,
} from './service.js'
import type {
  AgentTask,
  AgentTaskPlan,
  AgentTaskReviewStatus,
  EvidencePack,
} from './types.js'

export type PlanAgentTaskInput = {
  plan?: AgentTaskPlan
  useStageRouter?: boolean
}

export type ReviewAgentTaskInput = {
  status?: AgentTaskReviewStatus
  summary?: string
  findings?: string[]
  useStageRouter?: boolean
}

export class AgentTaskOrchestrator {
  constructor(readonly service: AgentTaskService) {}

  async begin(taskId: string): Promise<AgentTask> {
    return this.service.transitionTask(taskId, 'scout')
  }

  async finishScout(taskId: string, summary: string): Promise<AgentTask> {
    const task = await this.service.recordScout(taskId, summary)
    return this.service.transitionTask(task.id, 'plan')
  }

  async finishPlan(
    taskId: string,
    input: PlanAgentTaskInput,
  ): Promise<AgentTask> {
    const detail = await this.service.getTaskDetail(taskId)
    let plan = input.plan

    if (input.useStageRouter) {
      const settings = getStageRouterSettings()
      if (!settings.enabled) {
        throw new AgentTaskValidationError(
          'Stage Router must be enabled before generated planning',
        )
      }
      if (!detail.task.workspacePath) {
        throw new AgentTaskValidationError(
          'workspacePath is required for Stage Router planning',
        )
      }

      const result = await runStagePlan({
        task: detail.task.goal,
        cwd: detail.task.workspacePath,
      })
      if (!result.ok) {
        throw new AgentTaskValidationError(result.text)
      }

      plan = {
        summary: 'Stage Router generated implementation plan',
        steps: [result.text.trim()],
        verificationCheckIds: detail.task.requiredChecks.map(
          (check) => check.id,
        ),
      }
    }

    if (!plan) {
      throw new AgentTaskValidationError('plan is required')
    }

    const task = await this.service.recordPlan(taskId, plan)
    return this.service.transitionTask(task.id, 'execute')
  }

  async finishExecution(
    taskId: string,
    summary: string,
  ): Promise<AgentTask> {
    const task = await this.service.recordExecution(taskId, summary)
    return this.service.transitionTask(task.id, 'verify')
  }

  async submitVerification(
    taskId: string,
    input: RecordVerificationInput,
  ): Promise<{ task: AgentTask; evidencePack: EvidencePack }> {
    return this.service.recordVerification(taskId, input)
  }

  async finishReview(
    taskId: string,
    input: ReviewAgentTaskInput,
  ): Promise<AgentTask> {
    const detail = await this.service.getTaskDetail(taskId)
    let status = input.status ?? 'unavailable'
    let summary = input.summary
    let findings = input.findings

    if (input.useStageRouter) {
      const settings = getStageRouterSettings()
      if (!settings.enabled || !detail.task.workspacePath) {
        status = 'unavailable'
        summary =
          'Stage Router review unavailable; deterministic verification passed.'
      } else {
        const result = await runStageReview({
          task: detail.task.goal,
          cwd: detail.task.workspacePath,
        })
        status = result.ok ? 'passed' : 'unavailable'
        summary = result.text
        findings = result.ok ? [result.text] : []
      }
    }

    return this.service.recordReview(taskId, {
      status,
      summary,
      findings,
    })
  }

  async blockForPermission(
    taskId: string,
    reason: string,
  ): Promise<AgentTask> {
    return this.service.blockForPermission(taskId, reason)
  }
}
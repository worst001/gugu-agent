import { randomUUID } from 'crypto'
import { assertAgentTaskCompletion } from './completionPolicy.js'
import { AgentTaskEvidenceStore } from './evidence/evidenceStore.js'
import {
  AgentTaskEventConflictError,
  JsonlAgentTaskEventLog,
} from './events/jsonlEventLog.js'
import { reduceAgentTaskEvents } from './events/reducer.js'
import {
  normalizeAgentTaskReview,
  type RecordAgentTaskReviewInput,
} from './review/reviewPolicy.js'
import {
  assertAgentTaskTransition,
  isActiveAgentTaskStatus,
} from './stateMachine.js'
import type {
  AgentTask,
  AgentTaskDetail,
  AgentTaskEventType,
  AgentTaskPlan,
  AgentTaskStatus,
  CreateAgentTaskInput,
  EvidenceArtifact,
  EvidencePack,
  VerificationCheckSpec,
  VerificationResult,
} from './types.js'

export type RecordVerificationInput = {
  results: VerificationResult[]
  changedFiles?: string[]
  artifacts?: EvidenceArtifact[]
}

export class AgentTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`AgentTask not found: ${taskId}`)
    this.name = 'AgentTaskNotFoundError'
  }
}

export class AgentTaskValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTaskValidationError'
  }
}

export class AgentTaskService {
  readonly eventLog: JsonlAgentTaskEventLog
  readonly evidenceStore: AgentTaskEvidenceStore
  private taskCreationQueue: Promise<void> = Promise.resolve()

  constructor(
    eventLog = new JsonlAgentTaskEventLog(),
    evidenceStore = new AgentTaskEvidenceStore(eventLog.rootDir),
  ) {
    this.eventLog = eventLog
    this.evidenceStore = evidenceStore
  }

  async createTask(input: CreateAgentTaskInput): Promise<AgentTask> {
    const operation = this.taskCreationQueue.then(() =>
      this.createTaskLocked(input),
    )
    this.taskCreationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async createTaskLocked(input: CreateAgentTaskInput): Promise<AgentTask> {
    const title = requireNonEmpty(input.title, 'title')
    const goal = requireNonEmpty(input.goal, 'goal')
    if (input.role && input.role !== 'software_engineer') {
      throw new AgentTaskValidationError(
        `Unsupported AgentTask role: ${input.role}`,
      )
    }

    const workspacePath = requireNonEmpty(
      input.workspacePath ?? '',
      'workspacePath',
    )
    const requiredChecks = normalizeChecks(input.requiredChecks ?? [])
    const sessionId = optionalTrimmed(input.sessionId)
    if (sessionId) {
      const activeTask = (await this.listTasks(sessionId))
        .find((task) => isActiveAgentTaskStatus(task.status))
      if (activeTask) {
        throw new AgentTaskValidationError(
          'Session ' + sessionId +
            ' already has an active AgentTask: ' + activeTask.id,
        )
      }
    }
    const now = new Date().toISOString()
    const task: AgentTask = {
      schemaVersion: 1,
      id: randomUUID(),
      runId: randomUUID(),
      attempt: 1,
      sessionId,
      role: 'software_engineer',
      title,
      goal,
      constraints: (input.constraints ?? [])
        .map((constraint) => constraint.trim())
        .filter(Boolean),
      workspacePath,
      status: 'intake',
      requiredChecks,
      warnings: [],
      recoverable: false,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    }

    await this.eventLog.append(
      {
        taskId: task.id,
        runId: task.runId,
        attempt: task.attempt,
        type: 'task_created',
        timestamp: now,
        payload: { task },
      },
      0,
    )
    return this.requireTask(task.id)
  }

  async listTasks(sessionId?: string): Promise<AgentTask[]> {
    const tasks: AgentTask[] = []
    for (const taskId of await this.eventLog.listTaskIds()) {
      const task = await this.getTask(taskId)
      if (task && (!sessionId || task.sessionId === sessionId)) {
        tasks.push(task)
      }
    }
    return tasks.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )
  }

  async getTask(taskId: string): Promise<AgentTask | null> {
    const events = await this.eventLog.readTaskEvents(taskId)
    return events.length ? reduceAgentTaskEvents(events) : null
  }

  async getTaskDetail(taskId: string): Promise<AgentTaskDetail> {
    const events = await this.eventLog.readTaskEvents(taskId)
    if (!events.length) throw new AgentTaskNotFoundError(taskId)
    const task = reduceAgentTaskEvents(events)
    const evidencePack = task.evidencePackId
      ? await this.evidenceStore.read(task.id, task.evidencePackId)
      : null
    return {
      task,
      events,
      ...(evidencePack ? { evidencePack } : {}),
    }
  }

  async transitionTask(
    taskId: string,
    to: AgentTaskStatus,
    reason?: string,
  ): Promise<AgentTask> {
    const task = await this.requireTask(taskId)
    assertAgentTaskTransition(task.status, to, task.resumeStatus)

    if (to === 'completed') return this.completeTask(taskId)

    const type: AgentTaskEventType =
      to === 'failed'
        ? 'task_failed'
        : to === 'cancelled'
          ? 'task_cancelled'
          : to === 'interrupted'
            ? 'task_interrupted'
            : 'status_changed'

    const payload =
      type === 'status_changed'
        ? { from: task.status, to, ...(reason ? { reason } : {}) }
        : { from: task.status, ...(reason ? { reason } : {}) }

    return this.appendAndProject(task, type, payload)
  }

  async recordScout(taskId: string, summary: string): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'scout')
    return this.appendAndProject(task, 'scout_recorded', {
      summary: requireNonEmpty(summary, 'scout summary'),
    })
  }

  async recordPlan(
    taskId: string,
    plan: AgentTaskPlan,
  ): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'plan')
    const normalizedPlan = normalizePlan(plan, task.requiredChecks)
    return this.appendAndProject(task, 'plan_recorded', {
      plan: normalizedPlan,
    })
  }

  async recordExecution(
    taskId: string,
    summary: string,
  ): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'execute')
    return this.appendAndProject(task, 'execution_recorded', {
      summary: requireNonEmpty(summary, 'execution summary'),
    })
  }

  async blockForPermission(
    taskId: string,
    reason: string,
  ): Promise<AgentTask> {
    let task = await this.requireTask(taskId)
    if (!isActiveAgentTaskStatus(task.status)) {
      throw new AgentTaskValidationError(
        `Cannot block AgentTask from ${task.status}`,
      )
    }

    const normalizedReason = requireNonEmpty(reason, 'permission reason')
    task = await this.appendAndProject(task, 'permission_blocked', {
      reason: normalizedReason,
    })
    return this.transitionTask(task.id, 'blocked', normalizedReason)
  }

  async resolveBlock(taskId: string): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'blocked')
    if (!task.resumeStatus) {
      throw new AgentTaskValidationError(
        'Blocked AgentTask is missing resumeStatus',
      )
    }
    return this.transitionTask(taskId, task.resumeStatus)
  }

  async recoverInterruptedTasks(): Promise<AgentTask[]> {
    const recovered: AgentTask[] = []
    for (const task of await this.listTasks()) {
      if (!isActiveAgentTaskStatus(task.status)) continue
      try {
        recovered.push(
          await this.appendAndProject(task, 'task_interrupted', {
            from: task.status,
            reason: 'server_restart',
          }),
        )
      } catch (error) {
        if (!(error instanceof AgentTaskEventConflictError)) throw error
      }
    }
    return recovered
  }

  async resumeInterruptedTask(taskId: string): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'interrupted')
    return this.appendAndProject(
      task,
      'task_resumed',
      { previousRunId: task.runId },
      { runId: randomUUID(), attempt: task.attempt + 1 },
    )
  }

  async cancelTask(taskId: string, reason?: string): Promise<AgentTask> {
    return this.transitionTask(taskId, 'cancelled', reason)
  }

  async failTask(taskId: string, reason: string): Promise<AgentTask> {
    return this.transitionTask(
      taskId,
      'failed',
      requireNonEmpty(reason, 'failure reason'),
    )
  }
  async recordVerification(
    taskId: string,
    input: RecordVerificationInput,
  ): Promise<{ task: AgentTask; evidencePack: EvidencePack }> {
    let task = await this.requireStatus(taskId, 'verify')
    validateVerificationResults(task, input.results)

    const evidencePack: EvidencePack = {
      schemaVersion: 1,
      id: randomUUID(),
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      createdAt: new Date().toISOString(),
      checks: input.results,
      changedFiles: uniqueTrimmed(input.changedFiles ?? []),
      artifacts: input.artifacts ?? [],
    }

    const requiredChecks = task.requiredChecks.filter(
      (check) => check.required,
    )
    const failedCheckIds = requiredChecks
      .filter((check) => {
        const matches = input.results.filter(
          (result) => result.checkId === check.id,
        )
        return (
          matches.length !== 1 ||
          matches[0].command !== check.command ||
          matches[0].status !== 'passed' ||
          matches[0].exitCode !== 0
        )
      })
      .map((check) => check.id)
    const passed =
      requiredChecks.length > 0 && failedCheckIds.length === 0

    await this.evidenceStore.persist(evidencePack)
    task = await this.appendAndProject(task, 'verification_finished', {
      evidencePackId: evidencePack.id,
      passed,
      failedCheckIds,
    })
    task = await this.appendAndProject(task, 'evidence_persisted', {
      evidencePackId: evidencePack.id,
    })

    task = passed
      ? await this.transitionTask(task.id, 'review')
      : await this.transitionTask(
          task.id,
          'failed',
          failedCheckIds.length
            ? `Verification failed: ${failedCheckIds.join(', ')}`
            : 'Verification failed: no required checks',
        )

    return { task, evidencePack }
  }

  async recordReview(
    taskId: string,
    input: RecordAgentTaskReviewInput,
  ): Promise<AgentTask> {
    let task = await this.requireStatus(taskId, 'review')
    task = await this.appendAndProject(task, 'review_finished', {
      review: normalizeAgentTaskReview(input),
    })
    return this.completeTask(task.id)
  }

  async completeTask(taskId: string): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'review')
    const evidence = task.evidencePackId
      ? await this.evidenceStore.read(task.id, task.evidencePackId)
      : null
    assertAgentTaskCompletion(task, evidence)
    return this.appendAndProject(task, 'task_completed', {
      evidencePackId: evidence?.id,
      reviewStatus: task.review?.status,
    })
  }

  private async appendAndProject(
    task: AgentTask,
    type: AgentTaskEventType,
    payload: Record<string, unknown>,
    envelope?: { runId: string; attempt: number },
  ): Promise<AgentTask> {
    await this.eventLog.append(
      {
        taskId: task.id,
        runId: envelope?.runId ?? task.runId,
        attempt: envelope?.attempt ?? task.attempt,
        type,
        payload,
      },
      task.revision,
    )
    return this.requireTask(task.id)
  }

  private async requireTask(taskId: string): Promise<AgentTask> {
    const task = await this.getTask(taskId)
    if (!task) throw new AgentTaskNotFoundError(taskId)
    return task
  }

  private async requireStatus(
    taskId: string,
    status: AgentTaskStatus,
  ): Promise<AgentTask> {
    const task = await this.requireTask(taskId)
    if (task.status !== status) {
      throw new AgentTaskValidationError(
        `AgentTask ${taskId} must be ${status}, found ${task.status}`,
      )
    }
    return task
  }
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new AgentTaskValidationError(`${name} is required`)
  }
  return normalized
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizeChecks(
  checks: VerificationCheckSpec[],
): VerificationCheckSpec[] {
  if (!checks.some((check) => check.required)) {
    throw new AgentTaskValidationError(
      'At least one required verification check is needed',
    )
  }

  const ids = new Set<string>()
  return checks.map((check) => {
    const id = requireNonEmpty(check.id, 'verification check id')
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new AgentTaskValidationError(
        `Invalid verification check id: ${id}`,
      )
    }
    if (ids.has(id)) {
      throw new AgentTaskValidationError(
        `Duplicate verification check id: ${id}`,
      )
    }
    ids.add(id)

    if (
      check.timeoutMs !== undefined &&
      (!Number.isFinite(check.timeoutMs) || check.timeoutMs <= 0)
    ) {
      throw new AgentTaskValidationError(
        `Invalid timeout for verification check: ${id}`,
      )
    }

    return {
      id,
      label: requireNonEmpty(check.label, `verification check ${id} label`),
      command: requireNonEmpty(
        check.command,
        `verification check ${id} command`,
      ),
      required: check.required,
      ...(check.timeoutMs ? { timeoutMs: check.timeoutMs } : {}),
    }
  })
}

function normalizePlan(
  plan: AgentTaskPlan,
  checks: VerificationCheckSpec[],
): AgentTaskPlan {
  const verificationCheckIds = uniqueTrimmed(plan.verificationCheckIds)
  const knownIds = new Set(checks.map((check) => check.id))
  for (const checkId of verificationCheckIds) {
    if (!knownIds.has(checkId)) {
      throw new AgentTaskValidationError(
        `Plan references unknown verification check: ${checkId}`,
      )
    }
  }

  const steps = uniqueTrimmed(plan.steps)
  if (!steps.length) {
    throw new AgentTaskValidationError('plan steps are required')
  }

  return {
    summary: requireNonEmpty(plan.summary, 'plan summary'),
    steps,
    verificationCheckIds,
  }
}

function validateVerificationResults(
  task: AgentTask,
  results: VerificationResult[],
): void {
  const specs = new Map(
    task.requiredChecks.map((check) => [check.id, check]),
  )
  const seen = new Set<string>()

  for (const result of results) {
    if (seen.has(result.checkId)) {
      throw new AgentTaskValidationError(
        `Duplicate verification result: ${result.checkId}`,
      )
    }
    seen.add(result.checkId)

    const spec = specs.get(result.checkId)
    if (!spec) {
      throw new AgentTaskValidationError(
        `Unknown verification result: ${result.checkId}`,
      )
    }
    if (result.command !== spec.command) {
      throw new AgentTaskValidationError(
        `Verification command mismatch: ${result.checkId}`,
      )
    }
    if (
      (result.status === 'passed' && result.exitCode !== 0) ||
      (result.status === 'failed' && result.exitCode === 0)
    ) {
      throw new AgentTaskValidationError(
        `Verification status conflicts with exit code: ${result.checkId}`,
      )
    }
    if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
      throw new AgentTaskValidationError(
        `Invalid verification duration: ${result.checkId}`,
      )
    }
  }
}
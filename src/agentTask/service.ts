import { randomUUID } from 'crypto'
import { buildAgentTaskDefinitionSnapshot } from './definitionSnapshot.js'
import { assertAgentTaskCompletion } from './completionPolicy.js'
import { AgentTaskEvidenceStore } from './evidence/evidenceStore.js'
import { buildKnowledgeCandidatePack } from './knowledge/knowledgeCandidatePack.js'
import { AgentTaskKnowledgeCandidateStore } from './knowledge/knowledgeCandidateStore.js'
import { AgentTaskProvenanceStore } from './provenance/provenanceStore.js'
import {
  isSourceBackedArtifactRole,
  resolveAgentTaskRolePack,
} from './rolePacks.js'
import {
  resolveAgentTaskTeamTemplate,
  resolveAgentTaskTemplate,
} from './teamTemplates.js'
import { deriveWorkspaceId } from './workspaceId.js'
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
  AgentTaskAssistantOverlaySnapshot,
  AgentTaskDetail,
  AgentTaskEventType,
  AgentTaskPlan,
  AgentTaskStatus,
  CreateAgentTaskInput,
  EvidenceArtifact,
  EvidencePack,
  KnowledgeContext,
  KnowledgeContextItem,
  SourceLocator,
  WorkspaceKnowledgeItem,
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeMap,
  WorkspaceKnowledgeTask,
  VerificationCheckSpec,
  VerificationResult,
} from './types.js'

export type RecordVerificationInput = {
  results: VerificationResult[]
  changedFiles?: string[]
  artifacts?: EvidenceArtifact[]
}

const MAX_KNOWLEDGE_TASKS_SCANNED = 500
const MAX_KNOWLEDGE_MAP_TASKS = 50
const MAX_KNOWLEDGE_MAP_CONFLICTS = 50
const MAX_KNOWLEDGE_MAP_SOURCES = 100
const MAX_KNOWLEDGE_MAP_ARTIFACTS = 100
const MAX_KNOWLEDGE_MAP_ITEMS = 100

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
  readonly provenanceStore: AgentTaskProvenanceStore
  readonly knowledgeCandidateStore: AgentTaskKnowledgeCandidateStore
  private sessionActivationQueue: Promise<void> = Promise.resolve()

  constructor(
    eventLog = new JsonlAgentTaskEventLog(),
    evidenceStore = new AgentTaskEvidenceStore(eventLog.rootDir),
    provenanceStore = new AgentTaskProvenanceStore(eventLog.rootDir),
    knowledgeCandidateStore = new AgentTaskKnowledgeCandidateStore(
      eventLog.rootDir,
    ),
  ) {
    this.eventLog = eventLog
    this.evidenceStore = evidenceStore
    this.provenanceStore = provenanceStore
    this.knowledgeCandidateStore = knowledgeCandidateStore
  }

  async createTask(input: CreateAgentTaskInput): Promise<AgentTask> {
    const operation = this.sessionActivationQueue.then(() =>
      this.createTaskLocked(input),
    )
    this.sessionActivationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async createTaskLocked(input: CreateAgentTaskInput): Promise<AgentTask> {
    const title = requireNonEmpty(input.title, 'title')
    const goal = requireNonEmpty(input.goal, 'goal')
    const teamId = input.teamId === undefined
      ? undefined
      : requireNonEmpty(input.teamId, 'teamId')
    const taskTemplateId = input.taskTemplateId === undefined
      ? undefined
      : requireNonEmpty(input.taskTemplateId, 'taskTemplateId')
    if (taskTemplateId && !teamId) {
      throw new AgentTaskValidationError(
        'taskTemplateId requires teamId',
      )
    }
    const teamTemplate = resolveAgentTaskTeamTemplate(teamId)
    if (teamId && !teamTemplate) {
      throw new AgentTaskValidationError(
        `Unsupported AgentTask team: ${teamId}`,
      )
    }
    const taskTemplate = teamTemplate
      ? resolveAgentTaskTemplate(teamTemplate, taskTemplateId)
      : null
    if (teamTemplate && taskTemplateId && !taskTemplate) {
      throw new AgentTaskValidationError(
        `Unsupported task template ${taskTemplateId} for team ${teamTemplate.id}`,
      )
    }
    const roleId = input.role === undefined
      ? teamTemplate?.primaryRole
      : requireNonEmpty(input.role, 'role')
    const rolePack = resolveAgentTaskRolePack(roleId)
    if (!rolePack) {
      throw new AgentTaskValidationError(
        `Unsupported AgentTask role: ${input.role}`,
      )
    }
    if (teamTemplate && rolePack.id !== teamTemplate.primaryRole) {
      throw new AgentTaskValidationError(
        'AgentTask role must match the selected team primary role',
      )
    }
    if (taskTemplate && rolePack.id !== taskTemplate.primaryRole) {
      throw new AgentTaskValidationError(
        'AgentTask role must match the selected task template primary role',
      )
    }
    if (
      taskTemplate?.kind === 'independent_review' &&
      input.relation !== 'review'
    ) {
      throw new AgentTaskValidationError(
        'Independent review template requires a review parent relation',
      )
    }
    if (
      taskTemplate?.kind === 'delivery' &&
      input.relation === 'review'
    ) {
      throw new AgentTaskValidationError(
        'Delivery template cannot be used for an independent review task',
      )
    }
    const workspacePath = requireNonEmpty(
      input.workspacePath ?? '',
      'workspacePath',
    )
    const legacyAssistantId = optionalTrimmed(input.assistantId)
    const legacyAssistantName = optionalTrimmed(input.assistantName)
    if (Boolean(legacyAssistantId) !== Boolean(legacyAssistantName)) {
      throw new AgentTaskValidationError(
        'assistantId and assistantName must be provided together',
      )
    }
    let assistantOverlay: AgentTaskAssistantOverlaySnapshot | undefined
    if (input.assistantOverlay) {
      const id = requireNonEmpty(input.assistantOverlay.id, 'assistantOverlay.id')
      const name = requireNonEmpty(
        input.assistantOverlay.name,
        'assistantOverlay.name',
      )
      const instructions = requireNonEmpty(
        input.assistantOverlay.instructions,
        'assistantOverlay.instructions',
      )
      const sourceUpdatedAt = requireNonEmpty(
        input.assistantOverlay.sourceUpdatedAt,
        'assistantOverlay.sourceUpdatedAt',
      )
      if (input.assistantOverlay.baseRole !== rolePack.id) {
        throw new AgentTaskValidationError(
          'Assistant Overlay base role must match the AgentTask role',
        )
      }
      if (!Number.isFinite(Date.parse(sourceUpdatedAt))) {
        throw new AgentTaskValidationError(
          'Assistant Overlay sourceUpdatedAt must be a valid timestamp',
        )
      }
      if (instructions.length > 4_000) {
        throw new AgentTaskValidationError(
          'Assistant Overlay instructions are too long',
        )
      }
      if (
        (legacyAssistantId && legacyAssistantId !== id) ||
        (legacyAssistantName && legacyAssistantName !== name)
      ) {
        throw new AgentTaskValidationError(
          'Assistant Overlay conflicts with assistant metadata',
        )
      }
      assistantOverlay = {
        id,
        name,
        baseRole: rolePack.id,
        sourceUpdatedAt,
        instructions,
      }
    }
    const assistantId = assistantOverlay?.id ?? legacyAssistantId
    const assistantName = assistantOverlay?.name ?? legacyAssistantName
    if ((assistantId?.length ?? 0) > 100 || (assistantName?.length ?? 0) > 80) {
      throw new AgentTaskValidationError(
        'AgentTask assistant metadata is too long',
      )
    }
    const requiredChecks = input.requiredChecks?.length
      ? normalizeChecks(input.requiredChecks)
      : []
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
    const parentTaskId = optionalTrimmed(input.parentTaskId)
    if (Boolean(parentTaskId) !== Boolean(input.relation)) {
      throw new AgentTaskValidationError(
        'parentTaskId and relation must be provided together',
      )
    }
    if (parentTaskId) {
      const parent = await this.getTask(parentTaskId)
      if (!parent) throw new AgentTaskNotFoundError(parentTaskId)
      if (input.relation !== 'review') {
        throw new AgentTaskValidationError('Unsupported AgentTask relation')
      }
      if (parent.status !== 'completed') {
        throw new AgentTaskValidationError(
          'Review task parent must be completed',
        )
      }
      if (!sessionId || parent.sessionId !== sessionId) {
        throw new AgentTaskValidationError(
          'Review task parent must belong to the same session',
        )
      }
      if (
        !parent.workspacePath ||
        await deriveWorkspaceId(parent.workspacePath) !==
          await deriveWorkspaceId(workspacePath)
      ) {
        throw new AgentTaskValidationError(
          'Review task parent must belong to the same workspace',
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
      role: rolePack.id,
      roleVersion: rolePack.version,
      definitionSnapshot: buildAgentTaskDefinitionSnapshot(rolePack, {
        assistant: assistantOverlay,
        team: teamTemplate
          ? { id: teamTemplate.id, version: teamTemplate.version }
          : undefined,
        taskTemplate: taskTemplate
          ? { id: taskTemplate.id, version: taskTemplate.version }
          : undefined,
        capabilities: taskTemplate?.capabilities,
      }),
      ...(assistantId && assistantName ? { assistantId, assistantName } : {}),
      ...(parentTaskId && input.relation
        ? { parentTaskId, relation: input.relation }
        : {}),
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
    const provenancePack = await this.provenanceStore.readLatest(
      task.id,
      task.runId,
      task.attempt,
    )
    const knowledgeCandidatePack = await this.knowledgeCandidateStore
      .readLatest(task.id, task.runId, task.attempt)
    return {
      task,
      events,
      ...(evidencePack ? { evidencePack } : {}),
      ...(provenancePack ? { provenancePack } : {}),
      ...(knowledgeCandidatePack ? { knowledgeCandidatePack } : {}),
    }
  }

  async recallKnowledge(
    taskId: string,
    query?: string,
    limit = 5,
  ): Promise<KnowledgeContext> {
    const task = await this.requireTask(taskId)
    const normalizedQuery = query?.trim() || task.goal.trim()
    if (normalizedQuery.length > 2_000) {
      throw new AgentTaskValidationError(
        'AgentTask knowledge query must be at most 2000 characters',
      )
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new AgentTaskValidationError(
        'AgentTask knowledge limit must be an integer from 1 to 20',
      )
    }

    const workspaceId = await deriveWorkspaceId(task.workspacePath ?? '')
    const matches: Array<KnowledgeContextItem & { score: number }> = []

    // ponytail: linear local scan; add an index only when measured task volume
    // makes recall latency visible.
    const completedTasks = (await this.listTasks())
      .filter((sourceTask) => sourceTask.status === 'completed')
    const sourceTasks = await filterTasksByWorkspace(
      completedTasks,
      workspaceId,
    )
    for (const sourceTask of sourceTasks.slice(
      0,
      MAX_KNOWLEDGE_TASKS_SCANNED,
    )) {
      if (sourceTask.id === task.id) continue
      const pack = await this.knowledgeCandidateStore.readLatest(
        sourceTask.id,
        sourceTask.runId,
        sourceTask.attempt,
      )
      if (!pack || pack.workspaceId !== workspaceId) continue

      for (const candidate of pack.candidates) {
        const score = scoreKnowledgeCandidate(
          normalizedQuery,
          sourceTask.title + '\n' + candidate.text,
        )
        if (!score) continue
        matches.push({
          candidateId: candidate.id,
          kind: candidate.kind,
          state: candidate.state,
          text: candidate.text,
          createdAt: candidate.createdAt,
          sourceTaskId: sourceTask.id,
          sourceTaskTitle: sourceTask.title,
          evidencePackId: pack.evidencePackId,
          ...(pack.provenancePackId
            ? { provenancePackId: pack.provenancePackId }
            : {}),
          artifactPaths: pack.artifactPaths,
          score,
        })
      }
    }

    return {
      query: normalizedQuery,
      truncated: sourceTasks.length > MAX_KNOWLEDGE_TASKS_SCANNED,
      items: matches
        .sort((left, right) =>
          right.score - left.score ||
          right.createdAt.localeCompare(left.createdAt) ||
          left.candidateId.localeCompare(right.candidateId),
        )
        .slice(0, limit)
        .map(({ score: _score, ...item }) => item),
    }
  }

  async getKnowledgeMap(taskId: string): Promise<WorkspaceKnowledgeMap> {
    const task = await this.requireTask(taskId)
    return this.getWorkspaceKnowledgeMap(task.workspacePath ?? '')
  }

  async getWorkspaceKnowledgeMap(
    workspacePath: string,
  ): Promise<WorkspaceKnowledgeMap> {
    const workspaceId = await deriveWorkspaceId(workspacePath)
    const completedTasks = (await this.listTasks())
      .filter((sourceTask) => sourceTask.status === 'completed')
    const workspaceTasks = await filterTasksByWorkspace(
      completedTasks,
      workspaceId,
    )
    const records: WorkspaceKnowledgeTask[] = []
    const sources = new Map<string, WorkspaceKnowledgeSource>()
    const knowledgeItems: WorkspaceKnowledgeItem[] = []
    const artifactTasks = new Map<
      string,
      { path: string; taskIds: string[] }
    >()

    for (const sourceTask of workspaceTasks.slice(
      0,
      MAX_KNOWLEDGE_TASKS_SCANNED,
    )) {
      const pack = await this.knowledgeCandidateStore.readLatest(
        sourceTask.id,
        sourceTask.runId,
        sourceTask.attempt,
      )
      if (!pack || pack.workspaceId !== workspaceId) continue
      const provenance = await this.provenanceStore.readLatest(
        sourceTask.id,
        sourceTask.runId,
        sourceTask.attempt,
      )
      records.push({
        taskId: sourceTask.id,
        ...(sourceTask.sessionId ? { sessionId: sourceTask.sessionId } : {}),
        title: sourceTask.title,
        role: sourceTask.role,
        ...(sourceTask.assistantName
          ? { assistantName: sourceTask.assistantName }
          : {}),
        ...(sourceTask.parentTaskId
          ? { parentTaskId: sourceTask.parentTaskId }
          : {}),
        ...(sourceTask.relation ? { relation: sourceTask.relation } : {}),
        completedAt: sourceTask.updatedAt,
        candidateCount: pack.candidates.length,
        sourceCount: provenance?.sources.length ?? 0,
        artifactPaths: pack.artifactPaths,
      })

      for (const candidate of pack.candidates) {
        knowledgeItems.push({
          ...candidate,
          taskId: sourceTask.id,
          taskTitle: sourceTask.title,
        })
      }

      for (const source of provenance?.sources ?? []) {
        const key = knowledgeSourceKey(source.locator)
        const entry = sources.get(key) ?? {
          sourceId: source.id,
          title: source.title,
          kind: source.locator.kind,
          locator: source.locator,
          observedAt: source.observedAt,
          taskIds: [],
        }
        if (source.observedAt > entry.observedAt) {
          entry.sourceId = source.id
          entry.title = source.title
          entry.locator = source.locator
          entry.observedAt = source.observedAt
        }
        if (!entry.taskIds.includes(sourceTask.id)) {
          entry.taskIds.push(sourceTask.id)
        }
        sources.set(key, entry)
      }

      for (const artifactPath of pack.artifactPaths) {
        const key = knowledgeArtifactKey(artifactPath)
        const entry = artifactTasks.get(key) ?? {
          path: artifactPath,
          taskIds: [],
        }
        if (!entry.taskIds.includes(sourceTask.id)) {
          entry.taskIds.push(sourceTask.id)
        }
        artifactTasks.set(key, entry)
      }
    }

    const artifacts = [...artifactTasks.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
    const potentialConflicts = artifacts
      .filter((entry) => entry.taskIds.length > 1)
      .map((entry) => ({
        kind: 'shared_artifact_path' as const,
        artifactPath: entry.path,
        taskIds: entry.taskIds,
      }))
    const sourceRecords = [...sources.values()]
      .sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt) ||
        left.title.localeCompare(right.title),
      )
    const sortedKnowledgeItems = knowledgeItems
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id),
      )
    records.sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt) ||
      left.taskId.localeCompare(right.taskId),
    )

    return {
      workspaceId,
      generatedAt: new Date().toISOString(),
      summary: {
        taskCount: records.length,
        candidateCount: records.reduce(
          (total, record) => total + record.candidateCount,
          0,
        ),
        sourceCount: records.reduce(
          (total, record) => total + record.sourceCount,
          0,
        ),
        artifactCount: artifactTasks.size,
        potentialConflictCount: potentialConflicts.length,
        truncated:
          workspaceTasks.length > MAX_KNOWLEDGE_TASKS_SCANNED ||
          records.length > MAX_KNOWLEDGE_MAP_TASKS ||
          sourceRecords.length > MAX_KNOWLEDGE_MAP_SOURCES ||
          artifacts.length > MAX_KNOWLEDGE_MAP_ARTIFACTS ||
          sortedKnowledgeItems.length > MAX_KNOWLEDGE_MAP_ITEMS ||
          potentialConflicts.length > MAX_KNOWLEDGE_MAP_CONFLICTS,
      },
      tasks: records.slice(0, MAX_KNOWLEDGE_MAP_TASKS),
      sources: sourceRecords.slice(0, MAX_KNOWLEDGE_MAP_SOURCES),
      artifacts: artifacts.slice(0, MAX_KNOWLEDGE_MAP_ARTIFACTS),
      knowledgeItems: sortedKnowledgeItems.slice(
        0,
        MAX_KNOWLEDGE_MAP_ITEMS,
      ),
      potentialConflicts: potentialConflicts.slice(
        0,
        MAX_KNOWLEDGE_MAP_CONFLICTS,
      ),
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
    requiredChecks?: VerificationCheckSpec[],
  ): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'plan')
    const checks = task.requiredChecks.length
      ? task.requiredChecks
      : normalizeChecks(requiredChecks ?? [])
    const normalizedPlan = normalizePlan(plan, checks)
    return this.appendAndProject(task, 'plan_recorded', {
      plan: normalizedPlan,
      requiredChecks: checks,
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
    const operation = this.sessionActivationQueue.then(() =>
      this.resumeInterruptedTaskLocked(taskId),
    )
    this.sessionActivationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async resumeInterruptedTaskLocked(
    taskId: string,
  ): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'interrupted')
    if (task.sessionId) {
      const activeTask = (await this.listTasks(task.sessionId))
        .find((candidate) => (
          candidate.id !== task.id &&
          isActiveAgentTaskStatus(candidate.status)
        ))
      if (activeTask) {
        throw new AgentTaskValidationError(
          'Session ' + task.sessionId +
            ' already has an active AgentTask: ' + activeTask.id,
        )
      }
    }
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
    const artifacts = normalizeArtifacts(input.artifacts ?? [])
    if (isSourceBackedArtifactRole(task.role) && artifacts.length === 0) {
      throw new AgentTaskValidationError(
        (resolveAgentTaskRolePack(task.role)?.displayName ?? task.role) +
          ' verification requires at least one artifact',
      )
    }

    const evidencePack: EvidencePack = {
      schemaVersion: 1,
      id: randomUUID(),
      taskId: task.id,
      runId: task.runId,
      attempt: task.attempt,
      createdAt: new Date().toISOString(),
      checks: input.results,
      changedFiles: uniqueTrimmed(input.changedFiles ?? []),
      artifacts,
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
    if (isSourceBackedArtifactRole(task.role)) {
      const provenance = await this.provenanceStore.readLatest(
        task.id,
        task.runId,
        task.attempt,
      )
      if (!provenance) {
        throw new AgentTaskValidationError(
          (resolveAgentTaskRolePack(task.role)?.displayName ?? task.role) +
            ' review requires a Provenance Pack',
        )
      }
    }
    task = await this.appendAndProject(task, 'review_finished', {
      review: normalizeAgentTaskReview(input),
    })
    const detail = await this.getTaskDetail(task.id)
    if (!detail.evidencePack) {
      throw new AgentTaskValidationError(
        'AgentTask Evidence Pack is required for knowledge candidates',
      )
    }
    const knowledgeCandidatePack = await buildKnowledgeCandidatePack(
      task,
      detail.evidencePack,
      detail.provenancePack,
    )
    await this.knowledgeCandidateStore.persist(knowledgeCandidatePack)
    return this.completeTask(task.id)
  }

  async completeTask(taskId: string): Promise<AgentTask> {
    const task = await this.requireStatus(taskId, 'review')
    const evidence = task.evidencePackId
      ? await this.evidenceStore.read(task.id, task.evidencePackId)
      : null
    assertAgentTaskCompletion(task, evidence)
    const knowledgeCandidatePack = await this.knowledgeCandidateStore
      .readLatest(task.id, task.runId, task.attempt)
    if (
      !knowledgeCandidatePack ||
      knowledgeCandidatePack.evidencePackId !== evidence?.id
    ) {
      throw new AgentTaskValidationError(
        'AgentTask Knowledge Candidate Pack is required for completion',
      )
    }
    if (
      isSourceBackedArtifactRole(task.role) &&
      !knowledgeCandidatePack.provenancePackId
    ) {
      throw new AgentTaskValidationError(
        (resolveAgentTaskRolePack(task.role)?.displayName ?? task.role) +
          ' completion requires a Provenance Pack',
      )
    }
    return this.appendAndProject(task, 'task_completed', {
      evidencePackId: evidence?.id,
      knowledgeCandidatePackId: knowledgeCandidatePack.id,
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

function normalizeArtifacts(
  artifacts: EvidenceArtifact[],
): EvidenceArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    label: requireNonEmpty(artifact.label, 'evidence artifact label'),
    path: requireNonEmpty(artifact.path, 'evidence artifact path'),
  }))
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

async function filterTasksByWorkspace(
  tasks: AgentTask[],
  workspaceId: string,
): Promise<AgentTask[]> {
  const matches: AgentTask[] = []
  const workspaceIds = new Map<string, string | null>()
  for (const task of tasks) {
    if (!task.workspacePath) continue
    let taskWorkspaceId = workspaceIds.get(task.workspacePath)
    if (!workspaceIds.has(task.workspacePath)) {
      try {
        taskWorkspaceId = await deriveWorkspaceId(task.workspacePath)
      } catch {
        taskWorkspaceId = null
      }
      workspaceIds.set(task.workspacePath, taskWorkspaceId ?? null)
    }
    if (taskWorkspaceId === workspaceId) matches.push(task)
  }
  return matches
}

function scoreKnowledgeCandidate(query: string, value: string): number {
  const normalizedQuery = query.normalize('NFKC').toLowerCase()
  const normalizedValue = value.normalize('NFKC').toLowerCase()
  let score = normalizedValue.includes(normalizedQuery) ? 1_000 : 0
  const terms = [...new Set(
    normalizedQuery.match(/[\p{L}\p{N}_-]+/gu) ?? [],
  )]

  for (const term of terms) {
    if (normalizedValue.includes(term)) score += 100 + term.length
    if (!/[^\x00-\x7F]/.test(term)) continue
    const characters = Array.from(term)
    let bigramMatches = 0
    for (let index = 0; index < characters.length - 1; index += 1) {
      if (normalizedValue.includes(characters[index] + characters[index + 1])) {
        bigramMatches += 1
      }
    }
    if (bigramMatches >= 2) score += bigramMatches
  }

  return score
}

function knowledgeSourceKey(locator: SourceLocator): string {
  switch (locator.kind) {
    case 'file':
      return 'file:' + knowledgeArtifactKey(locator.path)
    case 'attachment':
      return 'attachment:' + (
        locator.path
          ? knowledgeArtifactKey(locator.path)
          : locator.messageId + ':' + locator.attachmentIndex
      )
    case 'message':
      return 'message:' + locator.messageId
    case 'tool_result':
      return 'tool_result:' + locator.toolUseId
    case 'url':
      return 'url:' + locator.url.trim().normalize('NFC')
  }
}

function knowledgeArtifactKey(path: string): string {
  const normalized = path.trim().normalize('NFC').replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
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

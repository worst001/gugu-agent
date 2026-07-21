import { isSourceBackedArtifactRole } from './rolePacks.js'
import type { AgentTask, EvidencePack } from './types.js'

export type CompletionAssessment = {
  ok: boolean
  errors: string[]
}

export function assessAgentTaskCompletion(
  task: AgentTask,
  evidence: EvidencePack | null,
): CompletionAssessment {
  const errors: string[] = []

  if (task.status !== 'review') {
    errors.push('Task must be in review before completion')
  }

  if (!task.review) {
    errors.push('Review outcome must be persisted before completion')
  }

  if (!evidence) {
    errors.push('Evidence Pack is missing')
    return { ok: false, errors }
  }

  if (
    evidence.taskId !== task.id ||
    evidence.runId !== task.runId ||
    evidence.attempt !== task.attempt
  ) {
    errors.push('Evidence Pack identity does not match the active attempt')
  }

  if (task.evidencePackId !== evidence.id) {
    errors.push('Evidence Pack is not linked by a persisted event')
  }

  if (
    isSourceBackedArtifactRole(task.role) &&
    evidence.artifacts.length === 0
  ) {
    errors.push('Source-backed task Evidence Pack must include an artifact')
  }

  const requiredChecks = task.requiredChecks.filter((check) => check.required)
  if (requiredChecks.length === 0) {
    errors.push('At least one required verification check is needed')
  }

  for (const check of requiredChecks) {
    const results = evidence.checks.filter(
      (result) => result.checkId === check.id,
    )
    if (results.length !== 1) {
      errors.push(
        `Required check ${check.id} must have exactly one result`,
      )
      continue
    }

    const result = results[0]
    if (result.command !== check.command) {
      errors.push(`Required check ${check.id} command does not match`)
    }
    if (result.status !== 'passed' || result.exitCode !== 0) {
      errors.push(`Required check ${check.id} did not pass`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export function assertAgentTaskCompletion(
  task: AgentTask,
  evidence: EvidencePack | null,
): void {
  const assessment = assessAgentTaskCompletion(task, evidence)
  if (!assessment.ok) {
    throw new Error(
      `AgentTask completion rejected: ${assessment.errors.join('; ')}`,
    )
  }
}
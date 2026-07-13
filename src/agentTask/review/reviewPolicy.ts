import type {
  AgentTaskReview,
  AgentTaskReviewStatus,
} from '../types.js'

export type RecordAgentTaskReviewInput = {
  status: AgentTaskReviewStatus
  summary?: string
  findings?: string[]
  completedAt?: string
}

export function normalizeAgentTaskReview(
  input: RecordAgentTaskReviewInput,
): AgentTaskReview {
  const summary = input.summary?.trim()
  return {
    status: input.status,
    summary:
      summary ||
      (input.status === 'unavailable'
        ? 'Reviewer unavailable; deterministic verification still applies.'
        : 'Review completed without a summary.'),
    findings: (input.findings ?? [])
      .map((finding) => finding.trim())
      .filter(Boolean),
    completedAt: input.completedAt ?? new Date().toISOString(),
  }
}
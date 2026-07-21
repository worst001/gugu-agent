import { randomUUID } from 'crypto'
import type {
  AgentTask,
  EvidencePack,
  KnowledgeCandidate,
  KnowledgeCandidateKind,
  KnowledgeCandidatePack,
  ProvenancePack,
} from '../types.js'
import { deriveWorkspaceId } from '../workspaceId.js'

const MAX_CANDIDATE_TEXT_CHARS = 2_000
const MAX_REVIEW_FINDINGS = 20
const MAX_ARTIFACT_PATHS = 100

export class AgentTaskKnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTaskKnowledgeValidationError'
  }
}

function boundedText(value: string): string {
  return value.trim().slice(0, MAX_CANDIDATE_TEXT_CHARS)
}

function assertPackIdentity(
  task: AgentTask,
  pack: EvidencePack | ProvenancePack,
  label: string,
): void {
  if (
    pack.taskId !== task.id ||
    pack.runId !== task.runId ||
    pack.attempt !== task.attempt
  ) {
    throw new AgentTaskKnowledgeValidationError(
      `${label} does not belong to the current AgentTask attempt`,
    )
  }
}

function candidate(
  kind: KnowledgeCandidateKind,
  text: string,
  createdAt: string,
): KnowledgeCandidate {
  return {
    id: randomUUID(),
    kind,
    state: 'pending',
    text,
    createdAt,
  }
}

export async function buildKnowledgeCandidatePack(
  task: AgentTask,
  evidence: EvidencePack,
  provenance?: ProvenancePack,
): Promise<KnowledgeCandidatePack> {
  if (!task.review) {
    throw new AgentTaskKnowledgeValidationError('AgentTask review is required')
  }
  const outcome = boundedText(task.executionSummary ?? '')
  if (!outcome) {
    throw new AgentTaskKnowledgeValidationError(
      'AgentTask execution summary is required',
    )
  }
  assertPackIdentity(task, evidence, 'Evidence Pack')
  if (provenance) assertPackIdentity(task, provenance, 'Provenance Pack')

  // ponytail: bounded pending candidates avoid local growth; add chunking only
  // when measured retrieval quality requires longer task summaries.
  const findings = [...new Set(
    task.review.findings.map(boundedText).filter(Boolean),
  )].slice(0, MAX_REVIEW_FINDINGS)
  const createdAt = task.review.completedAt

  return {
    schemaVersion: 1,
    id: randomUUID(),
    taskId: task.id,
    runId: task.runId,
    attempt: task.attempt,
    workspaceId: provenance?.workspaceId ?? await deriveWorkspaceId(
      task.workspacePath ?? '',
    ),
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    evidencePackId: evidence.id,
    ...(provenance ? { provenancePackId: provenance.id } : {}),
    artifactPaths: [...new Set(
      evidence.artifacts.map((artifact) => artifact.path.trim()).filter(Boolean),
    )].slice(0, MAX_ARTIFACT_PATHS),
    createdAt,
    candidates: [
      candidate('task_outcome', outcome, createdAt),
      ...findings.map((finding) =>
        candidate('review_finding', finding, createdAt),
      ),
    ],
  }
}

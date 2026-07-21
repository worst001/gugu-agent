# ADR-0007: Local Knowledge Candidates

## Status

Accepted for the P7 task knowledge foundation.

## Context

Completed AgentTasks already retain events, verification Evidence, and optional
source Provenance. The next task should be able to reuse useful outcomes, but a
task summary or review finding is not automatically trusted knowledge. Treating
model-generated text as accepted memory would amplify mistakes across tasks.

## Decision

Persist a versioned `KnowledgeCandidatePack` for each completed task attempt.
Version 1 deterministically creates bounded `pending` candidates only from the
persisted execution summary and review findings. It performs no additional
model extraction and makes no claim that a candidate is approved or generally
true.

Each Pack is scoped by task, run, attempt, and opaque Workspace ID. It links to
the current Evidence Pack, optional Provenance Pack, Session, and artifact paths.
These are Pack-level trace links, not sentence-level support claims.

Candidate Packs remain under the local AgentTask root. Writes use a temporary
file, flush, and atomic rename. The service reads only the current run and
attempt, fails closed on malformed or cross-task files, and restores Packs after
process restart.

Review is recorded before candidate construction. Candidate persistence happens
before the final completion event, and completion requires a Candidate Pack
bound to the current Evidence Pack. This leaves a failed write in the retryable
review state instead of reporting a completed task without its candidates.

## Consequences

- Task completion now guarantees Evidence, review, and local pending candidates.
- Existing completed tasks may have no Candidate Pack; detail reads remain
  backward compatible.
- Candidates are inspectable through AgentTask detail but are not yet injected
  into model context or presented as accepted knowledge.
- No graph database, vector database, gateway, or cloud synchronization is
  introduced.

## Rejected Alternatives

- Model-based entity extraction at completion: rejected until precision can be
  measured against reviewed candidate data.
- Automatically accept review findings as reusable knowledge: rejected because
  review availability is not a truth or permission decision.
- Store candidates in AgentTask events: rejected to keep replay events compact
  and preserve the separate lifecycle of derived local data.

## Revision Trigger

PR6 may add local retrieval over reviewed candidates. Candidate acceptance,
conflict/version handling, retention, and knowledge-map projections remain PR7
work and require measured usage rather than speculative schema expansion.

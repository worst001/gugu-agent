# ADR-0003: Evidence-First Completion

## Status

Accepted for P0-C.

## Context

Process success alone is not proof that requested work is correct. The repository already records command exit codes for scheduled runs in `src/server/services/cronScheduler.ts` and exposes `exitCode` in `desktop/src/types/task.ts`, but the existing CLI Task model in `src/utils/tasks.ts` can be marked `completed` without a persisted verification contract.

Durable Agent completion needs a deterministic rule that can be replayed and audited after the process exits.

## Decision

An `AgentTask` may transition to `completed` only when both conditions are true for the same `runId` and `attempt`:

1. Every check declared `required` before verification finishes with `exitCode = 0`.
2. The resulting `Evidence` record is durably persisted successfully.

The completion sequence is fixed:

1. Persist each required check result, including command identity, working directory, start/end times, `exitCode`, and output or artifact references.
2. Build and persist `Evidence` with the task/run/attempt correlations and all required check results.
3. Append `evidence_persisted` to the event log.
4. Only then append the `completed` event.

Planned Evidence location and implementation paths, not present at the time of this ADR:

```text
<CLAUDE_CONFIG_DIR or ~/.claude>/agent-tasks/<agentTaskId>/attempts/<attempt>/evidence.json
```

- `src/agentTask/evidence/evidenceStore.ts` (planned)
- `src/agentTask/completionPolicy.ts` (planned)

Evidence persistence uses a temporary file followed by close and atomic rename. If any required check is non-zero, record verification failure and do not complete. If Evidence persistence or its event append fails, leave the task non-completed and retryable; an in-memory Evidence object is insufficient.

Checks marked optional may produce warnings but do not affect completion. Review output is governed separately by ADR-0004 and is not a deterministic required check.

## Consequences

- `completed` has one machine-checkable meaning across UI, restart, and replay.
- A successful agent process, persuasive summary, or passing optional check cannot bypass required checks.
- Evidence write failures may delay completion even after checks pass; retry must be idempotent for the same attempt.
- Check definitions must distinguish `required` from `optional` before execution.

## Rejected Alternatives

- Complete when the agent says it is done: rejected because natural language is not deterministic evidence.
- Complete on process exit code alone: rejected because the process exit does not represent all task-specific checks.
- Persist Evidence after `completed`: rejected because a crash between the two writes creates an unverifiable completed task.
- Let review verdict replace checks: rejected because review is probabilistic and may be unavailable.

## Rollback/Revision Trigger

Turning off the feature flag prevents new Agent completions while leaving prior Evidence readable. Revise the rule only when a new deterministic check type has equally explicit success semantics, or when the storage layer provides a stronger atomic transaction spanning Evidence and the event log; never relax completion to depend on unpersisted or natural-language claims.

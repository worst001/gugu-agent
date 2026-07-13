# ADR-0002: Append-Only Event Log Storage

## Status

Accepted for P0-C.

## Context

Current CLI tasks live under `~/.claude/tasks` and are deliberately clearable by `resetTaskList()` in `src/utils/tasks.ts`; `src/server/api/agents.ts` exposes that reset operation. They therefore cannot be the recovery log for durable Agent execution. The repository already uses JSONL for session transcripts under `~/.claude/projects`, as documented and read by `src/server/services/sessionService.ts`, so JSONL is an established local storage format.

## Decision

Persist Agent lifecycle events as append-only JSONL, outside `~/.claude/tasks`:

```text
<CLAUDE_CONFIG_DIR or ~/.claude>/agent-tasks/<agentTaskId>/events.jsonl
```

This runtime path is planned and does not exist yet. The planned code owner is `src/agentTask/events/jsonlEventLog.ts` (planned).

Each event contains at least `eventId`, `taskId`, `sessionId`, `taskListId`, `runId`, `attempt`, `sequence`, `type`, `occurredAt`, and a versioned payload. `sequence` is monotonically increasing per Agent task. Appends for one task are serialized.

Replay rules are:

1. Apply events in file order and require contiguous sequence numbers.
2. Treat a repeated `eventId` with the same sequence and content as an idempotent duplicate and apply it once.
3. Treat a reused sequence or `eventId` with different content, a sequence gap, or malformed non-tail line as corruption. Stop before the bad event, emit a warning, and never infer `completed` from the damaged suffix.
4. Ignore only a malformed or incomplete final line, preserving all prior valid events and surfacing a tail-corruption warning.

After replay, a `started` run with no terminal event (`completed`, `failed`, or `cancelled`) becomes `interrupted` with `recoverable = true`. Before retrying, persist a `run_interrupted` event; the retry increments `attempt` and uses a new `runId`.

Version 1 recovers durable state and permits a clean retry. It does not restore uncommitted workspace contents, terminal state, process memory, or an in-flight tool call.

## Consequences

- CLI task cleanup cannot erase Agent history.
- Valid history survives a torn final append, and replay is deterministic and idempotent.
- Event files grow over time; compaction and retention are intentionally deferred.
- Recovery means retry from known durable metadata, not workspace continuation.

## Rejected Alternatives

- Reuse `~/.claude/tasks`: rejected because existing reset behavior deletes task JSON files.
- Rewrite one mutable Agent JSON snapshot: rejected because a torn write loses transition history and weakens auditability.
- Use a database in P0: rejected because per-task JSONL satisfies append, replay, and local inspection without a new dependency or migration system.
- Restore the workspace in version 1: rejected because no durable workspace checkpoint contract exists yet.

## Rollback/Revision Trigger

With the feature flag off, stop appending and reading Agent logs but retain them for later inspection; do not delete or merge them into CLI tasks. Revisit storage when measured log size requires compaction, concurrent writers cannot be serialized locally, or workspace recovery gains an explicit checkpoint format.

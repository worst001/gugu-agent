# ADR-0001: Durable AgentTask Boundary

## Status

Accepted for P0-C.

## Context

The repository already has a CLI Task model, but it is a lightweight coordination list rather than a durable execution record:

- `src/utils/tasks.ts` defines only `pending`, `in_progress`, and `completed`, stores one mutable JSON file per task under `~/.claude/tasks/<taskListId>/`, and can delete those files through `resetTaskList()`.
- `src/server/services/taskService.ts` reads that three-state format and defaults unknown states to `pending`.
- `desktop/src/types/cliTask.ts` and `desktop/src/components/chat/SessionTaskBar.tsx` mirror and render the same three states.

Extending this shape would couple durable execution, retries, recovery, evidence, and review to storage that is intentionally mutable and clearable.

## Decision

Introduce an independent durable `AgentTask` aggregate. Do not add Agent lifecycle states or recovery fields to the existing CLI Task schema, files, service, or desktop type.

Every `AgentTask` keeps these correlations:

- `sessionId`: the conversation that owns or displays the task.
- `taskListId`: an optional link to the existing CLI coordination list; it is a reference, not the durable identity.
- `runId`: a unique identity for one execution attempt.
- `attempt`: a monotonically increasing integer; a retry gets a new `runId` and increments `attempt`.

Once an attempt starts, those four values are preserved on its events and evidence. They are not inferred again during replay.

P0 reserves role metadata without implementing Role Packs. When omitted, both fields use the explicit default `software_engineer`: `roleId = "software_engineer"` and `roleVersion = "software_engineer"`. A later versioned Role Pack must persist its resolved immutable version instead of changing historical tasks.

Planned implementation paths, not present at the time of this ADR:

- `src/agentTask/types.ts` (planned)
- `src/agentTask/service.ts` (planned)

## Consequences

- Existing CLI Task behavior and API compatibility remain unchanged.
- Agent state can represent attempts, interruptions, evidence, and review without overloading a three-state checklist.
- UI projections may correlate an `AgentTask` with a CLI task, but neither record owns or rewrites the other.
- The system must maintain a separate store and projection for Agent tasks.

## Rejected Alternatives

- Add durable states and retry fields to `src/utils/tasks.ts`: rejected because reset and mutable per-task files are part of the current CLI Task behavior.
- Store Agent data only in `metadata` on a CLI task: rejected because metadata has no lifecycle, durability, or replay contract.
- Use `sessionId` or `taskListId` as the Agent task identity: rejected because one session or task list may contain multiple runs and retries.

## Rollback/Revision Trigger

Disable creation and projection of `AgentTask` through the feature flag in ADR-0005; existing CLI Task behavior requires no migration or rollback. Revise this boundary only if the CLI Task store itself gains equivalent append-only durability, immutable attempt identity, evidence semantics, and non-destructive retention.

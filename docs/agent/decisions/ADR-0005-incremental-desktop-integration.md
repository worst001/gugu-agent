# ADR-0005: Incremental Desktop Integration

## Status

Accepted for P0-C.

## Context

The desktop already has the surfaces needed for an incremental Agent experience:

- `desktop/src/pages/ActiveSession.tsx` mounts both `SessionTaskBar` and `WorkbenchPanel` for an active session.
- `desktop/src/components/chat/SessionTaskBar.tsx` is the current task progress surface.
- `desktop/src/components/workbench/WorkbenchPanel.tsx` is the current workbench entrypoint.
- Permission requests and responses travel through `desktop/src/stores/chatStore.ts` and `desktop/src/types/chat.ts` to `src/server/ws/events.ts` and `src/server/ws/handler.ts`.
- Terminal UI is isolated in `desktop/src/components/layout/TerminalDrawer.tsx`; PTY spawn/write/resize/kill are implemented in `desktop/src-tauri/src/lib.rs`.

A replacement desktop workflow would duplicate these paths and increase rollback risk.

## Decision

Integrate durable Agent tasks incrementally behind one server-owned feature flag, `CC_GUGU_AGENT_TASK_RUNTIME` (planned). Parse it with the repository's existing truthy-env convention in `src/utils/envUtils.ts`. The default is off when absent, empty, or invalid.

When the flag is off:

- Do not create, replay, or expose Agent tasks.
- Keep the existing CLI Task, chat, Workbench, permission, and Terminal behavior unchanged.

When the flag is on:

- Reuse `SessionTaskBar` as the session-scoped progress surface, backed by a separate Agent task projection rather than changing `CLITask` semantics.
- Reuse `WorkbenchPanel` for Agent details, Evidence, warnings, and artifacts.
- Send Agent permission prompts and responses over the existing session WebSocket permission chain; do not create a second socket or bypass current permission handling.
- Leave Terminal PTY ownership and commands unchanged. Agent execution is server-managed and must not be implemented by driving `TerminalDrawer` or altering Tauri PTY commands.
- Apply the new path only to explicitly created Agent tasks. Existing chat and CLI Task flows remain available and are not migrated or replaced.

Planned implementation paths, not present at the time of this ADR:

- `src/agentTask/featureFlag.ts` (planned flag owner)
- `src/server/api/agent-tasks.ts` (planned HTTP boundary)
- `desktop/src/api/agentTasks.ts` (planned client)
- `desktop/src/stores/agentTaskStore.ts` (planned projection)

Integration proceeds in small slices: server persistence/API first, read-only task projection second, Workbench Evidence third, then permission-backed actions. Each slice remains hidden unless the flag is enabled.

## Consequences

- Rollback is immediate by disabling the flag; old flows require no data migration.
- Desktop work stays within familiar session, task, Workbench, and permission surfaces.
- The existing `SessionTaskBar` may need a small adapter or discriminated projection, but the three-state `CLITask` contract remains unchanged.
- Agent data can exist on disk while the feature is disabled; it is retained but not shown or resumed.

## Rejected Alternatives

- Replace the existing task bar and chat flow in one release: rejected because it removes the rollback path and couples unrelated behavior.
- Build a separate Agent desktop application or top-level workflow: rejected because current session and Workbench surfaces already provide the needed context.
- Use Terminal PTY as the Agent orchestration API: rejected because PTY is an interactive user terminal, not a durable execution protocol.
- Add a parallel permission transport: rejected because it would duplicate security-sensitive request/response handling.

## Rollback/Revision Trigger

Disable `CC_GUGU_AGENT_TASK_RUNTIME`; do not delete event logs or Evidence and do not rewrite them into legacy tasks. Revise the incremental approach only if a shipped slice cannot preserve old behavior with the flag off, the existing WS permission contract cannot carry required structured context, or measured UI constraints show that `SessionTaskBar` or `WorkbenchPanel` cannot host the projection safely.

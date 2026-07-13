# Agent Runtime Current State

This audit covers the repository root CLI/server and `desktop/`. `gateway` is an external boundary and was not inspected or modified.

## Entrypoints And Connections

### Facts

- The root package is a Bun/TypeScript CLI and local server (`package.json`, `bin/claude-gugu`, `src/server/index.ts`).
- The desktop is a React/Tauri application (`desktop/package.json`, `desktop/src/App.tsx`) that talks to the local server through HTTP and WebSocket clients under `desktop/src/api/`.
- WebSocket client messages are dispatched by `src/server/ws/handler.ts: message()`. Permission replies use the existing `permission_response` branch.
- `src/server/services/conversationService.ts` owns pending permission requests. The desktop projects them through `desktop/src/stores/chatStore.ts` and `desktop/src/components/chat/PermissionDialog.tsx`.

### Inference

The first vertical slice should reuse the existing session, WebSocket, and permission paths. A second transport or approval system would create duplicate state without improving the Bugfix Task.

## Existing Task Concepts

### CLI Task List

Facts:

- `src/utils/tasks.ts` defines `TaskSchema`, `getTaskListId()`, `createTask()`, `updateTask()`, and list/reset behavior.
- Files live under `~/.claude/tasks/<taskListId>/*.json` and use the three states `pending`, `in_progress`, and `completed`.
- `src/hooks/useTasksV2.ts` watches and refreshes those files and clears a finished list after the existing completion flow.
- `src/server/services/taskService.ts: parseTaskFile()` exposes a read-only server projection and maps unknown states back to `pending`.
- `desktop/src/stores/cliTaskStore.ts` and `desktop/src/components/chat/SessionTaskBar.tsx` present that projection for a session.

Gap:

This storage is a short-lived work-list projection. Adding `verifying`, `failed`, or `interrupted` would be lossy because old readers collapse unknown states and completed lists may be cleared. It is not an audit log or restart-recovery source.

### Runtime Task

Facts:

- `src/Task.ts` defines runtime `TaskStatus` and `TaskStateBase`.
- `src/tasks/LocalAgentTask/LocalAgentTask.tsx` owns local-agent completion, failure, stop, progress, and notification behavior.
- Runtime task state is held by the application state and includes process-only objects such as abort controllers.

Gap:

Runtime Task is an execution/UI abstraction. Its in-memory state and process handles cannot be replayed as a durable business task after restart.

### Scheduled Task

Facts:

- `desktop/src/types/task.ts` defines `CronTask` and `TaskRun` for scheduled prompts.
- Scheduled-task API and server cron services model recurring or timed execution with run summaries.

Gap:

Scheduled Task owns scheduling, not the interactive `intake -> ... -> review` lifecycle. Reusing it would mix cron configuration with Bugfix Task evidence and recovery.

## Sessions, Checkpoints, And Forks

Facts:

- Session APIs are implemented under `src/server/api/sessions.ts` and `src/server/services/sessionService.ts`.
- The existing checkpoint/fork work is covered by `src/server/__tests__/sessions.test.ts` and `docs/plans/phase-5-session-checkpoints-progress.md`.
- The fork is conversation-only. It copies transcript context and does not restore files or a Git working tree.

Inference:

An `AgentTask` may reference a session and resume the conversation, but V1 must not claim filesystem rollback or automatic continuation of an interrupted tool process.

## Planning And Review

Facts:

- `src/services/stageRouter/stageRouter.ts` provides `runStagePlan()` and `runStageReview()`.
- Stage Router stores configuration and returns one-shot text. It does not own a durable lifecycle.
- Its current `getGitDiff()` uses unstaged `git diff`; staged and untracked files are not a complete review input.

Inference:

P3 may reuse the planning prompt path, and P5 may reuse the review bridge. Neither result is the source of truth for task state or deterministic completion.

## Verification Evidence

Facts:

- `src/utils/ShellCommand.ts` exposes structured `ExecResult.code` and interruption/error information.
- The existing Bash permission path controls executable side effects.
- Model-visible text and reviewer prose are not reliable substitutes for an exit code.

Inference:

Required checks must run through the existing permission boundary. `exitCode === 0` plus successfully persisted evidence is the V1 hard completion gate.

## Desktop Surfaces

Facts:

- `SessionTaskBar` renders the disposable CLI task-list projection.
- `desktop/src/components/chat/AgentActivityPanel.tsx` and Workbench derive activity from `tool_use` and `tool_result` messages.
- The terminal drawer is an independent PTY surface.

Inference:

P5 should add an AgentTask summary beside the existing session task UI and open Workbench for evidence detail. The terminal must not become the owner of lifecycle state.

## Feature Flags And External Boundary

- The repository already uses environment/config flags and includes GrowthBook. P1 must select one existing parsing/exposure path and document the exact flag before production code is enabled.
- The new runtime is default-off. With the flag off, session, CLI Task, scheduled task, and desktop behavior must remain unchanged.
- `gateway` remains externally owned and is outside P0-P6.

## Conclusion

No existing Task type can safely become the durable `AgentTask`:

- CLI Task is a disposable three-state work list.
- Runtime Task is process-local execution state.
- Scheduled Task is cron/run configuration.

The implementation should add a small independent lifecycle and event store, while reusing sessions, permissions, shell results, Stage Router adapters, and desktop activity surfaces.
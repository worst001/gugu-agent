# Agent Runtime Target Architecture

This is the minimum architecture for one role and one workflow: a `software_engineer` Bugfix Task. It extends the existing CLI/server/desktop system; it does not replace sessions, tools, permissions, terminal, or existing Task types.

## Ownership Map

| Owner | Responsibility |
| --- | --- |
| Existing Session runtime | Conversation, transcript, tool calls, permission interaction |
| **Planned** `src/agentTask/types.ts` | Stable V1 contracts and transition names |
| **Planned** `src/agentTask/events/jsonlEventLog.ts` | Append, read, replay, and corrupt-tail handling |
| **Planned** `src/agentTask/orchestrator.ts` | Transition guards and workflow orchestration |
| **Planned** `src/agentTask/service.ts` | Server projection, session association, recovery |
| **Planned** `src/server/api/agent-tasks.ts` | Flag/capability, create/read/action endpoints |
| Existing permission chain | Approval decisions for side-effecting tools |
| Existing `ShellCommand` / Bash path | Structured deterministic verification results |
| Existing Stage Router adapters | Optional plan and review calls |
| **Planned** desktop AgentTask store/bar | Live/history projection and commands |
| Existing Workbench | Evidence detail and artifacts |
| Existing terminal PTY | Manual terminal only; never lifecycle truth |

## Feature Flag

V1 uses the existing server-side environment-flag pattern:

```text
CC_GUGU_AGENT_TASK_RUNTIME=1
```

- Default is disabled.
- **Planned owner:** `src/agentTask/featureFlag.ts` parses the value with the repository's truthy helper.
- **Planned exposure:** agent-task server capability/API reports whether the feature is enabled.
- **Planned desktop consumption:** desktop uses capability discovery, then hides the store/bar and makes no task-data requests when disabled.
- Flag-off keeps all legacy session, CLI Task, scheduled task, and desktop paths unchanged.

## Lifecycle

```text
intake -> scout -> plan -> execute -> verify -> review -> completed
   |        |        |         |         |         |
   +------> blocked <-+---------+---------+---------+
              |
              +-> intake | scout | plan | execute | verify

any nonterminal -> interrupted
any nonterminal -> cancelled
intake | scout | plan | execute | verify -> failed
```

Rules:

| State | Enter when | Exit when |
| --- | --- | --- |
| `intake` | Task contract is created | Goal, constraints, session, role, and required checks are valid |
| `scout` | Intake is complete | Relevant project facts and uncertainties are recorded |
| `plan` | Scout evidence exists | A bounded plan and verification commands are recorded |
| `execute` | Plan is accepted and permissions are available | Planned edits/actions finish or a failure/block occurs |
| `verify` | Execute finishes | Every required check has a terminal structured result |
| `review` | Verification hard gate passes | Review finishes, times out, or is unavailable; result/warning is persisted |
| `completed` | Evidence is persisted and verification passed | Terminal |
| `blocked` | A user decision, permission, or required external fact is missing | Explicit resolution returns to the recorded prior state |
| `failed` | A nonrecoverable in-scope operation fails | Terminal; a new attempt is a new run |
| `interrupted` | Process exits with no terminal task event | Explicit resume starts a new attempt |
| `cancelled` | User cancels | Terminal |

No transition is inferred from assistant prose.

## V1 Contracts

```ts
export type AgentTaskStatus =
  | 'intake'
  | 'scout'
  | 'plan'
  | 'execute'
  | 'verify'
  | 'review'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type AgentTask = {
  id: string
  goal: string
  status: AgentTaskStatus
  resumeStatus?: Exclude<AgentTaskStatus, 'blocked' | 'completed' | 'failed' | 'cancelled'>
  roleId: 'software_engineer'
  roleVersion: string
  sessionId?: string
  taskListId?: string
  runId: string
  attempt: number
  requiredChecks: Array<{ id: string; command: string; cwd: string }>
  createdAt: string
  updatedAt: string
}

export type AgentEventType =
  | 'task_created'
  | 'status_changed'
  | 'plan_recorded'
  | 'permission_blocked'
  | 'evidence_recorded'
  | 'verification_finished'
  | 'review_finished'
  | 'task_interrupted'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'

export type AgentEvent = {
  id: string
  taskId: string
  runId: string
  sequence: number
  type: AgentEventType
  timestamp: string
  payload: Record<string, unknown>
}

export type VerificationCheck = {
  id: string
  command: string
  cwd: string
  startedAt: string
  finishedAt: string
  exitCode: number | null
  status: 'passed' | 'failed' | 'timed_out' | 'interrupted'
  output?: string
  outputRef?: string
}

export type EvidencePack = {
  taskId: string
  runId: string
  checks: VerificationCheck[]
  changedFiles: string[]
  artifacts: Array<{ path: string; kind: string }>
  unverified: string[]
  persistedAt: string
}

export type ReviewResult = {
  taskId: string
  runId: string
  status: 'passed' | 'findings' | 'warning'
  summary: string
  findings: Array<{ severity: 'high' | 'medium' | 'low'; text: string; file?: string }>
  warning?: string
  completedAt: string
}
```

## Completion Invariant

`completed` is legal only when:

1. Every declared required check has exactly one terminal result.
2. Every required result has `status === 'passed'` and `exitCode === 0`.
3. The `EvidencePack` append has succeeded and replay confirms it.
4. The Review step has a persisted result or warning.

Review quality is not a deterministic gate. A timeout, unavailable reviewer, or low-confidence answer records `status: 'warning'` and does not reverse a verified result.

## Event Storage And Recovery

- **Planned path:** `~/.claude/agent-tasks/<taskId>/events.jsonl`.
- Each line is one validated event with monotonically increasing `sequence`.
- Append is serialized per task. Duplicate event IDs are idempotent.
- Readers ignore one malformed final partial line and reject corruption before the final line.
- Projection is rebuilt by replay; no independently writable snapshot exists in V1.
- On startup, a run with a start/status event but no terminal event is projected as `interrupted` and recoverable.
- Resume creates a new `runId`/attempt and reuses the linked session where possible.
- V1 does not resume child processes, restore edited files, or rewind Git.

## API, Live Updates, And History

- Server APIs create/read/list tasks and accept explicit actions: advance, block/resolve, cancel, resume.
- WebSocket events may notify the desktop that a projection changed; the server projection remains authoritative.
- Refresh and reconnect reload the same projection and evidence through HTTP before applying later live events.
- Event sequence prevents stale or duplicate notifications from moving the UI backward.

## Security Boundary

- Scout/read operations use existing read permissions.
- Plan has no write side effects.
- Execute and verification commands use the current permission request/response path.
- Task events never store secrets or raw environment variables.
- Evidence output is bounded; full output is referenced through an existing safe local artifact path when needed.
- Review cannot grant permissions or execute tools.

## Desktop Integration

- Add a small AgentTask status bar near the current session task surface.
- Keep `SessionTaskBar` semantics unchanged.
- Open existing Workbench for checks, changed files, artifacts, and review findings.
- Do not place lifecycle state in `TerminalDrawer` or infer it from terminal text.
- Flag-off renders no new UI.

## Rollback

Disable `CC_GUGU_AGENT_TASK_RUNTIME`. Legacy flows remain untouched. Event files are inert local data and may be retained for inspection; V1 performs no destructive migration.

## Non-Goals

Role Pack loading, knowledge-worker workflows, long-term memory, model gateway replacement, Reasonix integration, autonomous product multi-agent coordination, workspace rollback, deployment, and release are outside P0-P6.
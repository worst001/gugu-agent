# Agent Runtime Gap Analysis

This matrix compares the current repository with the approved software-engineer Bugfix Task slice. Existing paths are facts; paths marked **planned** do not exist yet.

| Area | Current implementation | V1 target | Gap and risk | Priority / phase | Acceptance evidence |
| --- | --- | --- | --- | --- | --- |
| Durable identity | CLI task files in `src/utils/tasks.ts`; process tasks in `src/Task.ts` | Independent `AgentTask` with task/run/attempt identity | Existing task meanings conflict and completed CLI lists may be cleared | P0 / P1 | Old task tests unchanged; new identity round-trips |
| Role metadata | No task-level role contract | `roleId=software_engineer`, version recorded | Metadata only; Role Pack runtime is deliberately absent | P1 | Stored task contains stable role fields |
| Lifecycle | CLI three-state and runtime execution states | `intake -> scout -> plan -> execute -> verify -> review -> completed` plus explicit terminal/blocked states | No durable transition guard | P1 / P3 | Invalid transitions rejected; happy path test |
| Event log | Session transcript and tool messages | Ordered append-only `AgentEvent` stream | Transcript text cannot rebuild lifecycle reliably | P2 | Replay returns the same projection |
| Persistence | `~/.claude/tasks` is disposable | **Planned:** `~/.claude/agent-tasks/<id>/events.jsonl` | Tail corruption, duplicate append, and concurrent write risk | P2 | Corrupt-tail and idempotency tests |
| Restart recovery | Session resume and conversation-only fork | Nonterminal run becomes `interrupted/recoverable`; explicit resume only | V1 cannot resume a killed process or restore files | P2 / P6 | Restart fixture and repeated-recovery test |
| Session association | Session APIs under `src/server/api/sessions.ts` | Task stores `sessionId`; session remains conversation owner | Task and session may outlive each other | P1 / P2 | Missing session is reported, not fabricated |
| Planning | `runStagePlan()` returns one-shot text | Plan result recorded as task event | Stage Router is not a state machine | P3 | Plan event and failure event are persisted |
| Execution and permissions | Existing tools and permission request/response chain | Execute through the same permission boundary | Direct subprocess calls could bypass approval | P3 | Approval allow/deny integration tests |
| Deterministic verification | `ShellCommand.ExecResult.code` exists | Required checks and exit codes persisted | Rendered text or LLM verdict could produce false completion | P4 | Nonzero/timeout/interruption block completion |
| Evidence Pack | Tool messages and logs are scattered | Commands, cwd, times, exit codes, bounded output/reference, changed files | Evidence may disappear on refresh | P4 / P6 | Evidence survives reload and restart |
| Review | `runStageReview()` returns prose and incomplete diff input | Persisted soft-gate `ReviewResult` after verification | Reviewer may be unavailable or miss findings | P5 | Timeout/low confidence becomes warning |
| Desktop live state | CLI tasks in `SessionTaskBar`; activity from messages | AgentTask summary and evidence entry point | Adding a second state owner could diverge | P5 | One store projection; live update test |
| Desktop history | History load differs from WebSocket updates | Reloaded task/evidence equals live state | Refresh/reconnect may lose status | P6 | Refresh and reconnect tests |
| Feature flag | Existing env/config flag patterns | `CC_GUGU_AGENT_TASK_RUNTIME=1`, parsed server-side; default off | Server/desktop disagreement could expose dead UI | P1 / P5 | Flag-off regression; server capability response |
| Evaluation | Tests exist but no task-runtime baseline | 8 reproducible golden-task slots and defined metrics | No honest baseline until cases are bound | P0 / P6 | Baseline run stores inputs and results |
| Workspace recovery | Conversation checkpoints only | Explicit non-goal for V1 | Claiming rollback would risk data loss | Deferred | UI/docs state conversation-only limitation |
| Gateway | Separately owned dirty submodule | External boundary only | Accidental edits or coupling | All phases | Status proves gateway unchanged |

## Priority Summary

### P0/P1: Establish a separate contract

Create **planned** `src/agentTask/` types and flag helper without changing the schema or cleanup behavior in `src/utils/tasks.ts`. Existing CLI Task remains a UI compatibility projection only.

### P2/P3: Make state durable before adding autonomy

Append and replay task events before wiring planning or tool execution. A task may resume its session, but an interrupted process is never silently restarted.

### P4/P5: Prove completion, then improve review and UX

Deterministic command results are the hard gate. Review is recorded after verification and remains advisory. The desktop consumes the server projection rather than rebuilding task truth from chat text.

### P6: Close consistency gaps

Exercise restart, refresh, reconnect, permission denial, verification failure, reviewer failure, and flag-off compatibility. Bind real golden tasks before reporting success-rate metrics.

## Non-Goals

- No Role Pack loader, long-term memory, model gateway rewrite, product multi-agent orchestration, Reasonix work, or filesystem rollback.
- No change to `gateway`.
- No release, push, or migration of existing users while the flag is off.
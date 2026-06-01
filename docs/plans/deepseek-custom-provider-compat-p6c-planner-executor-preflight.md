# P6C Planner/Executor Split Preflight

Created: 2026-06-01

## Current Decision

Do not implement a planner/executor split in this patch. The existing query loop already has several cache-sensitive invariants, and P6A/P6B now provide lower-risk building blocks:

- stable large-output handles that `Read` can consume
- hash-only prefix drift observations
- per-thread content replacement state that preserves prompt-cache decisions across turns and resumes

Planner/executor should move only after these invariants are protected by focused tests.

## Existing Anchors

- `src/query.ts`
  - Applies `applyToolResultBudget` before snip, microcompact, and autocompact.
  - Persists replacement records only for resumable main-thread and agent sources.
- `src/Tool.ts`
  - Carries `contentReplacementState` and `renderedSystemPrompt` on `ToolUseContext`.
- `src/utils/forkedAgent.ts`
  - Defines cache-safe fork parameters: system prompt, user/system context, tools/model options, and parent messages.
  - Warns that output-token overrides can change thinking budget and invalidate cache.
- `src/server/proxy/prefixStability.ts`
  - Provides the first hash-only way to tell whether system/tools/model/provider capability mode drifted.
- `src/utils/toolResultStorage.ts`
  - Freezes large tool-result replacement choices by `tool_use_id` and now exposes stable handles.

## Non-Negotiable Invariants

- Planner and executor must not diverge on cache-critical request fields unless the split intentionally gives up cache sharing.
- Tool-result replacement decisions must remain stable by `tool_use_id`; planner summaries must not cause previously full tool results to become previews later.
- Executor-visible full outputs should prefer `tool-result:<id>` handles over replaying huge payloads into planner context.
- Resume must reconstruct the same content replacement state before either planner or executor sends another request.
- Prefix telemetry must remain hash-only: no raw system prompts, tool schemas, API keys, or full tool outputs.
- Provider capability mode is part of the stable prefix. A planner created under generic OpenAI Chat must not silently hand off to a DeepSeek-compatible executor without a drift signal.

## Required Tests Before Runtime Split

- A planner-only turn and an executor turn share the same stable prefix fingerprint when no split-specific override is used.
- Changing tools, model, provider capability mode, or system prompt reports drift before the executor request is sent.
- A large tool result replaced in the executor remains represented by the same handle in planner context across the next turn.
- Resume with content replacement records re-applies the same handle-backed preview before planner or executor requests.
- `Read(tool-result:<id>)` works for both text and JSON-backed persisted outputs without bypassing resolved file permission checks.

## First Safe Implementation Shape

1. Add an internal split-context type that is data-only and testable.
2. Build planner/executor request previews from the same input messages without sending them.
3. Compare their prefix snapshots in tests.
4. Only after tests pass, introduce a gated runtime path.

## Current Stop Line

Do not add new UI, new provider settings, or a runtime planner/executor switch yet. The next code step should be test-only or preview-only.

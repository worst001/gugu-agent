# DeepSeek Custom Provider Compatibility P6 Architecture Entry

Created: 2026-06-01
Branch: `feat/deepseek-custom-provider-compat`

## Status

P0-P5 have landed as a focused compatibility layer:

- Public presets remain limited to Gugu-managed and Custom.
- DeepSeek-like behavior is capability-gated in the server proxy.
- OpenAI Chat request transforms handle DeepSeek thinking/tool-call requirements.
- OpenAI Chat response transforms normalize DeepSeek prefix-cache telemetry.
- Prefix-stability drift logging is available only with `CC_GUGU_PROXY_PREFIX_DEBUG=1`.
- User-facing docs describe this as Custom Provider compatibility, not an official provider preset.

P6 should stay a separate architecture project. This branch now contains two small P6 seeds that are intentionally low-risk:

- P6A: persisted large tool results now expose a stable `tool-result:<tool_use_id>` handle in the model-visible preview and transcript replacement metadata, with a local resolver helper for future tool or command integration.
- P6B: prefix-stability observation now returns a structured debug event object, still gated by `CC_GUGU_PROXY_PREFIX_DEBUG=1`.

P6C should remain deferred unless telemetry shows a concrete need for a larger planner/executor split.

## Local Code Signals

Useful local entry points for later P6 work:

- `src/constants/toolLimits.ts`
  - Existing tool-result token/byte limits.
  - Candidate anchor for tool-output handles or artifact indirection.
- `src/constants/prompts.ts`
  - Contains the current instruction to summarize tool results because original tool output may be cleared.
  - Candidate anchor for a more explicit large-output policy.
- `src/bootstrap/state.ts`
  - Already has comments about stable cache-control evaluation.
  - Candidate anchor for cache-stable session state.
- `src/server/proxy/prefixStability.ts`
  - First minimal drift-observability hook from P4.
  - Candidate anchor for later richer prefix diagnostics.
- `src/server/services/sessionService.ts`
  - Reads usage fields including cache read/create tokens.
  - Candidate anchor for prefix-cache telemetry surfacing.

## Reference Source Status

The phase plan names CodeWhale and deepseek-reasonix as reference projects, but the local `.analysis-CodeWhale` and `.analysis-Reasonix` directories were not present when this entry was written. Do not claim a source-level P6 design from those repos until their current source has been re-fetched or inspected.

Reference repos to inspect before implementation:

- `https://github.com/Hmbown/CodeWhale`
- `https://github.com/esengine/deepseek-reasonix`

## Recommended P6 Order

### P6A - Tool-Output Handles

Initial seed landed. Continue here if the goal is tangible stability for long tool loops.

Goal:

- Avoid replaying very large tool outputs directly into cache-stable context.
- Preserve enough information for the model to continue correctly.
- Keep local retrieval possible when the full output is needed again.

First design questions:

- Which tool results currently exceed `MAX_TOOL_RESULT_TOKENS` or aggregate char limits most often?
- Should handles live in session state, filesystem artifacts, or an existing transcript attachment mechanism?
- How should the assistant be told a result was summarized or handle-backed?

Current implementation:

- `src/utils/toolResultStorage.ts` builds stable handles with `buildToolResultHandle`.
- Persisted output previews include `Handle: tool-result:<tool_use_id>` while keeping the existing file path retrieval hint.
- Content replacement records include optional `handle`, `filepath`, and `originalSize` metadata for future artifact resolution.
- `readPersistedToolResultByHandle` resolves handles only inside the active session's `tool-results/` directory and rejects path-like handle payloads.
- `Read` accepts persisted tool-result handles and maps them back to session-local files while keeping permission checks anchored to the `tool-results/` directory.
- `src/utils/__tests__/toolResultStorage.test.ts` covers handle visibility, parsing, and aggregate budget records.
- `src/tools/FileReadTool/FileReadTool.test.ts` covers direct `Read(tool-result:<id>)` consumption.

Not implemented yet:

- No user-facing slash command consumes these handles yet.
- No cross-session artifact index exists beyond the existing session-local files and transcript metadata.

### P6B - Prefix Stability Telemetry

Initial seed landed. Build on P4 after real cache behavior is observed.

Goal:

- Surface prefix-affecting changes in a way that helps diagnose cache misses.
- Keep all logs hash-only and secret-free.

First implementation idea:

- Add optional structured debug events or server-side counters for prefix drift categories.
- Keep `CC_GUGU_PROXY_PREFIX_DEBUG=1` as the initial activation gate.

Current implementation:

- `observePrefixStability` returns `disabled`, `baseline`, `stable`, or `drift` observations.
- The returned object is hash-only and does not include raw system prompts, tool schemas, API keys, or full tool outputs.
- Existing debug logging still only runs when `CC_GUGU_PROXY_PREFIX_DEBUG=1`.

### P6C - Planner/Executor Split

Preflight documented. Defer runtime implementation until compatibility and telemetry show a real need.

Goal:

- Separate cache-stable planning context from volatile execution/tool context.

Risk:

- Large behavior change across session orchestration, tool result flow, and memory handling.
- Should not be part of the first DeepSeek compatibility patch.

Current implementation:

- `docs/plans/deepseek-custom-provider-compat-p6c-planner-executor-preflight.md` records the split invariants, required tests, and current stop line.
- Runtime planner/executor split remains intentionally unimplemented.

## Guardrails

- Do not add DeepSeek as a public built-in provider preset.
- Do not add UI options for provider-specific compatibility until automatic capabilities prove insufficient.
- Do not log raw prompts, tool schemas, API keys, or full tool outputs in prefix telemetry.
- Do not start P6 implementation from stale reference-code assumptions.

# DeepSeek Custom Provider Compatibility Phase Plan

Created: 2026-05-31
Branch: `feat/deepseek-custom-provider-compat`
Worktree: `.worktrees/feat/deepseek-custom-provider-compat`
Base branch: `fix/bug-from-master` at `7bc97f3`

## Scope

Learn the useful DeepSeek optimization ideas from CodeWhale and Reasonix without changing the current product positioning.

The product boundary is important:

- Keep public built-in provider presets limited to Gugu-managed and Custom.
- Do not add DeepSeek as an official built-in preset or partner-branded entry.
- Implement improvements as Custom Provider compatibility, mostly for OpenAI Chat compatible endpoints.
- Keep behavior capability-gated so generic OpenAI-compatible providers are not affected.

## Borrowing Strategy

Use CodeWhale as the primary reference for DeepSeek protocol behavior:

- `reasoning_content` replay across tool calls
- DeepSeek thinking mode request shape
- provider-aware reasoning effort mapping
- prefix cache telemetry and drift awareness

Use Reasonix as the secondary reference for architecture discipline:

- provider capability/config boundary
- cache-first context stability
- simple usage normalization
- planner/executor separation as a later architecture option

Do not copy Reasonix's blanket stripping of `reasoning_content`; that conflicts with DeepSeek's documented thinking/tool-call flow and CodeWhale's tests.

## Phase List

### P0 - Guardrails and Design Freeze

Estimate: 0.5-1 day

Goal: make sure the implementation cannot accidentally become an official DeepSeek product preset.

Work:

- Re-read `docs/reports/model-access-gugu-managed-only-2026-05-28.md`.
- Confirm `src/server/config/providerPresets.json` remains unchanged except for unrelated existing work.
- Decide the first implementation shape for capabilities:
  - short-term heuristic helper for DeepSeek-like custom endpoints, or
  - explicit provider capability object in saved custom provider config.

Recommended decision:

- Start with an internal capability resolver used by proxy code.
- Keep UI-facing capability toggles for a later phase unless implementation proves the defaults need user control.

Acceptance:

- No new built-in DeepSeek preset.
- A short code comment or test name makes the Custom Provider boundary clear.

### P1 - DeepSeek Protocol Compatibility Core

Estimate: 3-5 days

Goal: make DeepSeek-like Custom Providers stable for thinking mode and tool-call loops.

Primary files:

- `src/server/proxy/handler.ts`
- `src/server/proxy/transform/anthropicToOpenaiChat.ts`
- `src/server/__tests__/proxy-transform.test.ts`

Work:

- Add a provider/model capability resolver for OpenAI Chat proxy requests.
- Pass capability context into `anthropicToOpenaiChat`.
- For DeepSeek-like capabilities:
  - map Anthropic thinking to DeepSeek-compatible `thinking: { type: "enabled" | "disabled" }` when applicable.
  - preserve assistant `reasoning_content` when replaying assistant tool-call messages.
  - add a final sanitizer that inserts a minimal placeholder `reasoning_content` for assistant messages with `tool_calls` when DeepSeek requires it and no thinking content exists.
- Keep generic OpenAI Chat providers unchanged.

Acceptance:

- Existing OpenAI Chat transform tests still pass.
- New test covers DeepSeek assistant `tool_calls` with missing reasoning getting a placeholder.
- New test covers non-DeepSeek OpenAI Chat not receiving DeepSeek-only fields.

### P2 - Usage and Prefix Cache Telemetry

Estimate: 2-4 days

Goal: expose whether prefix caching is working for DeepSeek-compatible endpoints.

Primary files:

- `src/server/proxy/transform/openaiChatToAnthropic.ts`
- `src/server/proxy/streaming/openaiChatStreamToAnthropic.ts`
- `src/server/__tests__/proxy-transform.test.ts`
- `src/server/__tests__/proxy-streaming.test.ts`

Work:

- Normalize DeepSeek top-level usage fields:
  - `prompt_cache_hit_tokens`
  - `prompt_cache_miss_tokens`
- Preserve existing OpenAI nested `prompt_tokens_details.cached_tokens` behavior.
- Map cache-hit tokens to Anthropic-compatible cache read usage where the local response type supports it.
- Decide where cache-miss tokens should live if the Anthropic response shape has no exact field.
- Add tests for streaming and non-streaming usage chunks.

Acceptance:

- DeepSeek cache-hit telemetry is visible in transformed usage.
- Existing OpenAI cached-token behavior is not regressed.
- Unknown cache fields are ignored safely.

### P3 - Capability Model Hardening

Estimate: 3-5 days

Goal: avoid scattered model-name checks and make future provider-specific behavior maintainable.

Primary files:

- `src/server/types/provider.ts`
- `src/server/services/providerService.ts`
- `src/server/proxy/handler.ts`
- possible new file: `src/server/proxy/providerCapabilities.ts`

Work:

- Centralize capability detection into one module.
- Include capabilities such as:
  - `reasoningContentReplay`
  - `requiresReasoningContentForToolCalls`
  - `thinkingRequestParam`
  - `cacheTelemetryStyle`
  - `supportsImages`
- Keep saved provider schema backward-compatible.
- Consider explicit custom-provider advanced options only if heuristics are insufficient.

Acceptance:

- Proxy transform code receives capabilities instead of inspecting provider names directly.
- Existing saved providers parse without migration.
- Tests cover DeepSeek-like and generic OpenAI-compatible branches.

### P4 - Context Stability and Drift Observability

Estimate: 4-7 days

Goal: reduce accidental prefix cache misses.

Primary files:

- `src/server/services/providerService.ts`
- `src/server/proxy/handler.ts`
- possible new file: `src/server/proxy/prefixStability.ts`

Work:

- Fingerprint stable request prefix components:
  - system prompt
  - tool names and schemas
  - model identifier
  - provider capability mode
- Log or emit debug events when prefix-affecting components drift.
- Avoid putting volatile data into stable prefix zones where possible.

Acceptance:

- Debug logs can explain obvious cache-miss causes.
- Fingerprints do not include secrets.
- No user-visible behavior changes by default.

### P5 - Optional UX and Documentation

Estimate: 2-4 days

Goal: make the feature understandable without changing public provider positioning.

Primary files:

- `docs/`
- desktop provider settings files only if UI options become necessary

Work:

- Document Custom Provider compatibility notes.
- Add troubleshooting guidance for DeepSeek-compatible OpenAI Chat endpoints.
- If needed, expose an advanced Custom Provider compatibility mode:
  - Auto
  - Generic OpenAI Chat
  - DeepSeek-compatible

Acceptance:

- Docs do not describe DeepSeek as an official built-in provider.
- Users can understand why thinking/tool-call behavior differs by compatibility mode.

### P6 - Later Architecture Work

Estimate: 2-4 weeks, separate project

Goal: borrow larger CodeWhale/Reasonix ideas only after the compatibility layer is stable.

Candidate work:

- Tool-output handles or artifacts for large outputs.
- LSP diagnostic feedback loop.
- Planner/executor split with separate cache-stable sessions.
- Memory update policy that avoids mutating the active stable prefix.

Acceptance:

- Treat this as a separate roadmap item, not part of the first DeepSeek compatibility patch.

## Suggested Timeline

Minimal useful patch:

- P0 + P1 + P2: 1-2 weeks

Maintainable compatibility layer:

- P0 through P4: 3-5 weeks

Architecture expansion:

- P6: separate 2-4 week effort after the core compatibility work lands.

## Key Risks

1. DeepSeek `reasoning_content` behavior can differ by model/version.
   Mitigation: capability-gate replay and add a future escape hatch.

2. Generic OpenAI-compatible providers may reject DeepSeek-only fields.
   Mitigation: never send `thinking` or replay placeholders unless capability resolver opts in.

3. Prefix cache improvements can be invisible without telemetry.
   Mitigation: ship cache usage normalization before deeper prefix-stability work.

4. Product positioning can drift if docs or UI imply official DeepSeek support.
   Mitigation: phrase this as Custom Provider compatibility throughout.

5. Real DeepSeek API behavior cannot be fully covered by default CI.
   Mitigation: keep unit tests deterministic and add optional integration tests gated by `DEEPSEEK_API_KEY`.

## First Implementation Recommendation

Start with P1 but keep the code shape ready for P3:

- Add `src/server/proxy/providerCapabilities.ts`.
- Teach `handler.ts` to resolve capabilities from request/provider context.
- Pass capabilities into `anthropicToOpenaiChat`.
- Add the DeepSeek-only sanitizer and tests.

Then do P2 immediately after, because cache telemetry is how we know whether the optimizations are actually working.

## Handoff Prompt for a New Window

Use this prompt if the current context gets too large, or if implementation continues in a new Codex window:

```text
You are working in D:\Claude Code\claude-code-gugu\.worktrees\feat\deepseek-custom-provider-compat on branch feat/deepseek-custom-provider-compat.

Follow AGENTS.md and C:\Users\Administrator\.codex\RTK.md. Always prefix shell commands with rtk. This repo should use product branch prefixes, not codex/* branches.

Goal: implement DeepSeek-compatible Custom Provider improvements without adding DeepSeek as an official built-in provider preset. Keep Gugu-managed + Custom as the product boundary.

Read docs/plans/deepseek-custom-provider-compat-phase-plan.md first.

Important prior analysis:
- CodeWhale is the primary reference for DeepSeek protocol behavior: thinking mode, reasoning_content replay across tool calls, final sanitizer for assistant tool_calls missing reasoning, cache telemetry, prefix stability.
- Reasonix is the secondary reference for architecture discipline: capability/config boundaries, usage normalization, cache-stable context, planner/executor as later work.
- Do not copy Reasonix's blanket stripping of reasoning_content; DeepSeek's documented thinking/tool-call flow may require replay.

Recommended first work:
1. Add a central capability resolver, likely src/server/proxy/providerCapabilities.ts.
2. Pass capabilities from src/server/proxy/handler.ts into src/server/proxy/transform/anthropicToOpenaiChat.ts.
3. For DeepSeek-like OpenAI Chat providers only, preserve/replay reasoning_content and add a placeholder when assistant messages have tool_calls but no reasoning_content.
4. Keep generic OpenAI-compatible providers unchanged.
5. Add focused tests in src/server/__tests__/proxy-transform.test.ts.
6. Then map DeepSeek cache usage fields in openaiChatToAnthropic and openaiChatStreamToAnthropic, with tests.

Useful local files:
- docs/reports/model-access-gugu-managed-only-2026-05-28.md
- src/server/config/providerPresets.json
- src/server/types/provider.ts
- src/server/proxy/handler.ts
- src/server/proxy/transform/anthropicToOpenaiChat.ts
- src/server/proxy/transform/openaiChatToAnthropic.ts
- src/server/proxy/streaming/openaiChatStreamToAnthropic.ts
- src/server/__tests__/proxy-transform.test.ts
- src/server/__tests__/proxy-streaming.test.ts

External repos previously analyzed:
- https://github.com/Hmbown/CodeWhale
- https://github.com/esengine/deepseek-reasonix

If more external source detail is needed, shallow clone them into ignored analysis folders from this worktree. Otherwise rely on the summarized plan above.
```

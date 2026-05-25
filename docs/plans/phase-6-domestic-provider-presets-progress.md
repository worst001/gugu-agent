# Phase 6 Domestic Provider Presets Progress

## Scope

Phase 6 is broad. This first implementation slice focuses on domestic model provider presets and visible routing metadata:

- Domestic provider templates can be added from the GUI without editing JSON by hand.
- Presets clearly show the protocol path used by the agent runtime.
- Fast/pro routing is visible through the existing `haiku`/`sonnet`/`opus` model mapping.
- Remote IM channels now expose their local credential, pairing, and allowlist boundaries in settings.
- Voice input starts with a local browser/system speech-recognition entry that writes editable text into the composer before sending.

## Tasks

- [x] T01: Map the current provider preset, provider service, and settings UI flow.
- [x] T02: Extend provider preset metadata without breaking existing saved providers.
- [x] T03: Add Qwen/DashScope and Doubao/Volcano Ark domestic presets.
- [x] T04: Surface preset category, protocol, agent compatibility, and fast/pro routing hints in the settings UI.
- [x] T05: Add backend tests for preset metadata and model routing defaults.
- [x] T06: Add desktop tests for provider preset metadata visibility.
- [x] T07: Run focused verification.
- [x] T08: Support OpenAI-compatible base URLs that already include version paths such as `/v1` and `/v3`.
- [x] T09: Show the resolved upstream endpoint and warn when users paste a concrete endpoint instead of a base URL.
- [x] T10: Harden IM adapter settings around masked credentials, paired-user access, allowlist wording, and visible readiness status.
- [x] T11: Add local voice dictation entry in the composer with capability detection and review-before-send behavior.
- [x] T12: Add local IM adapter diagnostics so users can check credential readiness, pairing state, and access boundaries before real platform keys are available.
- [x] T13: Add DingTalk, WeCom, and QQ configuration surfaces, local diagnostics, sidecar flags, and minimal adapter process scaffolds.

## Notes

- The active runtime already writes `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_OPUS_MODEL`, so this slice should not invent a second routing mechanism.
- OpenAI-compatible domestic providers should continue to use the local proxy rather than writing their upstream API key into Claude Code's native Anthropic path.
- Keep all new preset metadata optional so existing user-created providers remain valid.
- Verification passed on 2026-05-15:
  - `rtk bun test src/server/__tests__/provider-presets.test.ts`
  - `cd desktop && rtk bun run test src/__tests__/generalSettings.test.tsx`
  - `cd desktop && rtk bun run lint`
  - `cd desktop && rtk bun run test`
- Second slice verification passed on 2026-05-15:
  - `rtk bun test src/server/__tests__/openai-endpoint.test.ts src/server/__tests__/chatgpt-provider-proxy.test.ts src/server/__tests__/provider-presets.test.ts`
  - `cd desktop && bun run test src/__tests__/generalSettings.test.tsx`
  - `cd desktop && rtk bun run lint`
  - `cd desktop && bun run test`
  - `git diff --check`
- Third slice verification passed on 2026-05-15:
  - `bun test src/server/__tests__/adapters.test.ts`
  - `bun test src/server/__tests__/adapters.test.ts src/server/__tests__/provider-presets.test.ts src/server/__tests__/openai-endpoint.test.ts`
  - `cd desktop && bun run test src/pages/AdapterSettings.test.tsx src/__tests__/pages.test.tsx`
  - `cd desktop && bun run lint`
- Fourth slice verification passed on 2026-05-15:
  - `bun test src/server/__tests__/adapters.test.ts`
  - `cd desktop && bun run test src/pages/AdapterSettings.test.tsx`
  - `cd desktop && bun run lint`

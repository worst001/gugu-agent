# Gugu Agent Phase 0-6 Productization Review

Date: 2026-05-15
Branch: `feature-hwh-dev`

## Scope

This review covers the non-secret, locally verifiable parts of Phase 0 through Phase 6, plus the productization cleanup pass focused on the main composer, message list, attachment previews, branding, and panel resizing.

## Verified

- Main composer keeps the original user text separate from model-bound workflow text. CE workflow bindings no longer pollute the visible user bubble.
- Text, image, file, and mixed attachment messages retain original display attachments in the GUI while the wire payload can still be transformed for GLM parsing or provider compatibility.
- User attachment bubbles have stable thumbnail/card dimensions and can open the Workbench Preview tab.
- Workbench Preview can show original attachments, parsed GLM Markdown, and the text sent to the main model.
- Unsupported image/file provider errors are rendered as friendly assistant guidance or neutral system messages, not red error panels.
- Attachment parser failure unlocks the chat state and keeps the original user message visible.
- Running turns block duplicate composer submits from Enter while preserving the Stop action.
- The input-area effort dropdown is removed; effort state and backend `set_effort` support remain available through the capability/settings path.
- Left sidebar width is draggable, clamped to 220-420px, persisted locally, and reset by double-click.
- Right Workbench width is draggable, clamped to 320px through `min(720px, 50vw)`, persisted locally, and reset by double-click.
- User-visible desktop branding is now `Gugu Agent`; CLI recommendation is `cc-gugu` with `claude-gugu` kept as a compatibility entrypoint.
- Legacy paths such as `~/.claude/cc-haha/settings.json` remain unchanged and are labeled as compatibility paths where surfaced.
- IM adapter configuration scaffolding, config backup, session checkpoint/fork/rewind, provider presets, GLM parser settings, and Workbench UI have passing tests that do not require real API keys.

## Pending Real-Credential Review

- GLM parser live calls with a real GLM key: image, PDF/OCR, office document parser, and long-result summarization.
- ChatGPT Connect live OAuth and token refresh.
- DingTalk, WeCom, QQ, Telegram, and Feishu adapter end-to-end send/receive with real platform credentials.
- Domestic provider preset live model calls, including stage-router preference behavior against actual DeepSeek/GLM/Qwen endpoints.
- Updater release endpoint after the final release hosting URL is chosen.

## Verification Commands

```bash
cd desktop && bun run lint
cd desktop && bun run test
bun test src/server/__tests__/adapters.test.ts src/server/__tests__/config-backup.test.ts src/server/__tests__/provider-presets.test.ts src/server/__tests__/sessions.test.ts
git diff --check
```

## Notes

- Existing React test warnings about `act(...)` remain, but all relevant desktop and server tests pass.
- The working tree already included Phase 0-6 implementation changes before this productization pass; this document records the current combined state rather than claiming every file change belongs to the final cleanup step.

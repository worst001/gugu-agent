# Phase 3 Attachment Preview Progress

Branch: `feature-hwh-dev`

Goal: implement Phase 3 from `proma-inspired-desktop-roadmap.md`: file,
image, Markdown, PDF, and GLM parsed-result previews in the desktop workbench.

This file is the recovery anchor for interrupted work. Continue from the first
unchecked task after any disconnect or context compaction.

## Task List

- [x] T01 Expose GLM attachment parse preview metadata from the server.
- [x] T02 Store parse previews on the visible user message without changing chat text.
- [x] T03 Build attachment preview extraction in the workbench model.
- [x] T04 Implement `PreviewRenderer` for image, Markdown, text/code, PDF, and parsed Markdown.
- [x] T05 Add message attachment-to-workbench open actions.
- [x] T06 Wire Preview tab to attachment previews while preserving tool previews.
- [x] T07 Add focused backend/frontend tests.
- [x] T08 Run lint and full desktop test suite.

## Current Notes

- Chat transcript must keep showing only the user's real prompt.
- GLM parser metadata should be sent through neutral `system_notification`
  data and must not create a success bubble in chat.
- Do not add Office rendering libraries in this phase.
- Use existing `UIMessage[]` and `WorkbenchPanel` data flow from Phase 2.
- Phase 3 v1 is implemented and verified. Attachments in chat can open the
  workbench Preview tab; GLM parsed Markdown and the model-bound prompt are
  available there without polluting the visible chat transcript.

## Verification Results

- `rtk bun test src/server/__tests__/attachment-parser.test.ts`: passed.
- `cd desktop && rtk bun run lint`: passed.
- `cd desktop && rtk bun run test -- --run`: passed, 43 files / 246 tests.
- Existing React `act(...)` warnings still appear in desktop tests; they did
  not fail the suite and are not introduced by the Phase 3 preview path.

## Verification Commands

```powershell
bun test src/server/__tests__/attachment-parser.test.ts
cd desktop
bun run lint
bun run test -- --run
```

Focused command while iterating:

```powershell
cd desktop
bun run test -- src/components/workbench src/components/chat/chatBlocks.test.tsx src/components/chat/MessageList.test.tsx src/stores/chatStore.test.ts
```

# Phase 2 Agent Workbench Progress

Branch: `feature-hwh-dev`

Goal: implement the first right-side Agent Workbench from
`proma-inspired-desktop-roadmap.md`.

This file is the recovery anchor for interrupted work. If the session is
compacted, disconnected, or resumed later, continue from the first unchecked
task.

## Task List

- [x] T01 Define workbench state, tabs, and data model.
- [x] T02 Build tool activity aggregation from existing chat messages.
- [x] T03 Build changed-file extraction from Edit/Write/MultiEdit/Read tool events.
- [x] T04 Implement collapsible `WorkbenchPanel` shell.
- [x] T05 Implement Tool Activity tab.
- [x] T06 Implement Diff tab.
- [x] T07 Implement Preview tab.
- [x] T08 Add chat-to-workbench links from tool cards.
- [x] T09 Wire workbench into `ActiveSession` without blocking the composer.
- [x] T10 Add tests and run verification.

## Current Notes

- Data source for v1 is existing `UIMessage[]` in `chatStore`.
- Avoid a new file-history system in this phase; use tool inputs/results first.
- Keep the panel hidden behind a narrow rail when collapsed.
- On smaller screens, the panel must not steal composer width.
- Phase 2 v1 is implemented and verified. The workbench is hidden below `xl`,
  collapsed to a narrow right rail by default, and can be opened from tool
  cards into Diff or Preview depending on the tool type.
- Source checks:
  - React 18.3.1 project code, but official React hook docs remain compatible
    for `useMemo`/`useState`.
  - MDN ARIA tabs reference used for tab roles and selected state.

## Verification Commands

```powershell
cd desktop
bun run lint
bun run test -- --run
```

Focused commands while iterating:

```powershell
cd desktop
bun run test -- src/components/workbench src/pages/ActiveSession.test.tsx src/__tests__/pages.test.tsx
```

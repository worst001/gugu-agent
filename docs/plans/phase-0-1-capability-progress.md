# Phase 0 + Phase 1 Progress

Branch: `feature-hwh-dev`

Goal: implement Phase 0 and Phase 1 from `proma-inspired-desktop-roadmap.md`.

This file is the recovery anchor for interrupted work. If the session is
compacted, disconnected, or resumed later, continue from the first unchecked
task.

## Task List

### Phase 0: Baseline And Design

- [x] T01 Map current capability data sources.
- [x] T02 Define `CapabilitySummary` model and UI placement.
- [x] T03 Confirm implementation boundaries and validation plan.

### Phase 1: Capability Bar And Composer Polish

- [x] T04 Aggregate provider/model/effort/GLM/MCP/Skills/Plugins status.
- [x] T05 Implement `CapabilityBar` UI.
- [x] T06 Make capability items jump to the relevant settings tab.
- [x] T07 Refine GLM parser status: off, needs config, ready, error.
- [x] T08 Add session-scoped composer draft autosave.
- [x] T09 Add long-paste-to-attachment handling.
- [x] T10 Add tests and run verification.

## Current Notes

- React stack: desktop uses React 18.3.1, Zustand 5.0.3, Vite 6.0.7.
- Keep UI compact. Do not add more visual weight to the composer control strip.
- Prefer existing stores and APIs before adding new server endpoints.
- Do not disturb existing GLM attachment parser and CE model routing changes.
- Data source mapping:
  - provider/model/effort: `desktop/src/api/models.ts`
  - GLM parser: `desktop/src/api/attachmentParser.ts`
  - MCP count/status: `desktop/src/api/mcp.ts`
  - Skills count: `desktop/src/api/skills.ts`
  - Plugins count/status: `desktop/src/api/plugins.ts`
  - active workspace: `session.workDir` for the active session tab
- UI placement: sidebar footer, directly above Settings. This keeps the
  composer control strip from getting denser.
- Implementation boundary: add a desktop-only capability summary store and a
  compact sidebar component. Do not add a new server API in this phase.
- Implemented capability bar in the sidebar footer. It opens the matching
  settings tab for provider/model, effort, GLM parser, MCP, Skills, and Plugins.
- Composer drafts are text-only and keyed by session tab in localStorage. File
  attachments are intentionally not persisted to avoid filling localStorage.
- Pasted text at or above 12,000 characters is converted to a `.txt` attachment
  with a toast, instead of flooding the composer.
- Verification completed:
  - `cd desktop; bun run lint`
  - `cd desktop; bun run test -- --run`

## Verification Commands

```powershell
cd desktop
bun run lint
bun run test
```

If server APIs change:

```powershell
bun test src/server/__tests__/<related-test>.test.ts
```

Manual check:

- Capability display updates when provider/model/effort changes.
- GLM parser status is clear.
- Draft text survives tab switches.
- Long paste does not make the composer unusable.
- Input controls still fit on desktop and narrow widths.

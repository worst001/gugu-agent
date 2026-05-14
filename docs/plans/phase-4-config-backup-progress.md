# Phase 4 Config Backup Progress

Branch: `feature-hwh-dev`

Goal: implement Phase 4 from `proma-inspired-desktop-roadmap.md`: GuGu config
export, import preview, and non-sensitive import for migration and sharing.

This file is the recovery anchor for interrupted work. Continue from the first
unchecked task after any disconnect or context compaction.

## Task List

- [x] T01 Define `gugu-config-export.json` v1 format and secret masking rules.
- [x] T02 Add backend export, preview, and import service.
- [x] T03 Register `/api/config-backup/*` routes.
- [x] T04 Add desktop API client and Settings tab.
- [x] T05 Render import preview with additions, overwrites, and skipped items.
- [x] T06 Add backend and frontend regression tests.
- [x] T07 Run focused verification.
- [x] T08 Run desktop lint and full desktop tests.

## Current Notes

- API keys and token-like fields must be excluded by default.
- Providers and GLM parser configs can be imported without secrets; existing
  secrets must be preserved when an imported item omits them.
- MCP servers can be imported only for editable scopes.
- Skills and Plugins are exported as a shareable inventory in v1; importing
  them is reported as skipped because installing them may require network,
  marketplace state, and user confirmation.
- Agents and GUI preferences are safe to import when they are explicit config.
- Phase 4 v1 is implemented. The Settings page now has a Backup tab with safe
  export, JSON file import, preview, and apply actions.
- Provider and GLM keys are excluded by default. Import preserves existing
  secrets when the package omits them.
- Imported active providers only sync to runtime settings when the resulting
  provider still has usable auth.

## Verification Results

- `rtk bun test src/server/__tests__/config-backup.test.ts`: passed.
- `cd desktop && rtk bun run test -- src/__tests__/generalSettings.test.tsx`: passed.
- `cd desktop && rtk bun run lint`: passed.
- `cd desktop && rtk bun run test -- --run`: passed, 43 files / 248 tests.
- Existing React `act(...)` warnings still appear in desktop tests; they did
  not fail the suite and are not introduced by this backup tab path.

## Verification Commands

```powershell
bun test src/server/__tests__/config-backup.test.ts
cd desktop
bun run test -- src/__tests__/generalSettings.test.tsx
bun run lint
bun run test -- --run
```

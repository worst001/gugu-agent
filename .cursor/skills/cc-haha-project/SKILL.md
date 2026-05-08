---
name: cc-haha-project
description: Provides project context for Claude Code GuGu, a Bun/TypeScript Claude Code fork with CLI, local server, Tauri desktop app, IM adapters, MCP, Skills, multi-agent, and Computer Use. Use when working in this repository, planning features, debugging behavior, changing CLI/TUI/server/desktop/adapters/docs, or reasoning about Claude Code compatibility.
---

# Claude Code GuGu Project

## Quick Context

This repository is a local runnable fork of Claude Code. It keeps most upstream Claude Code behavior while adding Anthropic-compatible providers, a local HTTP/WebSocket server, a Tauri desktop app, IM adapters, multi-agent workflows, memory, Skills, and Computer Use.

Default to preserving Claude Code compatibility unless the user explicitly asks for a project-specific behavior change.

## First Steps For Any Change

1. Classify the target surface before editing:
   - CLI startup: `bin/claude-gugu`, `src/entrypoints/`, `src/main.tsx`
   - TUI: `src/screens/`, `src/components/`, `src/ink/`
   - Agent tools: `src/tools/`
   - Slash commands: `src/commands/`
   - API, MCP, OAuth, provider logic: `src/services/`
   - Desktop local server: `src/server/`
   - Desktop UI: `desktop/src/`
   - Tauri glue: `desktop/src-tauri/`
   - IM adapters: `adapters/`
   - Docs: `docs/`
2. Read the nearest existing implementation and test before inventing a new pattern.
3. Keep root CLI/server, `desktop/`, and `adapters/` dependency boundaries separate.
4. For user-facing or cross-surface behavior, update or add focused tests near the changed code.

## Important Paths

- `package.json`: root Bun package, private name `claude-code-local`, binary `claude-gugu`.
- `bin/claude-gugu`: executable wrapper. It loads `.env` unless `CC_HAHA_SKIP_DOTENV=1`, and routes `CLAUDE_CODE_FORCE_RECOVERY_CLI=1` to `src/localRecoveryCli.ts`.
- `src/entrypoints/cli.tsx`: main CLI entrypoint.
- `src/main.tsx`: main Commander.js and React/Ink CLI flow.
- `src/server/index.ts`: local REST and WebSocket server for desktop and remote clients. Defaults to `SERVER_PORT=3456` and localhost.
- `src/server/router.ts`: REST routing entry.
- `src/server/services/conversationService.ts`: starts and manages CLI-backed conversations for the server.
- `src/server/services/providerService.ts`: provider configuration and proxy URL generation.
- `desktop/src/App.tsx`: desktop app root.
- `desktop/src/api/`: desktop API clients.
- `desktop/src/stores/`: Zustand stores.
- `adapters/README.md`: current Telegram/Feishu adapter flow.
- `docs/guide/env-vars.md`: environment variable reference.
- `docs/en/reference/project-structure.md`: concise project structure reference.

## Commands

Use Bun for the root CLI/server unless docs workflow compatibility requires npm.

```bash
bun install
./bin/claude-gugu
bun run start
SERVER_PORT=3456 bun run src/server/index.ts
bun run docs:dev
bun run docs:build
```

Desktop:

```bash
cd desktop
bun install
bun run dev
bun run build
bun run test
bun run lint
```

Adapters:

```bash
cd adapters
bun install
bun run telegram
bun run feishu
bun test
```

## Compatibility Notes

- Treat `CLAUDE_CODE_*` environment variables as upstream compatibility surface.
- Use or preserve `CC_HAHA_*` for cc-haha-specific behavior.
- Be careful with dotenv loading. Desktop/server-spawned CLI processes use `CC_HAHA_SKIP_DOTENV=1` so stale `.env` provider keys do not override settings injected by the server.
- The desktop server injects values such as `CC_HAHA_DESKTOP_SERVER_URL`, `CC_HAHA_DESKTOP_AWAIT_MCP`, and Computer Use host bundle IDs into spawned sessions.
- Avoid broad rewrites of Claude Code-like flows unless the request is explicitly about replacing upstream behavior.
- Some dependencies are stubbed or adapted in `stubs/`; check `tsconfig.json` paths before assuming an upstream package is real.

## Style And Boundaries

- TypeScript, ESM imports, 2-space indentation, no semicolons.
- Prefer local helpers and existing service patterns over new abstractions.
- React components use `PascalCase`; functions, hooks, and stores use `camelCase`.
- Shared desktop UI belongs in `desktop/src/components/`; desktop API clients belong in `desktop/src/api/`.
- Do not add dependencies unless existing utilities cannot cover the task.
- Keep docs image assets and root screenshots as reference assets, not source code.

## Testing Guidance

- Root server and service tests live under nearby `__tests__` folders and generally run with Bun.
- Desktop tests use Vitest, Testing Library, and jsdom.
- For desktop changes, run `cd desktop && bun run test` or a focused Vitest target, and `cd desktop && bun run lint` when types are touched.
- For server changes, prefer focused tests under `src/server/__tests__/`.
- For adapter changes, run `cd adapters && bun test` or the platform-specific test script.

## Release And Docs Notes

- Desktop releases are built remotely by GitHub Actions from tags matching `v*.*.*`.
- Release notes must exist as `release-notes/vX.Y.Z.md` in the tagged commit.
- Use `bun run scripts/release.ts <version>` for normal desktop release preparation.
- The docs deploy workflow uses `npm ci`, so root dependency changes must keep `package-lock.json` in sync with `package.json`.

## Communication Defaults

When the user asks for project work in Chinese, respond in Chinese unless they request another language. Keep summaries concise and mention the exact verification command that was run or why it was skipped.

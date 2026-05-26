# Desktop 0.1.16 Release Packaging Runbook

Last updated: 2026-05-26

This document records the current desktop packaging flow for re-publishing `0.1.16`.
It is intentionally written as a handoff-safe runbook: if the active conversation is
compacted or lost, continue from the "Next Conversation Prompt" section.

## Current State

- Repository: `D:\Claude Code\claude-code-gugu`
- Current branch: `fix/bug-from-master`
- Current HEAD: `d48d16a release: v0.1.16`
- Local tag: `v0.1.16` exists and points at current HEAD.
- Local worktree status at time of writing: clean before this documentation change.
- Version files already contain `0.1.16`:
  - `desktop/package.json`
  - `desktop/src-tauri/tauri.conf.json`
  - `desktop/src-tauri/Cargo.toml`
- Root `package.json` intentionally uses `999.0.0-local`; do not treat it as the
  desktop release version.
- Release notes file exists: `release-notes/v0.1.16.md`.

## What Must Be Packaged

The desktop app must include the current project's built-in capability pack:
skills, plugins, and plugin-provided agents.

The canonical bundle input is:

```text
.agents/skills
```

Tauri packages it through `desktop/src-tauri/tauri.conf.json`:

```json
"resources": {
  "../../.agents/skills": "gugu-agent-pack"
}
```

The same Tauri config also packages the sidecar:

```json
"externalBin": [
  "binaries/gugu-sidecar"
]
```

The current `.agents/skills` pack contains:

- Top-level skills:
  - `api-and-interface-design`
  - `codegraph`
  - `context-engineering`
  - `doubt-driven-development`
  - `rtk-token-saver`
  - `source-driven-development`
  - `test-driven-development`
- Third-party pack:
  - `.agents/skills/third-party/compound-engineering-plugin`
- Bundled plugin marketplace entries from `.claude-plugin/marketplace.json`:
  - `compound-engineering`
  - `coding-tutor`
  - `engineering-advanced-skills`
  - `engineering-skills`
  - `claude-mem`
- Plugin-provided agents under the bundled plugins, including:
  - `plugins/compound-engineering/agents`
  - `plugins/engineering-advanced-skills/agenthub/agents`
  - `plugins/engineering-advanced-skills/autoresearch-agent/agents`
  - `plugins/engineering-advanced-skills/karpathy-coder/agents`
  - `plugins/engineering-advanced-skills/llm-wiki/agents`
  - `plugins/engineering-skills/playwright-pro/agents`
  - `plugins/engineering-skills/self-improving-agent/agents`

Runtime bootstrap path:

1. Rust resolves the packaged resource as `gugu-agent-pack`.
2. Rust injects `GUGU_AGENT_PACK_DIR` into the server and adapter sidecar environment.
3. `src/server/services/bundledAgentPackService.ts` bootstraps the pack.
4. Top-level skills and plugin skills are copied into the user config skill area
   unless the user has modified that target.
5. `.claude-plugin/marketplace.json` is registered as marketplace `gugu-bundled`.
6. Bundled plugins are registered and enabled through the normal plugin system.
7. Plugin-provided agents travel with their plugin directories and are loaded by
   the plugin system.

Important runtime filters:

- Discovery skips `.git`, `node_modules`, and `dist`.
- Skill and marketplace discovery skips test and fixture paths for activation.
- The Tauri resource mapping packages the `.agents/skills` directory as source
  material; runtime decides what to activate.

## Packaging Specification

This section is the required packaging standard for desktop `0.1.16`.

### Packaging Scope

Every official desktop package must contain:

- Desktop frontend from `desktop/dist`.
- Tauri Rust app from `desktop/src-tauri`.
- Compiled sidecar binary named from `gugu-sidecar`.
- Built-in capability pack mounted as `gugu-agent-pack`.
- Windows installer artifact for x64.
- macOS installer artifact for Apple Silicon.
- Signed updater artifacts for both supported platforms.

The capability pack requirement is mandatory. A release is incomplete if the
installer starts but the built-in skills, bundled plugins, or plugin-provided
agents are missing.

### Packaging Inputs

Use only committed repository contents from the release ref.

Required source inputs:

```text
desktop/
src/
adapters/
.agents/skills/
release-notes/v0.1.16.md
```

Required config inputs:

```text
desktop/package.json
desktop/src-tauri/tauri.conf.json
desktop/src-tauri/Cargo.toml
desktop/src-tauri/Cargo.lock
.github/workflows/release-desktop.yml
```

Do not manually copy user-local skill/plugin folders from outside the repository
into a release package. The release package source of truth is `.agents/skills`
in the tagged commit.

### Packaging Version Rules

For `0.1.16`, these files must all agree:

```text
desktop/package.json                 version = 0.1.16
desktop/src-tauri/tauri.conf.json     version = 0.1.16
desktop/src-tauri/Cargo.toml          version = 0.1.16
release-notes/v0.1.16.md              exists
git tag                               v0.1.16
```

Ignore root `package.json` version for desktop packaging. It is intentionally
`999.0.0-local`.

### Packaging Commands

Official packaging must run in CI through:

```text
.github/workflows/release-desktop.yml
```

Windows packaging command:

```powershell
cd desktop
.\scripts\build-windows-x64.ps1
```

macOS packaging command:

```bash
bash ./desktop/scripts/build-macos-arm64.sh
```

Both packaging scripts must install root, desktop, and adapter dependencies
before the build unless `SKIP_INSTALL=1` is intentionally set for local
diagnostics.

### Packaging Artifact Names

Windows package output must use:

```text
Gugu-Agent-0.1.16-windows-x64.msi
```

macOS package output must use:

```text
Gugu-Agent-0.1.16-aarch64.dmg
```

Updater artifact names must use:

```text
Gugu-Agent-0.1.16-windows-x64.msi.zip
Gugu-Agent-0.1.16-windows-x64.msi.zip.sig
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz.sig
```

### Packaging Verification

Before release publication, verify the package contains:

- `gugu-sidecar` binary for the target platform.
- `gugu-agent-pack/api-and-interface-design/SKILL.md`.
- `gugu-agent-pack/third-party/compound-engineering-plugin/.claude-plugin/marketplace.json`.
- `gugu-agent-pack/third-party/compound-engineering-plugin/plugins/compound-engineering`.
- `gugu-agent-pack/third-party/compound-engineering-plugin/plugins/engineering-advanced-skills`.
- `gugu-agent-pack/third-party/compound-engineering-plugin/plugins/engineering-skills`.
- plugin `agents` directories listed in "What Must Be Packaged".

Runtime smoke test must confirm:

- sidecar starts
- built-in skills show up
- bundled plugins show up
- `gugu-bundled` marketplace exists
- plugin-provided agents are discoverable

## Publishing Specification

This section is the required publication standard for desktop `0.1.16`.

### Publishing Scope

Publishing is the act of making CI-produced artifacts available through:

- OSS public download bucket
- OSS updater metadata endpoint
- Gitee Release `v0.1.16`

Publishing must not rebuild from an uncommitted local workspace. The publish job
must use artifacts produced by the Windows and macOS CI packaging jobs.

### Publishing Inputs

Required CI artifacts:

```text
desktop-windows-x64
desktop-macos-arm64
```

Required release metadata:

```text
release-notes/v0.1.16.md
desktop/build-artifacts/windows-x64/latest.json
desktop/build-artifacts/macos-arm64/latest.json
```

Required publish secrets:

```text
GUGU_OSS_ACCESS_KEY_ID
GUGU_OSS_ACCESS_KEY_SECRET
GUGU_OSS_BUCKET
GUGU_OSS_ENDPOINT
GUGU_OSS_PUBLIC_BASE_URL
GUGU_GITEE_ACCESS_TOKEN
```

Required updater signing secrets during packaging:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

### Publishing Commands

Merge platform updater manifests:

```bash
cd desktop
bun run release:updater-manifest
```

Publish to OSS:

```bash
bun run release:desktop:oss -- --require-updater --publish
```

Publish to Gitee:

```bash
bun run release:desktop:gitee -- --publish
```

For the same-version `0.1.16` re-publication, prefer workflow dispatch or rerun
with:

```text
publish = true
require_updater = true
```

Do not publish with `--allow-partial` for the official release unless there is
an explicit incident decision to ship only one platform.

### Publishing OSS Standard

OSS must contain immutable versioned artifacts:

```text
Gugu-Agent-0.1.16-windows-x64.msi
Gugu-Agent-0.1.16-aarch64.dmg
Gugu-Agent-0.1.16-windows-x64.msi.zip
Gugu-Agent-0.1.16-windows-x64.msi.zip.sig
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz.sig
```

OSS must contain mutable latest metadata and aliases:

```text
Gugu-Agent-latest-windows-x64.msi
Gugu-Agent-latest-aarch64.dmg
release.json
latest.json
```

Cache policy:

- versioned installers and updater archives: long-lived immutable cache
- latest aliases, `release.json`, and `latest.json`: no-cache

### Publishing Updater Standard

The final OSS `latest.json` must:

- have `version: "0.1.16"`
- include release notes when available
- include a valid RFC3339 `pub_date`
- include all required platform aliases:

```text
darwin-aarch64-app
darwin-aarch64
windows-x86_64-msi
windows-x86_64
```

Each platform entry must point at the OSS public base URL and contain a signature
that exactly matches the corresponding `.sig` file.

### Publishing Gitee Standard

Gitee Release must:

- be tagged `v0.1.16`
- be named `Gugu Agent v0.1.16`
- use `release-notes/v0.1.16.md` as the body source
- include SHA256 values from `desktop/build-artifacts/release.json`
- link to the OSS installer URLs from `desktop/build-artifacts/release.json`

```text
Gugu-Agent-0.1.16-windows-x64.msi
Gugu-Agent-0.1.16-aarch64.dmg
```

OSS is the canonical binary and updater artifact host. Gitee installer
attachments are optional; for `0.1.16` the workflow publishes the Gitee Release
body with `--skip-assets` to avoid large attachment uploads hanging the release
pipeline. If Gitee attachments are intentionally required later, run
`bun run release:desktop:gitee -- --publish` after confirming the Gitee upload
path is healthy. Existing same-named assets are replaced unless
`--keep-existing-assets` is intentionally used.

### Publishing Verification

After publishing, verify:

- OSS versioned artifact URLs download successfully.
- OSS latest installer aliases download successfully.
- OSS `release.json` says `0.1.16`.
- OSS `latest.json` says `0.1.16` and includes all platform aliases.
- Gitee Release `v0.1.16` exists.
- Gitee Release body is readable and references correct OSS URLs and SHA256
  values.
- A fresh install can launch and discover packaged skills/plugins/agents.

## Normal New Release Flow

Use this for future versions such as `0.1.17`, not for re-publishing an already
tagged `0.1.16`.

1. Create or update `release-notes/vX.Y.Z.md`.
2. Run:

```bash
bun run scripts/release.ts X.Y.Z
```

The release script updates:

- `desktop/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`
- `desktop/src-tauri/Cargo.lock`

It then creates:

- commit `release: vX.Y.Z`
- annotated tag `vX.Y.Z`

3. Push the release commit and tag to the release remote.

The desktop build itself is done by GitHub Actions, not by uploading local
artifacts.

## Re-Publishing 0.1.16

Because `0.1.16` is already committed and tagged locally, do not run
`bun run scripts/release.ts 0.1.16` unless the tag has first been intentionally
removed. Running it against the same version will try to create another release
commit/tag and is the wrong default for this situation.

Preferred path:

1. Confirm the release ref is still `d48d16a release: v0.1.16`.
2. Trigger `.github/workflows/release-desktop.yml` manually with:
   - ref: a branch or tag that contains `d48d16a`
   - `publish`: `true`
   - `require_updater`: `true`
3. Let CI rebuild Windows and macOS artifacts.
4. Let the publish job regenerate updater metadata and publish to OSS and Gitee.

Alternative path if a tag push must retrigger the workflow:

1. Confirm the remote tag state first.
2. Only if the team intentionally wants to replace the remote tag, delete and
   recreate `v0.1.16` so it still points to `d48d16a`.
3. Push the tag.

Do not move `v0.1.16` to a different commit without explicitly agreeing that
the re-release is no longer byte-for-byte tied to the current release commit.

## CI Packaging Flow

Canonical workflow:

```text
.github/workflows/release-desktop.yml
```

Triggers:

- manual `workflow_dispatch`
- push to `ci/desktop-release`
- tags matching `v*.*.*`

### Windows Job

Job: `build-windows`

Runner: `windows-2022`

Build script:

```powershell
cd desktop
.\scripts\build-windows-x64.ps1
```

The script:

- installs root dependencies with `bun install`
- installs desktop dependencies with `bun install`
- installs adapter dependencies when `adapters/package.json` exists
- builds the sidecar through Tauri's `beforeBuildCommand`
- builds a Windows x64 MSI
- requires `TAURI_SIGNING_PRIVATE_KEY` for official updater artifacts
- stages canonical artifacts under:

```text
desktop/build-artifacts/windows-x64/
```

Expected Windows outputs for `0.1.16`:

```text
Gugu-Agent-0.1.16-windows-x64.msi
Gugu-Agent-0.1.16-windows-x64.msi.sig
Gugu-Agent-0.1.16-windows-x64.msi.zip
Gugu-Agent-0.1.16-windows-x64.msi.zip.sig
latest.json
BUILD_INFO.txt
```

### macOS Job

Job: `build-macos`

Runner: `macos-15`

Build script:

```bash
bash ./desktop/scripts/build-macos-arm64.sh
```

The workflow sets `SIGN_BUILD=1` for official signed updater artifacts.

The script:

- installs root dependencies with `bun install`
- installs desktop dependencies with `bun install`
- installs adapter dependencies when `adapters/package.json` exists
- rebuilds frontend and sidecar
- builds app and DMG for `aarch64-apple-darwin`
- signs updater archive when signing env vars are present
- stages canonical artifacts under:

```text
desktop/build-artifacts/macos-arm64/
```

Expected macOS outputs for `0.1.16`:

```text
Gugu-Agent-0.1.16-aarch64.dmg
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz.sig
latest.json
BUILD_INFO.txt
```

### Publish Job

Job: `publish`

Runs after both platform builds.

The job:

1. Downloads `desktop-windows-x64`.
2. Downloads `desktop-macos-arm64`.
3. Validates OSS and Gitee secrets.
4. Merges platform updater manifests:

```bash
cd desktop
bun run release:updater-manifest
```

5. Uploads installers, latest aliases, updater files, and metadata to OSS:

```bash
bun run release:desktop:oss -- --require-updater --publish
```

6. Creates or updates the Gitee Release body, using OSS as the binary host:

```bash
bun run release:desktop:gitee -- --publish --skip-assets
```

Required CI secrets/env for publish:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
GUGU_OSS_ACCESS_KEY_ID
GUGU_OSS_ACCESS_KEY_SECRET
GUGU_OSS_BUCKET
GUGU_OSS_ENDPOINT
GUGU_OSS_PUBLIC_BASE_URL
GUGU_GITEE_ACCESS_TOKEN
```

Optional/defaulted:

```text
GUGU_GITEE_OWNER = xiyouwangluo
GUGU_GITEE_REPO = claude-code-gugu
```

## OSS Outputs

The OSS upload script writes `desktop/build-artifacts/release.json` and uploads:

Versioned installers:

```text
Gugu-Agent-0.1.16-windows-x64.msi
Gugu-Agent-0.1.16-aarch64.dmg
```

Latest installer aliases:

```text
Gugu-Agent-latest-windows-x64.msi
Gugu-Agent-latest-aarch64.dmg
```

Download metadata:

```text
release.json
```

Updater metadata and signed updater artifacts:

```text
latest.json
Gugu-Agent-0.1.16-windows-x64.msi.zip
Gugu-Agent-0.1.16-windows-x64.msi.zip.sig
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz
Gugu-Agent-0.1.16-darwin-aarch64.app.tar.gz.sig
```

The final `latest.json` must contain version `0.1.16` and platform aliases:

```text
darwin-aarch64-app
darwin-aarch64
windows-x86_64-msi
windows-x86_64
```

## Gitee Release Outputs

The Gitee publish script creates or updates release `v0.1.16` in:

```text
xiyouwangluo/claude-code-gugu
```

It uses:

```text
release-notes/v0.1.16.md
desktop/build-artifacts/release.json
```

Expected installer links in the release body:

```text
Gugu-Agent-0.1.16-windows-x64.msi
Gugu-Agent-0.1.16-aarch64.dmg
```

The workflow skips Gitee attachment uploads for `0.1.16`; OSS carries the
installers, latest aliases, signed updater archives, signatures, `latest.json`,
and `release.json`.

It also writes a rendered body for inspection:

```text
desktop/build-artifacts/gitee-release-body.md
```

Before considering the release complete, inspect that generated body for readable
release notes and correct SHA256 lines.

## Preflight Checklist

Run before triggering or re-triggering release packaging:

```bash
rtk git status
git tag --list v0.1.16
git log --oneline --decorate -5
```

Confirm:

- worktree is clean except intentional documentation edits
- `v0.1.16` points at `d48d16a`
- `desktop/package.json` version is `0.1.16`
- `desktop/src-tauri/tauri.conf.json` version is `0.1.16`
- `desktop/src-tauri/Cargo.toml` version is `0.1.16`
- `release-notes/v0.1.16.md` exists
- `desktop/src-tauri/tauri.conf.json` still maps:

```json
"../../.agents/skills": "gugu-agent-pack"
```

Recommended local validation:

```bash
cd desktop
bun run lint
bun run test
```

Recommended bundled pack regression tests from repo root:

```bash
bun test src/server/__tests__/bundled-agent-pack.test.ts src/server/__tests__/plugins.test.ts
```

Use RTK wrappers for broad output when helpful:

```bash
rtk test bun run lint
rtk test bun test src/server/__tests__/bundled-agent-pack.test.ts src/server/__tests__/plugins.test.ts
```

## Post-Publish Checklist

After CI finishes:

- Windows job succeeded.
- macOS job succeeded.
- Publish job succeeded.
- `desktop/build-artifacts/latest.json` from CI merged all four platform aliases.
- OSS has the new versioned installers.
- OSS latest aliases point to the new installers.
- OSS `latest.json` points to `0.1.16` updater archives and valid signatures.
- OSS `release.json` reports version `0.1.16`.
- Gitee release `v0.1.16` exists.
- Generated Gitee release body has readable notes, correct OSS installer URLs,
  and correct SHA256 values.
- Smoke test installer:
  - app launches
  - sidecar starts
  - settings show built-in skills/plugins/agents
  - `gugu-bundled` marketplace appears
  - bundled skills are visible

## Local Build Fallback

Official release artifacts should come from CI. Use local builds only for
diagnosis or emergency verification.

Windows:

```powershell
cd desktop
.\scripts\build-windows-x64.ps1
```

macOS Apple Silicon:

```bash
export TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/path/to/tauri-updater.key"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..."
export SIGN_BUILD=1
./desktop/scripts/build-macos-arm64.sh
```

Without updater signing keys, local builds may intentionally disable updater
artifacts. Do not publish unsigned local updater artifacts as the official
release.

## Known Risks And Notes

- PowerShell in this environment may print an execution-policy profile warning.
  That warning is noisy but not itself a release failure.
- The repository instructions say desktop releases are built remotely by GitHub
  Actions; follow that for official packaging.
- This repository asks for normal product branch prefixes such as `fix/` and
  `feat/`; do not create a `codex/` branch here.
- Manual re-publication of the same version should prefer workflow re-run or
  `workflow_dispatch`. Replacing a remote tag is a release-management decision
  and should be explicit.
- The bundled capability pack is large. Avoid broad recursive text searches over
  `desktop/build-artifacts` or `desktop/src-tauri/target`; those directories can
  explode context.

## Handoff Summary

We are preparing to re-publish desktop `0.1.16`.

Confirmed facts:

- Current repo is `D:\Claude Code\claude-code-gugu`.
- Current HEAD is `d48d16a release: v0.1.16`.
- Local tag `v0.1.16` exists at that HEAD.
- Desktop version files already say `0.1.16`.
- Release notes `release-notes/v0.1.16.md` exists.
- Packaging source for built-in skills/plugins/agents is `.agents/skills`.
- Tauri maps `.agents/skills` to resource `gugu-agent-pack`.
- Rust sidecar launcher injects `GUGU_AGENT_PACK_DIR`.
- Server bootstrap registers `gugu-bundled` marketplace, installs bundled
  skills, and enables bundled plugins.
- Bundled plugins include `compound-engineering`, `coding-tutor`,
  `engineering-advanced-skills`, `engineering-skills`, and `claude-mem`.
- Official packaging path is `.github/workflows/release-desktop.yml`.
- For re-publishing the same `0.1.16`, prefer manually dispatching or rerunning
  the workflow with `publish=true` and `require_updater=true` instead of running
  the version bump script again.

Immediate next step after user confirmation:

1. Re-check `rtk git status`, tag, and version files.
2. Decide whether to use workflow dispatch or tag re-push.
3. Trigger CI release packaging.
4. Monitor Windows, macOS, and publish jobs.
5. Verify OSS, updater `latest.json`, `release.json`, and Gitee release.

## Next Conversation Prompt

```text
继续发布 Gugu Agent Desktop 0.1.16。请先阅读 docs/plans/desktop-0.1.16-release-packaging-runbook.md，然后按文档确认当前状态。目标是重新发布同一个 0.1.16，并确保 .agents/skills 中的 skills、plugins、plugin agents 被打进桌面包。已知当前目标提交是 d48d16a release: v0.1.16，本地 tag v0.1.16 指向它，desktop/package.json、desktop/src-tauri/tauri.conf.json、desktop/src-tauri/Cargo.toml 都是 0.1.16。优先使用 .github/workflows/release-desktop.yml 的 workflow_dispatch 或 rerun，publish=true，require_updater=true；不要默认重新跑 scripts/release.ts 生成新 tag，除非确认要替换远程 tag。发布后检查 OSS release.json/latest.json、Windows MSI、macOS DMG、updater artifacts/signatures，以及 Gitee release v0.1.16。
```

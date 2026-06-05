# Desktop Release Tooling

This document describes the first CLI version of the desktop release cockpit.
The canonical release policy remains `docs/plans/desktop-release-packaging-runbook.md`.

## Entry Point

Daily releases should start from the one-click runner:

```powershell
# PowerShell wrapper: loads local GitHub/OSS/Gitee env scripts when present.
.\scripts\desktop-release-one-click.ps1 -Mode plan -Version 0.2.5

# 1. Cut release commit/tag and trigger CI. First dry-run, then execute.
.\scripts\desktop-release-one-click.ps1 -Mode cut -Version 0.2.5
.\scripts\desktop-release-one-click.ps1 -Mode cut -Version 0.2.5 -Execute

# 2. Generate platform smoke receipt templates.
.\scripts\desktop-release-one-click.ps1 -Mode smoke-templates -Version 0.2.5 -PreviousVersion 0.2.4

# 3. After CI artifacts are downloaded and smoke receipts are filled, publish.
.\scripts\desktop-release-one-click.ps1 -Mode publish -Version 0.2.5 -PreviousVersion 0.2.4
.\scripts\desktop-release-one-click.ps1 -Mode publish -Version 0.2.5 -PreviousVersion 0.2.4 -Publish
```

The same runner is available through Bun:

```powershell
bun run release:desktop:one-click -- plan --version 0.2.5
bun run release:desktop:one-click -- cut --version 0.2.5 --execute
bun run release:desktop:one-click -- publish --version 0.2.5 --previous-version 0.2.4 --publish
```

The lower-level phase runner remains available when a release needs manual
control:

```powershell
bun run release:desktop:orchestrate -- --help
```

The orchestrator is intentionally phase-based. It wraps the existing release
scripts instead of replacing them.

```powershell
bun run release:desktop:orchestrate -- preflight --version 0.2.5
bun run release:desktop:orchestrate -- prepare --version 0.2.5
bun run release:desktop:orchestrate -- prepare --version 0.2.5 --execute
bun run release:desktop:orchestrate -- ci --version 0.2.5
bun run release:desktop:orchestrate -- check --version 0.2.5 --previous-version 0.2.4
bun run release:desktop:orchestrate -- publish-downloads --version 0.2.5
bun run release:desktop:orchestrate -- publish-downloads --version 0.2.5 --publish
bun run release:desktop:orchestrate -- publish-updater --version 0.2.5 --previous-version 0.2.4
bun run release:desktop:orchestrate -- publish-updater --version 0.2.5 --previous-version 0.2.4 --publish
bun run release:desktop:orchestrate -- publish-gitee --version 0.2.5 --publish
```

For an incident fix where the installer/updater artifacts are already correct
but the online updater metadata is wrong, use the narrow OSS uploader mode after
backing up the current online `latest.json`:

```powershell
.\scripts\desktop-release-one-click.ps1 -Mode metadata-fix -Version 0.2.5
.\scripts\desktop-release-one-click.ps1 -Mode metadata-fix -Version 0.2.5 -Publish
```

## Safety Model

- `prepare` is dry-run unless `--execute` is set.
- `ci` prints push commands unless `--execute` is set.
- `publish-downloads`, `publish-updater`, and `publish-gitee` are dry-run unless
  `--publish` is set.
- `publish-downloads` uploads installers and `release.json` only.
- `publish-updater` uploads updater artifacts and switches online `latest.json`.
- `publish-updater` refuses to run with `--skip-smoke`.
- Existing local or remote tags block `preflight` and `prepare` unless
  `--allow-existing-tag` is set for incident handling.
- OSS upload refuses updater signatures that include Tauri signer log text such
  as `Your file was signed successfully...`; `latest.json` must contain only the
  single-line `Public signature` value.

## Smoke Receipts

Updater publishing requires machine-readable smoke receipts. Default paths:

```text
desktop/build-artifacts/release-smoke/windows-vX.Y.Z.json
desktop/build-artifacts/release-smoke/macos-vX.Y.Z.json
```

Create editable templates:

```powershell
bun run release:desktop:smoke-receipt -- template --platform windows --version 0.2.5 --previous-version 0.2.4
bun run release:desktop:smoke-receipt -- template --platform macos --version 0.2.5 --previous-version 0.2.4
```

After the platform smoke is complete, set `status` to `passed`, fill the evidence
fields, flip only the checks that were actually verified to `true`, then validate:

```powershell
bun run release:desktop:smoke-receipt -- validate --path desktop/build-artifacts/release-smoke/windows-v0.2.5.json --version 0.2.5 --previous-version 0.2.4
```

## macOS Upgrade Smoke Script

On the Apple Silicon Mac, after pulling the release branch and copying CI
artifacts into `desktop/build-artifacts/`, run the macOS helper in two phases.
Install the old public version first, then set up local updater staging:

```bash
bun run release:desktop:macos-smoke -- --mode setup --version 0.2.5 --previous-version 0.2.4
```

The setup phase:

- copies the merged `latest.json` and darwin updater artifacts into a temporary
  staging directory
- creates a temporary trusted certificate for
  `gxy-download.oss-cn-shanghai.aliyuncs.com`
- backs up `/etc/hosts` and points that domain at `127.0.0.1`
- starts a local HTTPS server on port 443

Then open the old app and trigger the in-app update. After the upgraded app is
installed, verify and clean up:

```bash
bun run release:desktop:macos-smoke -- --mode verify --version 0.2.5 --previous-version 0.2.4
```

The verify phase checks the installed app version, runs
`codesign --verify --deep --strict`, verifies the sidecar binary signature,
restores `/etc/hosts`, removes the temporary certificate, records the online
`latest.json` version after cleanup, and writes:

```text
desktop/build-artifacts/release-smoke/macos-v0.2.5.json
```

If setup needs manual recovery:

```bash
bun run release:desktop:macos-smoke -- --mode cleanup --version 0.2.5
```

Minimum Windows receipt:

```json
{
  "platform": "windows",
  "version": "0.2.5",
  "previousVersion": "0.2.4",
  "status": "passed",
  "upgrade": { "passed": true, "from": "0.2.4", "to": "0.2.5" },
  "checks": {
    "appVersionOk": true,
    "sidecarOk": true,
    "mainExeExists": true,
    "shortcutTargetsValid": true,
    "noInstallerWarnings": true
  },
  "cleanup": {
    "hostsRestored": true,
    "stagingServerStopped": true,
    "tempCertRemoved": true,
    "onlineLatestVersion": "0.2.4"
  }
}
```

Minimum macOS receipt:

```json
{
  "platform": "macos",
  "version": "0.2.5",
  "previousVersion": "0.2.4",
  "status": "passed",
  "upgrade": { "passed": true, "from": "0.2.4", "to": "0.2.5" },
  "checks": {
    "appVersionOk": true,
    "sidecarOk": true,
    "codesignStrict": true,
    "appRelaunchOk": true
  },
  "cleanup": {
    "hostsRestored": true,
    "stagingServerStopped": true,
    "tempCertRemoved": true,
    "onlineLatestVersion": "0.2.4"
  }
}
```

## Reports

Every `check` and publish phase writes:

```text
desktop/build-artifacts/release-report-vX.Y.Z.md
```

The report records artifact paths, sizes, hashes, smoke receipt paths, and gate
failures/warnings. It is a local release artifact and should not be committed.

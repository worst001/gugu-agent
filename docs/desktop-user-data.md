# Desktop User Data

Gugu Agent stores desktop-owned preferences separately from CLI and domain data.
The desktop profile is versioned, validated, and written automatically; users do
not need to save settings manually.

## Storage Ownership

The packaged desktop app asks Tauri for the platform-native application folders:

- `profile.json` is stored in the app configuration directory.
- `workspace-state.json` is stored in the app data directory.

The application identifier remains `com.guxingyao.guguagent.desktop`. Browser and
sidecar development without Tauri falls back to
`~/.claude/cc-haha/desktop/`. Tests should override
`GUGU_DESKTOP_CONFIG_DIR` and `GUGU_DESKTOP_DATA_DIR` with isolated directories.

`profile.json` owns appearance, language, layout, and dismissed-update choices.
`workspace-state.json` owns pinned or hidden projects, persistable tabs, bounded
composer drafts, and per-session tool selections. Draft and terminal tabs remain
ephemeral by design.

Providers, MCP servers, agents, skills, plugins, scheduled tasks, conversations,
models, effort, permission mode, and default working directory keep their existing
owners. API keys, OAuth tokens, and other secrets are never written to the desktop
profile files.

## Upgrade And Recovery

Normal installer upgrades and hot updates replace application files without
removing AppConfig or AppData, so user choices survive an update. On first launch
after this storage model is introduced, valid values from the previous WebView
localStorage are migrated once. The old keys are mirrored for one release to allow
rollback, but the profile files are authoritative after migration.

Each write is validated, serialized, and committed through a temporary sibling
file. A last-known-good `.bak` copy is retained. Invalid JSON is renamed with a
`.corrupt-<timestamp>` suffix; startup then restores the backup or uses field-level
defaults. The product default theme remains `dark`.

## Backup And Removal

Configuration export format version 2 includes desktop preferences in the existing
GUI-preferences section. Private workspace state and credentials are excluded by
default and are included only when the private-backup option is enabled. Version 1
packages remain importable, including migration of their legacy theme value.

Settings provides an explicit **Reset desktop data** action. It removes only the
desktop profile, workspace state, their backups, quarantined corrupt copies, and
the one-release localStorage mirrors. It does not remove conversations, providers,
agents, CLI settings, or credentials.

Updater-driven replacement must never delete these directories. On macOS, moving
the application to Trash cannot execute cleanup code, so the in-app reset action is
the supported complete desktop-profile removal path. Installer-specific removal
behavior must be verified in the packaged release smoke before publishing.

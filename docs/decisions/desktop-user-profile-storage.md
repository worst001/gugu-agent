# Desktop User Profile Storage

Status: Accepted, 2026-07-13

## Context

Desktop-owned settings were spread across WebView localStorage and CLI/domain
configuration files. That made upgrades dependent on WebView cache retention and
allowed two sources of truth for values such as the theme.

## Decision

The sidecar owns two versioned JSON files whose production directories are
resolved by Tauri:

- `profile.json` in AppConfig stores durable desktop preferences.
- `workspace-state.json` in AppData stores bounded, recoverable work state.

Tauri passes these directories to the sidecar as
`GUGU_DESKTOP_CONFIG_DIR` and `GUGU_DESKTOP_DATA_DIR`. Browser development and
tests use an explicit environment directory or the existing Claude config root
as a compatibility fallback.

Writes are validated, serialized per file, and committed by sibling temporary
file rename. A last-known-good `.bak` is retained. Invalid JSON is quarantined
with a timestamp and falls back to the backup or schema defaults.

Existing localStorage values are a one-time migration source. After migration,
the files are authoritative. The theme remains mirrored in localStorage only so
the first frame uses the user's selected tone before the sidecar responds.

## Ownership

The profile owns theme, language, desktop layout, update dismissal, project-list
preferences, recoverable tabs, composer drafts, and per-session desktop tool
selections. The default theme remains `dark`.

CLI settings, conversations, AgentTask events, providers, MCP configuration,
Agents, skills, adapters, scheduled tasks, API keys, OAuth tokens, and other
secrets remain in their existing domain-owned stores. Profile APIs reject
unknown fields rather than becoming a generic configuration bucket.

## Lifecycle

Normal application updates preserve AppConfig and AppData. Data removal is an
explicit in-app operation and never runs from the generic updater or process-kill
installer hook. Reset removes only the two owned files, their backups, and their
quarantined copies.

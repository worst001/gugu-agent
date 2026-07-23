# IM QR Onboarding Control Plane

Status: Accepted for the WeChat and Feishu QR PoC, 2026-07-23

## Context

Gugu already has a working IM data plane:

```text
platform adapter -> authorization check -> TextChatRunner / WsBridge
                 -> local Gugu session -> platform reply
```

The previous desktop flow exposed provider credentials, project selection, pairing,
diagnostics, and every platform form on one page. QR-capable providers do not
need those fields in the primary user journey. They do still need a durable
authorization control plane and the existing adapter runtime.

The implementation was checked against the current Gugu source, Tencent's
`openclaw-weixin` QR/iLink implementation, Kun's platform-install control
plane, and the official Lark Node SDK app-registration flow. Kun's code is
architecture evidence only; it is PolyForm Noncommercial licensed and is not
copied into Gugu.

References checked on 2026-07-23:

- https://github.com/Tencent/openclaw-weixin
- https://github.com/KunAgent/Kun/blob/master/src/main/claw-platform-install.ts
- https://github.com/larksuite/node-sdk#app-registration

## Decision

Use a small provider-specific install control plane in the existing local Bun
server. Keep message transport in the existing Tauri-managed adapter sidecar.

```text
Settings / sidebar Phone
  -> local /api/adapters/{provider}/installations
  -> provider authorization endpoint
  -> credential store + non-secret adapter metadata
  -> restart existing combined adapter sidecar
  -> provider adapter -> TextChatRunner -> existing Gugu session
```

There is no third gateway and no second session runtime. Provider-only fields
such as WeChat `context_token`, `get_updates_buf`, redirect host, and iLink
message shapes remain inside `adapters/weixin`.

The Settings navigation keeps its IM entry. Its content is the compact phone
connection view. The old manual pairing/configuration page remains in source as
a rollback path but is not rendered by the default Settings route.

## WeChat installation lifecycle

The local API exposes an opaque installation ID and a local QR data URL. It
never returns the provider QR ticket or bot token.

```text
waiting -> scanned -> needs_verification -> scanned -> authorized
   |          |               |
   +----------+---------------+-> expired / failed / cancelled
```

Installations expire after five minutes. Concurrent start requests are
coalesced. Verification is accepted only in the provider-requested state. A
confirmed response must contain the bot ID, bot token, and scanner user ID; the
scanner is added to `pairedUsers` before the channel is usable.

Authorization and disconnect both restart the Tauri-managed adapter sidecar.
This is required because the combined process reads credentials at startup.
Disconnect deletes the credential before restart, so an in-memory token cannot
continue receiving messages.

## Storage and recovery

Non-secret WeChat metadata and the scanner allowlist live in
`~/.claude/adapters.json`. The bot token lives separately in
`~/.claude/weixin/credentials.json`. Both writes use sibling temporary files,
atomic rename, cleanup on failure, and owner-only mode on POSIX. The token is
not returned by an API, placed in renderer state, or written to normal logs.

The WeChat update cursor lives in `~/.claude/weixin/cursor.json`, is scoped by
account ID, and recovers as an empty cursor when its JSON is malformed. Polling
uses bounded requests and backoff. UI installation polling retries transient
local/provider errors.

The current cursor policy waits for every message handler in a provider batch
before committing the provider cursor. Handler failures leave the cursor
unchanged and release the in-memory dedup reservation so the message can be
retried. A crash after some handlers finish but before the batch cursor is
committed can replay those messages after restart because deduplication is
memory-only. A persistent inbox or idempotent acknowledgement remains the
production-grade upgrade.

## Security boundary

The local server binds to `127.0.0.1` by default and rejects untrusted browser
origins. QR provider traffic and saved API base URLs require HTTPS. Installation
IDs are random, QR sessions expire, cancellation is supported, and API responses
exclude credentials. The scanner identity is required because the old pairing
UI is hidden and an unpaired account would otherwise be unusable.

The current credential file is a PoC compromise, not a production vault.
Owner-only mode does not encrypt the token at rest and gives limited protection
on Windows against another process running as the same user.

Production release gate:

- store provider secrets in Windows Credential Manager, macOS Keychain, and an
  explicitly supported Linux secret service;
- pass only the selected account secret to the adapter through controlled IPC
  or a short-lived inherited channel;
- keep credential references, never secrets, in `adapters.json`;
- add migration and revocation tests before deleting the file-based fallback.

No Keychain/Stronghold dependency existed in the repository during this phase,
so this cross-platform change is intentionally not mixed into the QR PoC.

## Rollback and coexistence

The original platform adapters and manual configuration component are retained.
Removing the new Settings card restores the old UI without changing existing
adapter schemas. WeChat runs in the same combined sidecar as Feishu, Telegram,
DingTalk, WeCom, and QQ; restarting after a credential change briefly restarts
all configured channels but does not create duplicate adapter processes.

## Feishu QR implementation (P6)

The existing Feishu data plane remains unchanged on the official
`@larksuiteoapi/node-sdk` WebSocket client. The local server now depends on
SDK 1.71.1 for `registerApp`, starts the OAuth 2.0 device-authorization flow,
renders the returned verification URL as a local QR code, and persists the
resulting App ID and App Secret through the existing adapter configuration.

The registration request keeps the official base template and explicitly adds
the message scopes, `im.message.receive_v1`, and `card.action.trigger` used by
the existing adapter. The scanner `open_id` is required and becomes the sole
initial paired user; missing scanner identity fails closed. The combined adapter
sidecar is restarted after authorization, so no second Feishu runtime exists.

Manual validation still required to close P6:

- scan with a real Feishu or Lark account;
- approve app creation and any tenant/admin permission prompts;
- verify the bot receives a private message and returns a Gugu reply;
- restart Gugu and repeat a message;
- disconnect locally and confirm the channel stops.

## Phase status

- P0: architecture and source facts recorded here.
- P1: WeChat QR authorization implemented.
- P2: WeChat private text receive/reply path implemented.
- P3: recovery, rollback, disconnect, validation, and PoC file hardening done;
  OS-backed secret storage remains a production gate.
- P4: compact Settings/sidebar entry and error recovery implemented.
- P5: automated review and build smoke completed for this change; real phone
  remains manual.
- P6: official SDK dependency upgrade, QR installation service, compact Settings
  card, scanner binding, API tests, and build smoke implemented; real account
  authorization remains manual.

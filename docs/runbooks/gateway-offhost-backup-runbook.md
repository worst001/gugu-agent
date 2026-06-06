# Gateway Off-Host Backup Runbook

Status: Phase 5E preparation, not connected to a real off-host target yet.

2026-06-06 update: Docker cutover remains frozen. Off-host backup is the next
infrastructure item to push, but production execution still requires SSH access
and a real target path or upload job. A read-only SSH attempt from this thread
failed with `Permission denied (publickey...)`, so no production staging or
restore rehearsal was executed here.

The current production MySQL backup timer creates local SQL backups under
`/var/backups/gugu-gateway`. Local backups are useful for fast restore, but they
are not disaster recovery because the observed backup directory, MySQL data, and
Docker root all live on the same root disk.

This runbook adds an off-host backup staging and verification flow. It does not
assume a specific vendor. The target can be a mounted data disk, private object
storage mount, rsync destination, or an operator-approved upload job. Real cloud
credentials must stay outside git.

## Artifacts

For each MySQL backup, keep these files together:

- `gateway-mysql-YYYYMMDD-HHMMSS.sql`
- `gateway-mysql-YYYYMMDD-HHMMSS.sql.manifest.json`
- `gateway-mysql-YYYYMMDD-HHMMSS.sql.sha256`
- `gateway-mysql-YYYYMMDD-HHMMSS.offhost-manifest.json`

The existing `mysql-backup` script creates the first three files. The new
`mysql-offhost-stage` script copies them to a target directory, rewrites the
`.sha256` file so it can be checked inside the target directory, and writes the
off-host manifest.

## Configuration

Template:

```text
gateway/deploy/env/offhost-backup.env.example
```

Private production copy:

```bash
/etc/gugu-gateway/offhost-backup.env
chmod 600 /etc/gugu-gateway/offhost-backup.env
```

Important variables:

```bash
GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway
GUGU_OFFHOST_BACKUP_DIR=/mnt/gugu-gateway-offhost
GUGU_OFFHOST_BACKUP_TARGET_LABEL=offhost-private-target
GUGU_OFFHOST_REQUIRE_DIFFERENT_DEVICE=1
```

In production, keep `GUGU_OFFHOST_REQUIRE_DIFFERENT_DEVICE=1` unless the target
is a staging directory that is uploaded off-host by another already-approved
job. Same-disk staging is useful for rehearsal, not disaster recovery.

## Manual Stage And Verify

Create or confirm a fresh local backup first:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-backup.ts \
  --env-file /root/opt/gugu/.env \
  --backup-dir /var/backups/gugu-gateway
```

Stage the newest backup:

```bash
set -a
. /etc/gugu-gateway/offhost-backup.env
set +a

cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-offhost-stage.ts \
  --out-dir "$GUGU_OFFHOST_BACKUP_DIR" \
  --target-label "$GUGU_OFFHOST_BACKUP_TARGET_LABEL" \
  --require-different-device
```

Verify an already staged bundle without copying:

```bash
/root/.bun/bin/bun run scripts/mysql-offhost-stage.ts \
  --out-dir "$GUGU_OFFHOST_BACKUP_DIR" \
  --target-label "$GUGU_OFFHOST_BACKUP_TARGET_LABEL" \
  --verify-only \
  --require-different-device
```

Expected output:

```json
{
  "ok": true,
  "sameFilesystemDevice": false,
  "verification": {
    "sourceSha256Matches": true,
    "targetSha256Matches": true,
    "targetSizeMatches": true
  }
}
```

If `sameFilesystemDevice=true`, the copy is not a real off-host backup.

## Restore Rehearsal

At least once after configuring a target, restore from the staged copy into a
scratch database.

1. Pick the staged SQL path from `offhost-manifest.json`.
2. Create a scratch MySQL database whose name contains `restore` or `scratch`.
3. Run:

```bash
cd /root/opt/gugu
/root/.bun/bin/bun run scripts/mysql-restore-check.ts \
  --backup /mnt/gugu-gateway-offhost/gateway-mysql-YYYYMMDD-HHMMSS/gateway-mysql-YYYYMMDD-HHMMSS.sql \
  --target-mysql-url mysql://restore_user:REPLACE_ME@127.0.0.1:3306/gugu_gateway_restore
```

Pass criteria:

- `ok=true`
- `countMismatches=[]`
- `issues=[]`
- sha matches the staged `.sha256`

## Warning Dashboard Additions

Add these panels to `docs/runbooks/gateway-warning-dashboard.md` when the target
is real:

- Latest off-host bundle age.
- Latest off-host bundle sha verification status.
- `sameFilesystemDevice=false`.
- Last restore rehearsal date.
- Off-host retention count by daily/weekly/monthly buckets.

Critical alerts:

- no off-host copy for more than 30 hours,
- target sha mismatch,
- target same device when production requires different device,
- restore rehearsal older than 90 days after off-host backup is enabled.

## Operations Policy

Minimum policy before a production Docker cutover:

- Keep local backup timer as-is.
- Stage/copy the newest backup off-host daily.
- Keep at least 7 daily, 4 weekly, and 3 monthly off-host recovery points once
  real users depend on paid entitlements.
- Run a restore rehearsal before the first Docker production cutover and then at
  least quarterly.
- Never delete local or off-host backups during an incident unless a human owner
  explicitly approves the cleanup target and retention impact.

## Phase 5E Status

Prepared:

- `gateway/scripts/mysql-offhost-stage.ts`
- `gateway/deploy/env/offhost-backup.env.example`
- `gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.service`
- `gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.timer`
- `gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.root.service`
- `gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.root.timer`
- `docs/runbooks/gateway-offhost-backup-runbook.md`

Not yet done:

- choosing the actual off-host target,
- provisioning credentials or mounts,
- deploying a timer/upload job,
- running a production restore rehearsal.

Required operator input before the next attempt:

- target type: mounted disk, private object storage mount, rsync destination, or
  an operator-approved upload job,
- production-visible target directory, for example
  `/mnt/gugu-gateway-offhost`,
- target label for manifests, for example `aliyun-oss-private` or
  `nas-private-disk`,
- confirmation that the target is on a different filesystem device, or that a
  same-disk staging directory is followed by an already-approved off-host upload
  job,
- scratch MySQL restore URL whose database name contains `restore`, `scratch`,
  `dryrun`, `backup`, `contract`, or `test`.

## Optional systemd Timer

Two template variants exist:

- normalized future layout: `/opt/gugu-gateway` with user `gugu`;
- current root layout: `/root/opt/gugu` with user `root`.

Use only one variant. For current production, the root variant matches the
existing deployment layout. Example install after the target has been mounted
and manually verified:

```bash
cp gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.root.service \
  /etc/systemd/system/gugu-gateway-mysql-offhost-backup.service
cp gateway/deploy/systemd/gugu-gateway-mysql-offhost-backup.root.timer \
  /etc/systemd/system/gugu-gateway-mysql-offhost-backup.timer
systemctl daemon-reload
systemctl start gugu-gateway-mysql-offhost-backup.service
journalctl -u gugu-gateway-mysql-offhost-backup.service -n 80 --no-pager
systemctl enable --now gugu-gateway-mysql-offhost-backup.timer
```

The template runs at `04:10 CST`, after the local MySQL backup timer's `03:35`
window. If the target directory is not `/mnt/gugu-gateway-offhost`, update both
`GUGU_OFFHOST_BACKUP_DIR` and the service `ReadWritePaths` before enabling.

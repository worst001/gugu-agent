# Gateway Backup Timer Checklist

Last reviewed: 2026-05-27

Use this checklist when enabling or auditing the nightly SQLite backup job on the production gateway server. SQLite is still the source of truth until the MySQL migration is fully validated.

## Preconditions

- Run during a low-traffic window if this is the first install.
- Confirm `/var/lib/gugu-gateway/gateway.sqlite` exists.
- Confirm `/var/backups/gugu-gateway` has enough disk headroom.
- Confirm `/etc/gugu-gateway/gateway.env` points `GUGU_GATEWAY_DB_PATH` at the production SQLite file.
- Keep `GUGU_GATEWAY_BACKUP_RETENTION_DAYS=7` unless a longer retention window is explicitly chosen.

```bash
id gugu
ls -lh /var/lib/gugu-gateway/gateway.sqlite
df -h /var/lib/gugu-gateway /var/backups/gugu-gateway
grep '^GUGU_GATEWAY_DB_PATH=' /etc/gugu-gateway/gateway.env
grep '^GUGU_GATEWAY_BACKUP_RETENTION_DAYS=' /etc/gugu-gateway/gateway.env
```

## Install Or Refresh Units

Run from the deployed gateway source directory:

```bash
cd /opt/gugu-gateway
sudo install -o root -g root -m 0644 deploy/systemd/gugu-gateway-backup.service /etc/systemd/system/gugu-gateway-backup.service
sudo install -o root -g root -m 0644 deploy/systemd/gugu-gateway-backup.timer /etc/systemd/system/gugu-gateway-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now gugu-gateway-backup.timer
```

Verify timer registration:

```bash
systemctl status gugu-gateway-backup.timer --no-pager
systemctl list-timers gugu-gateway-backup.timer --no-pager
```

Acceptance:

- Timer is `active`.
- Next run is scheduled.
- Unit name is `gugu-gateway-backup.service`.

## Manual First Run

Trigger one backup immediately and inspect logs:

```bash
sudo systemctl start gugu-gateway-backup.service
systemctl status gugu-gateway-backup.service --no-pager
journalctl -u gugu-gateway-backup.service -n 100 --no-pager
ls -lh /var/backups/gugu-gateway
```

Acceptance:

- Service exits successfully.
- A new `gateway-YYYYMMDD-HHMMSS.sqlite` file exists.
- Logs show `ok: true` from backup and restore-check.
- Logs show `integrity: "ok"`.
- No payment or gateway service restart is required.

## Independent Restore Check

Run restore-check directly against the newest backup if the systemd log is unclear:

```bash
cd /opt/gugu-gateway
sudo -u gugu env GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway bun run scripts/restore-check.ts
```

Expected result:

- `ok` is `true`.
- `integrity` is `ok`.
- `foreignKeyViolations` is empty.
- Tables include `devices`, `activation_codes`, `usage_events`, `orders`, and `payment_notifications`.

## Retention Check

Confirm old backup candidates before pruning:

```bash
find /var/backups/gugu-gateway -type f -name 'gateway-*.sqlite' -mtime +7 -print
```

The backup script prunes files matching `gateway-*.sqlite` older than `GUGU_GATEWAY_BACKUP_RETENTION_DAYS`, except the newly created backup. During the first 72 hours after a migration rehearsal or cutover, keep rollback backups untouched by temporarily increasing retention.

## Failure Handling

If the manual run fails:

```bash
journalctl -u gugu-gateway-backup.service -n 200 --no-pager
sudo -u gugu test -r /var/lib/gugu-gateway/gateway.sqlite
sudo -u gugu test -w /var/backups/gugu-gateway
sudo -u gugu env GUGU_GATEWAY_DB_PATH=/var/lib/gugu-gateway/gateway.sqlite GUGU_GATEWAY_BACKUP_DIR=/var/backups/gugu-gateway bun run scripts/backup.ts --no-prune
```

Common causes:

- Wrong `GUGU_GATEWAY_DB_PATH`.
- Backup directory ownership is not writable by `gugu`.
- Disk is full.
- Deployed source under `/opt/gugu-gateway` is missing scripts or dependencies.

Do not proceed with MySQL migration work until backup and restore-check both pass.

## Rollback

Disable the timer without deleting existing backup files:

```bash
sudo systemctl disable --now gugu-gateway-backup.timer
systemctl status gugu-gateway-backup.timer --no-pager
```

This does not affect the running gateway because the backup timer is independent from `gugu-gateway.service`.

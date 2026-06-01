#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/root/opt/gugu
TAR_PATH=/tmp/gugu-gateway-write-freeze.tar.gz
DB_PATH=/var/lib/gugu-gateway/gateway.sqlite
BACKUP_DIR=/var/backups/gugu-gateway
BUN_BIN=/root/.bun/bin/bun
ts="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="/root/opt/gugu-release-write-freeze-$ts"
PREV_DIR="/root/opt/gugu-prev-write-freeze-$ts"
CODE_BACKUP="/root/opt/gugu/backups/code-pre-write-freeze-$ts.tar.gz"

if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun)"
fi
if [ ! -f "$TAR_PATH" ]; then
  echo "Missing tarball: $TAR_PATH" >&2
  exit 1
fi
if [ ! -d "$APP_DIR" ]; then
  echo "Missing app dir: $APP_DIR" >&2
  exit 1
fi

echo "[1/9] Pre-deploy health"
curl -fsS http://127.0.0.1:18787/health
echo

echo "[2/9] SQLite backup"
cd "$APP_DIR"
"$BUN_BIN" run scripts/backup.ts \
  --db "$DB_PATH" \
  --out-dir "$BACKUP_DIR" \
  --retention-days 7

echo "[3/9] Code backup"
install -d -m 0755 "$(dirname "$CODE_BACKUP")"
tar -czf "$CODE_BACKUP" -C "$APP_DIR" --exclude node_modules --exclude .git .
ls -lh "$CODE_BACKUP"

echo "[4/9] Prepare release directory"
install -d -m 0755 "$RELEASE_DIR"
tar -xzf "$TAR_PATH" -C "$RELEASE_DIR"
if [ -f "$APP_DIR/.env" ]; then
  cp -a "$APP_DIR/.env" "$RELEASE_DIR/.env"
fi
cd "$RELEASE_DIR"
"$BUN_BIN" install --production
"$BUN_BIN" -e "await import('./src/index.ts'); console.log('import ok')"

echo "[5/9] Swap release under systemd"
systemctl stop gugu-gateway
mv "$APP_DIR" "$PREV_DIR"
mv "$RELEASE_DIR" "$APP_DIR"
systemctl start gugu-gateway

echo "[6/9] Post-deploy health"
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:18787/health >/tmp/gugu-health.json 2>/dev/null; then
    cat /tmp/gugu-health.json
    echo
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:18787/health
echo

echo "[7/9] Verify write-freeze default is not enabled"
if grep -q '^GUGU_MAINTENANCE_DISABLE_WRITES=1' "$APP_DIR/.env"; then
  echo "ERROR: production env enables GUGU_MAINTENANCE_DISABLE_WRITES=1" >&2
  exit 1
fi
grep '^GUGU_MAINTENANCE_DISABLE_WRITES=' "$APP_DIR/.env" || echo "GUGU_MAINTENANCE_DISABLE_WRITES missing: default off"

echo "[8/9] Temp write-freeze smoke on 127.0.0.1:18788"
SMOKE_DB="/tmp/gugu-write-freeze-smoke-$ts.sqlite"
(
  cd "$APP_DIR"
  GUGU_GATEWAY_HOST=127.0.0.1 \
  GUGU_GATEWAY_PORT=18788 \
  GUGU_GATEWAY_DB_PATH="$SMOKE_DB" \
  GUGU_MAINTENANCE_MODE=1 \
  GUGU_MAINTENANCE_DISABLE_WRITES=1 \
  GUGU_REQUEST_LOG_ENABLED=0 \
  "$BUN_BIN" run src/index.ts >"/tmp/gugu-write-freeze-smoke-$ts.log" 2>&1
) &
smoke_pid="$!"
cleanup_smoke() {
  if kill -0 "$smoke_pid" >/dev/null 2>&1; then
    kill "$smoke_pid" >/dev/null 2>&1 || true
    wait "$smoke_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_smoke EXIT
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:18788/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$smoke_pid" >/dev/null 2>&1; then
    echo "Temp write-freeze smoke exited early" >&2
    tail -n 80 "/tmp/gugu-write-freeze-smoke-$ts.log" >&2 || true
    exit 1
  fi
  sleep 0.25
done
freeze_status="$(
  curl -sS -o "/tmp/gugu-write-freeze-smoke-$ts.json" -w '%{http_code}' \
    -X POST http://127.0.0.1:18788/v1/devices \
    -H 'Content-Type: application/json' \
    -d '{"deviceId":"write-freeze-smoke"}'
)"
echo "freeze_status=$freeze_status"
if [ "$freeze_status" != "503" ]; then
  cat "/tmp/gugu-write-freeze-smoke-$ts.json" >&2 || true
  exit 1
fi
cleanup_smoke

echo "[9/9] Public health"
curl -fsS https://gugu.guxingyao.com/health
echo

cat <<EOF
OK: gateway write-freeze deploy complete.
SQLite/code backups created.
Previous dir: $PREV_DIR
Code backup: $CODE_BACKUP
EOF

#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/root/opt/gugu
APP_ENV=/root/opt/gugu/.env
MYSQL_ENV=/etc/gugu-gateway/mysql.env
BUN_BIN=/root/.bun/bin/bun
SMOKE_PORT=18788

if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun)"
fi
if [ ! -r "$APP_ENV" ]; then
  echo "Missing gateway env: $APP_ENV" >&2
  exit 1
fi
if [ ! -r "$MYSQL_ENV" ]; then
  echo "Missing MySQL env: $MYSQL_ENV" >&2
  exit 1
fi

set -a
. "$APP_ENV"
. "$MYSQL_ENV"
set +a

if [ -z "${GUGU_MYSQL_DRYRUN_URL:-}" ]; then
  echo "GUGU_MYSQL_DRYRUN_URL is missing" >&2
  exit 1
fi

case "$GUGU_MYSQL_DRYRUN_URL" in
  */gugu_gateway_dryrun)
    SMOKE_URL="${GUGU_MYSQL_DRYRUN_URL%/gugu_gateway_dryrun}/gugu_gateway_smoke"
    ;;
  *)
    echo "Unexpected dry-run URL shape; refusing to derive smoke database URL" >&2
    exit 1
    ;;
esac

ts="$(date +%Y%m%d%H%M%S)"
RUN_DIR="/var/backups/gugu-gateway/mysql-temp-smoke-$ts"
install -d -m 0700 "$RUN_DIR"
cd "$APP_DIR"

echo "[1/7] Verify production gateway stays healthy before smoke"
curl -fsS http://127.0.0.1:18787/health
echo

echo "[2/7] Recreate isolated smoke database"
mysql --defaults-file=/root/.my.cnf <<'SQL'
DROP DATABASE IF EXISTS gugu_gateway_smoke;
CREATE DATABASE gugu_gateway_smoke CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_smoke.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_smoke.* TO 'gugu_gateway_app'@'localhost';
FLUSH PRIVILEGES;
SQL
mysql --defaults-file=/root/.my.cnf gugu_gateway_smoke < deploy/mysql/schema.sql

echo "[3/7] Start temporary MySQL-backed gateway on 127.0.0.1:${SMOKE_PORT}"
export GUGU_GATEWAY_HOST=127.0.0.1
export GUGU_GATEWAY_PORT="$SMOKE_PORT"
export GUGU_STORE_DRIVER=mysql
export GUGU_MYSQL_URL="$SMOKE_URL"
export GUGU_MAINTENANCE_MODE=1
export GUGU_MAINTENANCE_DISABLE_ORDERS=1
export GUGU_REQUEST_LOG_ENABLED=0

"$BUN_BIN" run src/index.ts > "$RUN_DIR/temp-gateway.log" 2>&1 &
temp_pid="$!"
cleanup() {
  if kill -0 "$temp_pid" >/dev/null 2>&1; then
    kill "$temp_pid" >/dev/null 2>&1 || true
    wait "$temp_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${SMOKE_PORT}/health" > "$RUN_DIR/health.json" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$temp_pid" >/dev/null 2>&1; then
    echo "Temporary gateway exited early" >&2
    tail -n 120 "$RUN_DIR/temp-gateway.log" >&2 || true
    exit 1
  fi
  sleep 0.25
done

if ! curl -fsS "http://127.0.0.1:${SMOKE_PORT}/health" > "$RUN_DIR/health.json"; then
  echo "Temporary gateway health failed" >&2
  tail -n 120 "$RUN_DIR/temp-gateway.log" >&2 || true
  exit 1
fi
cat "$RUN_DIR/health.json"
echo

echo "[4/7] Smoke device registration through MySQL store"
device_status="$(
  curl -sS -o "$RUN_DIR/device.json" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${SMOKE_PORT}/v1/devices" \
    -H 'Content-Type: application/json' \
    -d "{\"deviceId\":\"mysql-smoke-${ts}\",\"appVersion\":\"0.1.16\",\"platform\":\"prod-smoke\"}"
)"
echo "device_status=$device_status"
if [ "$device_status" != "200" ]; then
  cat "$RUN_DIR/device.json" >&2 || true
  exit 1
fi

echo "[5/7] Smoke maintenance order block"
order_status="$(
  curl -sS -o "$RUN_DIR/order.json" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${SMOKE_PORT}/v1/orders" \
    -H 'Content-Type: application/json' \
    -d '{"packageId":"light-monthly","paymentProvider":"wechat","contact":"mysql temp smoke"}'
)"
echo "order_status=$order_status"
if [ "$order_status" != "503" ]; then
  cat "$RUN_DIR/order.json" >&2 || true
  exit 1
fi

echo "[6/7] Stop temporary gateway and verify production gateway is still healthy"
cleanup
curl -fsS http://127.0.0.1:18787/health
echo

echo "[7/7] Socket check"
ss -lntp '( sport = :18787 )'
if ss -lntp "( sport = :${SMOKE_PORT} )" | grep -q ":${SMOKE_PORT}"; then
  echo "ERROR: temporary smoke port is still listening" >&2
  exit 1
fi

cat <<EOF
OK: temporary MySQL-backed gateway smoke passed without touching production systemd.
Run dir: $RUN_DIR
Smoke DB: gugu_gateway_smoke
EOF

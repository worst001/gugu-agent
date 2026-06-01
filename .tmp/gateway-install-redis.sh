#!/usr/bin/env bash
set -euo pipefail

echo "[1/7] Install redis package if needed"
if ! command -v redis-server >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y redis
  else
    yum install -y redis
  fi
else
  redis-server --version
fi

echo "[2/7] Locate redis config and service"
CONFIG=""
for candidate in /etc/redis.conf /etc/redis/redis.conf; do
  if [ -f "$candidate" ]; then
    CONFIG="$candidate"
    break
  fi
done
if [ -z "$CONFIG" ]; then
  echo "Could not find redis.conf" >&2
  exit 1
fi

SERVICE=redis
if systemctl list-unit-files | grep -q '^redis-server\.service'; then
  SERVICE=redis-server
elif systemctl list-unit-files | grep -q '^redis\.service'; then
  SERVICE=redis
fi
echo "Config: $CONFIG"
echo "Service: $SERVICE"

echo "[3/7] Configure localhost-only redis"
backup="$CONFIG.bak-gugu-$(date +%Y%m%d%H%M%S)"
cp -a "$CONFIG" "$backup"

set_directive() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -Eq "^[#[:space:]]*${key}[[:space:]]+" "$file"; then
    sed -i -E "s|^[#[:space:]]*${key}[[:space:]]+.*|${key} ${value}|" "$file"
  else
    printf '\n%s %s\n' "$key" "$value" >> "$file"
  fi
}

set_directive bind "127.0.0.1" "$CONFIG"
set_directive protected-mode "yes" "$CONFIG"
set_directive port "6379" "$CONFIG"
set_directive maxmemory "256mb" "$CONFIG"
set_directive maxmemory-policy "noeviction" "$CONFIG"
if grep -Eq '^[#[:space:]]*supervised[[:space:]]+' "$CONFIG"; then
  sed -i -E 's|^[#[:space:]]*supervised[[:space:]]+.*|supervised systemd|' "$CONFIG"
fi
echo "Backup: $backup"
grep -E '^(bind|protected-mode|port|maxmemory|maxmemory-policy|supervised)[[:space:]]+' "$CONFIG" || true

echo "[4/7] Start and enable redis"
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"
systemctl is-active "$SERVICE"

echo "[5/7] Socket verification"
redis_sock="$(ss -lntp '( sport = :6379 )' || true)"
printf '%s\n' "$redis_sock"
if printf '%s\n' "$redis_sock" | grep -Eq '(\*:6379|0\.0\.0\.0:6379|\[::\]:6379|:::6379)'; then
  echo "ERROR: redis is listening publicly on 6379" >&2
  exit 1
fi
if ! printf '%s\n' "$redis_sock" | grep -q '127\.0\.0\.1:6379'; then
  echo "ERROR: redis is not listening on 127.0.0.1:6379" >&2
  exit 1
fi

echo "[6/7] Ping and memory policy"
redis-cli -h 127.0.0.1 -p 6379 ping
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET maxmemory maxmemory-policy bind protected-mode

echo "[7/7] Write isolated gateway redis env"
install -d -m 0700 /etc/gugu-gateway
cat >/etc/gugu-gateway/redis.env <<'ENV'
GUGU_REDIS_URL=redis://127.0.0.1:6379
ENV
chmod 0600 /etc/gugu-gateway/redis.env
ls -l /etc/gugu-gateway/redis.env

echo "OK: redis is installed and localhost-only"

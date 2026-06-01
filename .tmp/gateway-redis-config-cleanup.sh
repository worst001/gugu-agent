#!/usr/bin/env bash
set -euo pipefail

CONFIG=/etc/redis.conf
SERVICE=redis
if systemctl list-unit-files | grep -q '^redis-server\.service'; then
  SERVICE=redis-server
fi

backup="$CONFIG.bak-gugu-clean-$(date +%Y%m%d%H%M%S)"
cp -a "$CONFIG" "$backup"

awk '
  /^[#[:space:]]*(bind|protected-mode|port|maxmemory|maxmemory-policy|supervised)[[:space:]]+/ { next }
  { print }
' "$CONFIG" > /tmp/redis.conf.gugu-clean

cat >> /tmp/redis.conf.gugu-clean <<'CONF'

# Gugu gateway local Redis overrides.
bind 127.0.0.1
protected-mode yes
port 6379
supervised systemd
maxmemory 256mb
maxmemory-policy noeviction
CONF

install -o root -g root -m 0644 /tmp/redis.conf.gugu-clean "$CONFIG"
systemctl restart "$SERVICE"
systemctl is-active "$SERVICE"

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

redis-cli -h 127.0.0.1 -p 6379 ping
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET bind
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET protected-mode
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET maxmemory
redis-cli -h 127.0.0.1 -p 6379 CONFIG GET maxmemory-policy

echo "Backup: $backup"
echo "OK: redis config cleaned and verified"

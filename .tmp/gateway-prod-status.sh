#!/usr/bin/env bash
set -euo pipefail

echo "[services]"
printf 'gugu-gateway=%s\n' "$(systemctl is-active gugu-gateway)"
printf 'mysqld=%s\n' "$(systemctl is-active mysqld)"
if systemctl list-unit-files | grep -q '^redis-server\.service'; then
  printf 'redis-server=%s\n' "$(systemctl is-active redis-server)"
else
  printf 'redis=%s\n' "$(systemctl is-active redis)"
fi

echo "[gateway-health-local]"
curl -fsS http://127.0.0.1:18787/health
echo

echo "[mysql-3306]"
ss -lntp '( sport = :3306 )'

echo "[redis-6379]"
ss -lntp '( sport = :6379 )'

echo "[gateway-18787]"
ss -lntp '( sport = :18787 )'

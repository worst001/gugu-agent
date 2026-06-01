#!/usr/bin/env bash
set -euo pipefail

echo GATEWAY
systemctl is-active gugu-gateway || true
curl -fsS http://127.0.0.1:18787/health || true
echo

echo MYSQL
command -v mysql || true
mysql --version || true
systemctl is-active mysqld || true
systemctl is-active mysql || true
ss -lntp '( sport = :3306 )' || true

echo REDIS
command -v redis-server || true
redis-server --version || true
systemctl is-active redis || true
systemctl is-active redis-server || true
ss -lntp '( sport = :6379 )' || true

echo ENV
ls -l /etc/gugu-gateway /root/opt/gugu/.env 2>/dev/null || true
for f in /etc/gugu-gateway/mysql.env /etc/gugu-gateway/redis.env /root/opt/gugu/.env; do
  if [ -f "$f" ]; then
    echo "FILE=$f"
    grep -E '^(GUGU_MYSQL_URL|GUGU_STORE_DRIVER|MYSQL|REDIS|GUGU_REDIS)' "$f" \
      | sed -E 's#(PASSWORD|URL|PASS|KEY)=.*#\1=***#' || true
  fi
done

echo SPACE
df -h / /var /root

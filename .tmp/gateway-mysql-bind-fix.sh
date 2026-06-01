#!/usr/bin/env bash
set -euo pipefail

echo "[1/6] MySQL config entrypoint"
if [ -f /etc/my.cnf ]; then
  sed -n '1,180p' /etc/my.cnf
else
  echo "/etc/my.cnf is missing"
fi

echo "[2/6] Ensure /etc/my.cnf.d is included"
install -d -m 0755 /etc/my.cnf.d
if [ ! -f /etc/my.cnf ]; then
  printf '[mysqld]\n\n!includedir /etc/my.cnf.d\n' > /etc/my.cnf
elif ! grep -Eq '^[[:space:]]*!includedir[[:space:]]+/etc/my\.cnf\.d/?[[:space:]]*$' /etc/my.cnf; then
  backup="/etc/my.cnf.bak-gugu-$(date +%Y%m%d%H%M%S)"
  cp -a /etc/my.cnf "$backup"
  printf '\n!includedir /etc/my.cnf.d\n' >> /etc/my.cnf
  echo "Added includedir to /etc/my.cnf, backup: $backup"
else
  echo "/etc/my.cnf already includes /etc/my.cnf.d"
fi

echo "[3/6] Install localhost-only override"
cat >/tmp/zz-gugu-gateway.cnf <<'CNF'
[mysqld]
bind-address=127.0.0.1
CNF
install -o root -g root -m 0644 /tmp/zz-gugu-gateway.cnf /etc/my.cnf.d/zz-gugu-gateway.cnf
cat /etc/my.cnf.d/zz-gugu-gateway.cnf

echo "[4/6] Validate and restart mysqld"
if command -v mysqld >/dev/null 2>&1; then
  mysqld --validate-config
fi
systemctl restart mysqld
systemctl is-active mysqld

echo "[5/6] MySQL bind variables"
mysql --defaults-file=/root/.my.cnf -e "SHOW VARIABLES WHERE Variable_name IN ('bind_address','port');"

echo "[6/6] Socket verification"
mysql_sock="$(ss -lntp '( sport = :3306 )' || true)"
printf '%s\n' "$mysql_sock"
if printf '%s\n' "$mysql_sock" | grep -Eq '(\*:3306|0\.0\.0\.0:3306|\[::\]:3306|:::3306)'; then
  echo "ERROR: mysqld is still listening publicly on 3306" >&2
  exit 1
fi
if ! printf '%s\n' "$mysql_sock" | grep -q '127\.0\.0\.1:3306'; then
  echo "ERROR: mysqld is not listening on 127.0.0.1:3306" >&2
  exit 1
fi

mysqlx_sock="$(ss -lntp '( sport = :33060 )' || true)"
if [ -n "$mysqlx_sock" ]; then
  echo "[info] mysqlx port 33060:"
  printf '%s\n' "$mysqlx_sock"
fi

echo "OK: mysqld is localhost-only on 3306"

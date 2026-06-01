#!/usr/bin/env bash
set -euo pipefail

echo "installing mysql 8.4 repo/server if needed"
if ! command -v mysql >/dev/null 2>&1; then
  if ! rpm -q mysql84-community-release >/dev/null 2>&1; then
    dnf install -y https://repo.mysql.com/mysql84-community-release-el8.rpm
  fi
  # Alibaba Cloud Linux 3 reports releasever=3, while the official MySQL RPM
  # repo we install here targets the EL8-compatible package set.
  sed -i 's#el/$releasever#el/8#g' /etc/yum.repos.d/mysql-community*.repo
  dnf clean metadata
  dnf module disable -y mysql || true
  dnf install -y mysql-community-server
fi

install -o root -g root -m 0644 /tmp/gugu-gateway.cnf /etc/my.cnf.d/gugu-gateway.cnf
systemctl enable --now mysqld

for _ in $(seq 1 60); do
  if mysqladmin ping --silent >/dev/null 2>&1; then break; fi
  sleep 1
done

mkdir -p /etc/gugu-gateway
chmod 0750 /etc/gugu-gateway

if [ ! -f /root/.my.cnf ]; then
  temp_password=$(grep 'temporary password' /var/log/mysqld.log | tail -1 | awk '{print $NF}')
  if [ -z "${temp_password:-}" ]; then
    echo "could not find temporary MySQL root password" >&2
    exit 1
  fi
  root_password="$(openssl rand -hex 18)A1a!"
  mysql --connect-expired-password -uroot -p"$temp_password" \
    -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$root_password';"
  cat > /root/.my.cnf <<EOF
[client]
user=root
password=$root_password
EOF
  chmod 0600 /root/.my.cnf
fi

app_password="$(openssl rand -hex 18)A1a!"
mysql <<SQL
CREATE DATABASE IF NOT EXISTS gugu_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS gugu_gateway_dryrun CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'gugu_gateway_app'@'127.0.0.1' IDENTIFIED BY '$app_password';
CREATE USER IF NOT EXISTS 'gugu_gateway_app'@'localhost' IDENTIFIED BY '$app_password';
ALTER USER 'gugu_gateway_app'@'127.0.0.1' IDENTIFIED BY '$app_password';
ALTER USER 'gugu_gateway_app'@'localhost' IDENTIFIED BY '$app_password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON gugu_gateway.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON gugu_gateway.* TO 'gugu_gateway_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON gugu_gateway_dryrun.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON gugu_gateway_dryrun.* TO 'gugu_gateway_app'@'localhost';
FLUSH PRIVILEGES;
SQL

cat > /etc/gugu-gateway/mysql.env <<EOF
GUGU_MYSQL_HOST=127.0.0.1
GUGU_MYSQL_PORT=3306
GUGU_MYSQL_DATABASE=gugu_gateway
GUGU_MYSQL_DRYRUN_DATABASE=gugu_gateway_dryrun
GUGU_MYSQL_APP_USER=gugu_gateway_app
GUGU_MYSQL_APP_PASSWORD=$app_password
GUGU_MYSQL_URL=mysql://gugu_gateway_app:$app_password@127.0.0.1:3306/gugu_gateway
GUGU_MYSQL_DRYRUN_URL=mysql://gugu_gateway_app:$app_password@127.0.0.1:3306/gugu_gateway_dryrun
EOF
chmod 0600 /etc/gugu-gateway/mysql.env

mysql -h127.0.0.1 -ugugu_gateway_app -p"$app_password" -e 'SELECT VERSION() AS version' gugu_gateway
ss -lntp '( sport = :3306 )' || true
systemctl is-active mysqld

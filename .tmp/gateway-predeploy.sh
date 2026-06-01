#!/usr/bin/env bash
set -euo pipefail

ts=$(date +%Y%m%d%H%M%S)
echo "TS=$ts"

mkdir -p /root/opt/gugu/backups /var/backups/gugu-gateway /tmp/gugu-deploy
systemctl stop gugu-gateway || true
echo "stopped-systemd"

OUT="/var/backups/gugu-gateway/gateway-predeploy-$ts.sqlite" /root/.bun/bin/bun -e '
import { Database } from "bun:sqlite"
const out = process.env.OUT
const db = new Database("/var/lib/gugu-gateway/gateway.sqlite", { readonly: true })
db.exec("VACUUM INTO " + JSON.stringify(out))
db.close()
console.log(out)
'

tar \
  --exclude='./node_modules' \
  --exclude='./backups' \
  --exclude='./gateway.log' \
  -czf "/root/opt/gugu/backups/code-predeploy-$ts.tar.gz" \
  -C /root/opt gugu

printf '%s\n' "$ts" > /tmp/gugu-deploy/last-predeploy-ts
ls -lh "/var/backups/gugu-gateway/gateway-predeploy-$ts.sqlite" "/root/opt/gugu/backups/code-predeploy-$ts.tar.gz"
ss -lntp '( sport = :18787 )' || true

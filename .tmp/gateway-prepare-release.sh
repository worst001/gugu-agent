#!/usr/bin/env bash
set -euo pipefail

ts=$(cat /tmp/gugu-deploy/last-predeploy-ts 2>/dev/null || date +%Y%m%d%H%M%S)
release="/root/opt/gugu-release-$ts"

rm -rf "$release"
mkdir -p "$release"
tar -xzf /tmp/gugu-gateway-deploy.tar.gz -C "$release"

cp -a /root/opt/gugu/.env "$release/.env"
if [ -d /root/opt/gugu/secrets ]; then cp -a /root/opt/gugu/secrets "$release/secrets"; fi
if [ -d /root/opt/gugu/alicert ]; then cp -a /root/opt/gugu/alicert "$release/alicert"; fi

cd "$release"
/root/.bun/bin/bun install --production
/root/.bun/bin/bun -e 'await import("./src/index.ts"); console.log("import-ok")'

printf '%s\n' "$release" > /tmp/gugu-deploy/next-release
echo "release=$release"

#!/usr/bin/env bash
set -euo pipefail
set -a
. /root/opt/gugu/.env
set +a
if [[ -z "${GUGU_ADMIN_TOKEN:-}" ]]; then
  echo '{"admin":"disabled"}'
  exit 0
fi
curl -fsS http://127.0.0.1:18787/admin/api/metrics \
  -H "Authorization: Bearer $GUGU_ADMIN_TOKEN" \
  | /root/.bun/bin/bun -e 'const body=await new Response(Bun.stdin.stream()).json(); console.log(JSON.stringify({deepseek: body.circuits?.deepseek, glm: body.circuits?.glm}))'

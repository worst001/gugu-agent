#!/usr/bin/env bash
set -euo pipefail
BODY='{"deviceId":"redis-limiter-smoke-20260528-1","appVersion":"smoke","platform":"server"}'
curl -fsS -X POST http://127.0.0.1:18787/v1/devices \
  -H 'Content-Type: application/json' \
  -d "$BODY" \
  | /root/.bun/bin/bun -e 'const body=await new Response(Bun.stdin.stream()).json(); console.log(JSON.stringify({deviceToken: body.deviceToken ? "present" : "missing", status: body.entitlement?.status, plan: body.entitlement?.plan}))'

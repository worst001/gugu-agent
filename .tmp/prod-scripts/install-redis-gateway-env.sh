#!/usr/bin/env bash
set -euo pipefail

GATEWAY_ENV=/root/opt/gugu/.env
REDIS_ENV=/etc/gugu-gateway/redis.env

set -a
. "$REDIS_ENV"
set +a

cp -a "$GATEWAY_ENV" "$GATEWAY_ENV.redis-state-$(date +%Y%m%d%H%M%S).bak"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$GATEWAY_ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$GATEWAY_ENV"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$GATEWAY_ENV"
  fi
}

upsert_env GUGU_REDIS_URL "$GUGU_REDIS_URL"
upsert_env GUGU_REDIS_COMMAND_TIMEOUT_MS "1000"
upsert_env GUGU_REDIS_LIMITER_ENABLED "0"
upsert_env GUGU_REDIS_CIRCUIT_ENABLED "0"

echo "redis env installed with flags off"

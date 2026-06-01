#!/usr/bin/env bash
set -euo pipefail
set -a
. /etc/gugu-gateway/redis.env
set +a
redis-cli -u "$GUGU_REDIS_URL" --scan --pattern 'gugu:ratelimit:*' | wc -l

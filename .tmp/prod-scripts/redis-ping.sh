#!/usr/bin/env bash
set -euo pipefail
set -a
. /etc/gugu-gateway/redis.env
set +a
timeout 5s redis-cli -u "$GUGU_REDIS_URL" PING

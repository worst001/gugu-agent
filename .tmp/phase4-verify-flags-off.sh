#!/usr/bin/env bash
set -euo pipefail

set -a
. /root/opt/gugu/.env
set +a

echo "local-health=$(curl -fsS http://127.0.0.1:18787/health)"
echo "public-health=$(curl -fsS https://gugu.guxingyao.com/health)"

device_json=$(
  curl -fsS -H "Content-Type: application/json" \
    --data "{\"deviceId\":\"phase4-smoke-$(date +%Y%m%d%H%M%S)\"}" \
    http://127.0.0.1:18787/v1/devices
)
device_token=$(printf "%s" "$device_json" | sed -n 's/.*"deviceToken":"\([^"]*\)".*/\1/p')
if [ -z "$device_token" ]; then
  echo "failed to parse smoke device token" >&2
  exit 1
fi

task_code=$(
  curl -sS -o /tmp/phase4-disabled.json -w "%{http_code}" \
    -H "Authorization: Bearer ${device_token}" \
    -H "Content-Type: application/json" \
    --data '{"operation":"file_parser","name":"contract.docx","mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","dataBase64":"ZG9jeA=="}' \
    http://127.0.0.1:18787/v1/attachments/tasks
)
echo "task-code=$task_code"
cat /tmp/phase4-disabled.json
echo

curl -fsS -H "Authorization: Bearer ${GUGU_ADMIN_TOKEN}" \
  http://127.0.0.1:18787/admin/api/metrics |
  /root/.bun/bin/bun -e "const text=await new Response(Bun.stdin.stream()).text(); const m=JSON.parse(text); console.log(JSON.stringify({attachmentTasks:m.attachmentTasks, glmCircuit:m.upstreams?.glm?.circuit, deepseekCircuit:m.upstreams?.deepseek?.circuit}))"

#!/usr/bin/env bash
set -euo pipefail

ts=$(cat /tmp/gugu-deploy/last-predeploy-ts)
release=$(cat /tmp/gugu-deploy/next-release)
current=/root/opt/gugu
previous="/root/opt/gugu-prev-$ts"
failed="/root/opt/gugu-failed-$ts"

if [ ! -d "$release" ]; then
  echo "missing release: $release" >&2
  exit 1
fi

systemctl stop gugu-gateway || true

port_pids=$(ss -lntp '( sport = :18787 )' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)
if [ -n "$port_pids" ]; then
  echo "stopping port pids: $port_pids"
  for pid in $port_pids; do
    ppid=$(ps -o ppid= -p "$pid" | tr -d ' ' || true)
    kill "$pid" 2>/dev/null || true
    if [ -n "$ppid" ] && [ "$ppid" != "1" ]; then kill "$ppid" 2>/dev/null || true; fi
  done
fi

for _ in $(seq 1 30); do
  if ! ss -lnt '( sport = :18787 )' | grep -q LISTEN; then break; fi
  sleep 0.2
done

if ss -lnt '( sport = :18787 )' | grep -q LISTEN; then
  echo "port 18787 is still busy" >&2
  ss -lntp '( sport = :18787 )' || true
  exit 1
fi

mv "$current" "$previous"
mv "$release" "$current"

rollback() {
  echo "health check failed; rolling back to $previous" >&2
  systemctl stop gugu-gateway || true
  if [ -d "$current" ]; then mv "$current" "$failed"; fi
  mv "$previous" "$current"
  systemctl start gugu-gateway || true
  sleep 2
  curl -fsS http://127.0.0.1:18787/health || true
  exit 1
}

systemctl daemon-reload
systemctl start gugu-gateway

ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18787/health >/tmp/gugu-deploy/health.out 2>/tmp/gugu-deploy/health.err; then
    ok=1
    break
  fi
  sleep 1
done

if [ "$ok" != "1" ]; then
  journalctl -u gugu-gateway -n 80 --no-pager || true
  rollback
fi

cat /tmp/gugu-deploy/health.out
echo
systemctl is-active gugu-gateway
ss -lntp '( sport = :18787 )' || true
echo "previous=$previous"

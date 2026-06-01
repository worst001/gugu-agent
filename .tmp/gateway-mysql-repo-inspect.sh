#!/usr/bin/env bash
set -euo pipefail

echo REPOS
for f in /etc/yum.repos.d/mysql*.repo /etc/yum.repos.d/*mysql*.repo; do
  [ -f "$f" ] || continue
  echo "FILE=$f"
  grep -E '^\[|^name=|^baseurl=|^enabled=' "$f" || true
done

echo DNFVARS
ls -la /etc/dnf/vars /etc/yum/vars 2>/dev/null || true

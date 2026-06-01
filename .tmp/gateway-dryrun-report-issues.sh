#!/usr/bin/env bash
set -euo pipefail

REPORT="${1:-/var/backups/gugu-gateway/mysql-dryrun-20260527211513/migration-report.json}"
/root/.bun/bin/bun -e 'const reportPath = process.argv[2]; const r = JSON.parse(await Bun.file(reportPath).text()); console.log(JSON.stringify({ issueSummary: r.issueSummary, issues: r.issues }, null, 2))' _ "$REPORT"

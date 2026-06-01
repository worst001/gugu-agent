#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/root/opt/gugu
DB_PATH=/var/lib/gugu-gateway/gateway.sqlite
BACKUP_DIR=/var/backups/gugu-gateway
MYSQL_ENV=/etc/gugu-gateway/mysql.env
BUN_BIN=/root/.bun/bin/bun

if [ ! -x "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun)"
fi

if [ ! -d "$APP_DIR" ]; then
  echo "Missing app directory: $APP_DIR" >&2
  exit 1
fi
if [ ! -r "$DB_PATH" ]; then
  echo "Missing SQLite DB: $DB_PATH" >&2
  exit 1
fi
if [ ! -r "$MYSQL_ENV" ]; then
  echo "Missing MySQL env file: $MYSQL_ENV" >&2
  exit 1
fi

set -a
. "$MYSQL_ENV"
set +a

if [ -z "${GUGU_MYSQL_DRYRUN_URL:-}" ]; then
  echo "GUGU_MYSQL_DRYRUN_URL is missing in $MYSQL_ENV" >&2
  exit 1
fi

case "$GUGU_MYSQL_DRYRUN_URL" in
  */gugu_gateway_dryrun)
    GUGU_MYSQL_CONTRACT_URL="${GUGU_MYSQL_DRYRUN_URL%/gugu_gateway_dryrun}/gugu_gateway_contract"
    ;;
  *)
    echo "Unexpected dry-run URL shape; refusing to derive contract database URL" >&2
    exit 1
    ;;
esac

ts="$(date +%Y%m%d%H%M%S)"
RUN_DIR="$BACKUP_DIR/mysql-dryrun-$ts"
install -d -m 0700 "$RUN_DIR"

cd "$APP_DIR"

echo "[1/9] Gateway health before dry-run"
curl -fsS http://127.0.0.1:18787/health
echo

echo "[2/9] Create fresh SQLite snapshot"
"$BUN_BIN" run scripts/backup.ts \
  --db "$DB_PATH" \
  --out-dir "$BACKUP_DIR" \
  --retention-days 7 \
  > "$RUN_DIR/backup.json"
BACKUP_PATH="$(sed -n 's/^  "backupPath": "\(.*\)",$/\1/p' "$RUN_DIR/backup.json" | head -n 1)"
if [ -z "$BACKUP_PATH" ] || [ ! -r "$BACKUP_PATH" ]; then
  cat "$RUN_DIR/backup.json"
  echo "Could not read backupPath from backup output" >&2
  exit 1
fi
echo "Snapshot: $BACKUP_PATH"

echo "[3/9] Migration report against snapshot"
"$BUN_BIN" run scripts/migration-report.ts \
  --db "$BACKUP_PATH" \
  --fail-on-issues \
  > "$RUN_DIR/migration-report.json"
"$BUN_BIN" -e 'const r = JSON.parse(await Bun.file(process.argv[2]).text()); console.log(JSON.stringify({ ok: r.ok, issueSummary: r.issueSummary, tables: r.tables }, null, 2))' _ "$RUN_DIR/migration-report.json"

echo "[4/9] Recreate scratch MySQL databases"
mysql --defaults-file=/root/.my.cnf <<'SQL'
DROP DATABASE IF EXISTS gugu_gateway_dryrun;
CREATE DATABASE gugu_gateway_dryrun CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
DROP DATABASE IF EXISTS gugu_gateway_contract;
CREATE DATABASE gugu_gateway_contract CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_dryrun.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_dryrun.* TO 'gugu_gateway_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_contract.* TO 'gugu_gateway_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, REFERENCES ON gugu_gateway_contract.* TO 'gugu_gateway_app'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "[5/9] Apply MySQL schema"
mysql --defaults-file=/root/.my.cnf gugu_gateway_dryrun < deploy/mysql/schema.sql
mysql --defaults-file=/root/.my.cnf gugu_gateway_contract < deploy/mysql/schema.sql

echo "[6/9] Export snapshot data for MySQL"
EXPORT_SQL="$RUN_DIR/mysql-data.sql"
MANIFEST="$RUN_DIR/mysql-data.sql.manifest.json"
"$BUN_BIN" run scripts/export-mysql.ts \
  --db "$BACKUP_PATH" \
  --out "$EXPORT_SQL" \
  --manifest "$MANIFEST" \
  > "$RUN_DIR/export.json"
"$BUN_BIN" -e 'const r = JSON.parse(await Bun.file(process.argv[2]).text()); console.log(JSON.stringify({ ok: r.ok, outputPath: r.outputPath, manifestPath: r.manifestPath, outputBytes: r.outputBytes, tables: r.tables }, null, 2))' _ "$RUN_DIR/export.json"

echo "[7/9] Import data and verify counts/totals"
mysql --defaults-file=/root/.my.cnf gugu_gateway_dryrun < "$EXPORT_SQL"
VERIFY_SQL="$RUN_DIR/verify.sql"
"$BUN_BIN" run scripts/mysql-verify-sql.ts \
  --manifest "$MANIFEST" \
  --out "$VERIFY_SQL" \
  > "$RUN_DIR/verify-generate.json"
verify_summary="$(mysql --defaults-file=/root/.my.cnf --batch --raw --skip-column-names gugu_gateway_dryrun < "$VERIFY_SQL" | tee "$RUN_DIR/verify-results.tsv" | tail -n 1)"
printf 'Verification summary: %s\n' "$verify_summary"
if [ "$verify_summary" != $'ok\t0\t20' ]; then
  echo "MySQL dry-run verification failed; see $RUN_DIR/verify-results.tsv" >&2
  exit 1
fi

echo "[8/9] Schema check and MySQL storage contract"
GUGU_STORE_DRIVER=mysql \
GUGU_MYSQL_URL="$GUGU_MYSQL_DRYRUN_URL" \
"$BUN_BIN" run scripts/mysql-schema-check.ts \
  > "$RUN_DIR/schema-check.json"
"$BUN_BIN" -e 'const r = JSON.parse(await Bun.file(process.argv[2]).text()); console.log(JSON.stringify({ ok: r.ok, missingTables: r.missingTables, missingColumns: r.missingColumns }, null, 2))' _ "$RUN_DIR/schema-check.json"

GUGU_MYSQL_TEST_URL="$GUGU_MYSQL_CONTRACT_URL" \
"$BUN_BIN" test src/__tests__/mysql-storage-contract.test.ts \
  > "$RUN_DIR/mysql-storage-contract.txt"
cat "$RUN_DIR/mysql-storage-contract.txt"

echo "[9/9] Gateway health after dry-run"
curl -fsS http://127.0.0.1:18787/health
echo

cat <<EOF
OK: production MySQL dry-run completed.
Run dir: $RUN_DIR
Snapshot: $BACKUP_PATH
Imported DB: gugu_gateway_dryrun
Contract DB: gugu_gateway_contract
Production store driver: unchanged
EOF

#!/bin/bash
# ── Hisaabo PostgreSQL Backup Script ──────────────────────────────
# Multi-database backup with restore verification, encryption, and
# offsite R2/S3 upload. Run via cron or manually.
#
# Requires: pg_basebackup, pg_dump, psql, gzip
# Optional: rclone (R2/S3 upload), age (encryption)
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────
DB_USER="${DB_USER:-hisaabo}"
PGHOST="${PGHOST:-localhost}"
BACKUP_DIR="/var/backups/hisaabo"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
R2_BUCKET="${R2_BUCKET:-hisaabo-backups}"
R2_REMOTE="r2:${R2_BUCKET}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
VERIFY_FAILED=0
BACKUP_FILES=()

echo "=========================================="
echo "[$TIMESTAMP] Starting Hisaabo backup..."
echo "=========================================="

# Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

# ── Cleanup trap for verify databases ──────────────────────────────
VERIFY_DBS_TO_CLEANUP=()
cleanup_verify_dbs() {
  for vdb in "${VERIFY_DBS_TO_CLEANUP[@]}"; do
    dropdb -h "$PGHOST" -U "$DB_USER" --if-exists "$vdb" 2>/dev/null || true
  done
}
trap cleanup_verify_dbs EXIT

# ── 1. Full base backup ───────────────────────────────────────────
echo ""
echo "── Full base backup ──────────────────────"
BACKUP_FILE="$BACKUP_DIR/base_${TIMESTAMP}.tar.gz"
pg_basebackup \
  -h "$PGHOST" \
  -U "$DB_USER" \
  -D - \
  -Ft \
  -z \
  -P \
  > "$BACKUP_FILE"

echo "Base backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
BACKUP_FILES+=("$BACKUP_FILE")

# ── 2. Per-database SQL dumps ─────────────────────────────────────
echo ""
echo "── SQL dumps (per database) ──────────────"
DATABASES=$(psql -h "$PGHOST" -U "$DB_USER" -Atc \
  "SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres'" 2>/dev/null || echo "")

if [ -z "$DATABASES" ]; then
  echo "WARN: No databases found to dump"
else
  SQL_DUMPS=()
  SQL_DUMP_DB_MAP=()

  for DB in $DATABASES; do
    SQL_DUMP="$BACKUP_DIR/dump_${DB}_${TIMESTAMP}.sql.gz"
    echo "Dumping database: $DB"
    pg_dump -h "$PGHOST" -U "$DB_USER" -d "$DB" --no-owner --no-privileges --format=plain | gzip > "$SQL_DUMP"
    echo "  Created: $SQL_DUMP ($(du -h "$SQL_DUMP" | cut -f1))"
    BACKUP_FILES+=("$SQL_DUMP")
    SQL_DUMPS+=("$SQL_DUMP")
    SQL_DUMP_DB_MAP+=("$DB")
  done
fi

# ── 3. Gzip verification (all files) ──────────────────────────────
echo ""
echo "── Gzip integrity check ────────────────────"
for FILE in "${BACKUP_FILES[@]}"; do
  if gzip -t "$FILE"; then
    echo "  OK: $(basename "$FILE")"
  else
    echo "  FAIL: $(basename "$FILE")" >&2
    VERIFY_FAILED=1
  fi
done

if [ "$VERIFY_FAILED" -ne 0 ]; then
  echo "ERROR: Gzip verification failed for one or more files" >&2
  exit 1
fi

# ── 4. Restore verification (SQL dumps only) ──────────────────────
echo ""
echo "── Restore verification ────────────────────"
if [ "${#SQL_DUMPS[@]:-0}" -gt 0 ]; then
  for i in "${!SQL_DUMPS[@]}"; do
    DUMP_FILE="${SQL_DUMPS[$i]}"
    DB="${SQL_DUMP_DB_MAP[$i]}"
    VERIFY_DB="_backup_verify_$$_${DB}"
    VERIFY_DBS_TO_CLEANUP+=("$VERIFY_DB")

    echo "  Verifying: $DB"
    if createdb -h "$PGHOST" -U "$DB_USER" "$VERIFY_DB" 2>/dev/null; then
      if gunzip -c "$DUMP_FILE" | psql -h "$PGHOST" -U "$DB_USER" -d "$VERIFY_DB" -q 2>/dev/null; then
        TABLE_COUNT=$(psql -h "$PGHOST" -U "$DB_USER" -d "$VERIFY_DB" -Atc \
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo "0")
        TOTAL_ROWS=$(psql -h "$PGHOST" -U "$DB_USER" -d "$VERIFY_DB" -Atc \
          "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables" 2>/dev/null || echo "0")
        echo "  Verified: $DB — $TABLE_COUNT tables, ~$TOTAL_ROWS rows"
      else
        echo "  FAIL: restore of $DB failed" >&2
        VERIFY_FAILED=1
      fi
      dropdb -h "$PGHOST" -U "$DB_USER" --if-exists "$VERIFY_DB" 2>/dev/null || true
    else
      echo "  FAIL: could not create verify database for $DB" >&2
      VERIFY_FAILED=1
    fi
  done
else
  echo "  No SQL dumps to verify"
fi

if [ "$VERIFY_FAILED" -ne 0 ]; then
  echo "ERROR: Restore verification failed for one or more databases" >&2
  exit 1
fi

# ── 5. Encryption (all files, if key set) ──────────────────────────
echo ""
echo "── Encryption ──────────────────────────────"
if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  ENCRYPTED_FILES=()
  for i in "${!BACKUP_FILES[@]}"; do
    FILE="${BACKUP_FILES[$i]}"
    echo "  Encrypting: $(basename "$FILE")"
    echo "$BACKUP_ENCRYPTION_KEY" | age -e -p -o "${FILE}.age" "$FILE"
    rm "$FILE"
    BACKUP_FILES[$i]="${FILE}.age"
    ENCRYPTED_FILES+=("${FILE}.age")
  done
  echo "  Encrypted ${#ENCRYPTED_FILES[@]} file(s)"
else
  echo "  Skipped (BACKUP_ENCRYPTION_KEY not set)"
fi

# ── 6. Upload to R2/S3 ────────────────────────────────────────────
echo ""
echo "── Offsite upload (R2/S3) ──────────────────"
if command -v rclone &> /dev/null && rclone listremotes 2>/dev/null | grep -q "^r2:$"; then
  for FILE in "${BACKUP_FILES[@]}"; do
    BASENAME=$(basename "$FILE")
    if [[ "$BASENAME" == base_* ]]; then
      rclone copy "$FILE" "$R2_REMOTE/base/" --progress
    else
      rclone copy "$FILE" "$R2_REMOTE/dumps/" --progress
    fi
  done
  echo "  Uploaded ${#BACKUP_FILES[@]} file(s) to $R2_REMOTE"

  # Clean up old remote backups
  rclone delete "$R2_REMOTE" --min-age "${RETENTION_DAYS}d" 2>/dev/null || true
  echo "  Cleaned remote backups older than ${RETENTION_DAYS} days"
else
  echo "  WARN: rclone not configured — skipping offsite backup"
fi

# ── 7. Local retention cleanup ─────────────────────────────────────
echo ""
echo "── Local retention cleanup ─────────────────"
find "$BACKUP_DIR" -name "base_*.tar.gz*" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "dump_*.sql.gz*" -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
echo "  Cleaned local backups older than $RETENTION_DAYS days"

# ── 8. Summary ─────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "[$TIMESTAMP] Backup complete"
echo "  Files: ${#BACKUP_FILES[@]}"
echo "  Databases dumped: $(echo "$DATABASES" | wc -w | tr -d ' ')"
echo "  Encrypted: $([ -n "${BACKUP_ENCRYPTION_KEY:-}" ] && echo "yes" || echo "no")"
echo "  Offsite: $(command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "^r2:$" && echo "yes" || echo "no")"
echo "=========================================="

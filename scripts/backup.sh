#!/bin/bash
# ── Hisaabo PostgreSQL Backup Script ──────────────────────────────
# Multi-database backup with restore verification, encryption, and
# offsite R2/S3 upload. Run via cron or manually.
#
# Requires: pg_basebackup, pg_dump, psql, gzip
# Optional: rclone (R2/S3 upload), openssl (encryption)
#
# Encryption: when BACKUP_ENCRYPTION_KEY is set every file is encrypted with
#   openssl enc -aes-256-cbc -pbkdf2 -iter 600000   (output: <file>.enc)
# which works non-interactively (cron). `age -p` cannot read a passphrase from
# a non-tty, so it is no longer used for encryption; restore-db.sh still decrypts
# legacy .age files. Offsite upload is REFUSED when no key is set.
set -euo pipefail
umask 077

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
# Every file this run creates (plaintext and partial output). On failure before
# the local set is complete they are all deleted, so no plaintext dump or
# truncated archive is left behind.
CREATED_FILES=()
LOCAL_COMPLETE=0

echo "=========================================="
echo "[$TIMESTAMP] Starting Hisaabo backup..."
echo "=========================================="

# Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

# ── Cleanup trap for verify databases and failed-run artifacts ─────
VERIFY_DBS_TO_CLEANUP=()
cleanup() {
  local rc=$?
  for vdb in "${VERIFY_DBS_TO_CLEANUP[@]:-}"; do
    [ -n "$vdb" ] && dropdb -h "$PGHOST" -U "$DB_USER" --if-exists "$vdb" 2>/dev/null || true
  done
  if [ "$rc" -ne 0 ] && [ "$LOCAL_COMPLETE" -eq 0 ]; then
    for f in "${CREATED_FILES[@]:-}"; do
      [ -n "$f" ] && rm -f -- "$f" || true
    done
    echo "Backup failed (exit $rc): removed incomplete/plaintext files from this run" >&2
  fi
}
trap cleanup EXIT

# ── 1. Full base backup ───────────────────────────────────────────
echo ""
echo "── Full base backup ──────────────────────"
BACKUP_FILE="$BACKUP_DIR/base_${TIMESTAMP}.tar.gz"
# `-X fetch`: the default (-X stream) cannot write a tar to stdout.
CREATED_FILES+=("$BACKUP_FILE")
pg_basebackup \
  -h "$PGHOST" \
  -U "$DB_USER" \
  -D - \
  -Ft \
  -X fetch \
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

SQL_DUMPS=()
SQL_DUMP_DB_MAP=()
if [ -z "$DATABASES" ]; then
  echo "WARN: No databases found to dump"
else
  for DB in $DATABASES; do
    SQL_DUMP="$BACKUP_DIR/dump_${DB}_${TIMESTAMP}.sql.gz"
    echo "Dumping database: $DB"
    CREATED_FILES+=("$SQL_DUMP")
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
if [ "${#SQL_DUMPS[@]}" -gt 0 ]; then
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
  # The passphrase is passed to openssl via the environment, never argv.
  export BACKUP_ENCRYPTION_KEY
  ENCRYPTED_FILES=()
  for i in "${!BACKUP_FILES[@]}"; do
    FILE="${BACKUP_FILES[$i]}"
    echo "  Encrypting: $(basename "$FILE")"
    CREATED_FILES+=("${FILE}.enc")
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt \
      -pass env:BACKUP_ENCRYPTION_KEY -in "$FILE" -out "${FILE}.enc"
    rm -f -- "$FILE"
    BACKUP_FILES[$i]="${FILE}.enc"
    ENCRYPTED_FILES+=("${FILE}.enc")
  done
  echo "  Encrypted ${#ENCRYPTED_FILES[@]} file(s)"
else
  echo "  Skipped (BACKUP_ENCRYPTION_KEY not set) — files are stored in PLAINTEXT"
fi
# Local backup set is complete (encrypted if a key is configured): from here on
# a failure (e.g. offsite upload) must not delete it.
LOCAL_COMPLETE=1

# ── 6. Upload to R2/S3 ────────────────────────────────────────────
echo ""
echo "── Offsite upload (R2/S3) ──────────────────"
if command -v rclone &> /dev/null && rclone listremotes 2>/dev/null | grep -q "^r2:$"; then
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "ERROR: offsite upload is configured but BACKUP_ENCRYPTION_KEY is not set." >&2
    echo "ERROR: refusing to upload unencrypted database backups. Set BACKUP_ENCRYPTION_KEY" >&2
    echo "ERROR: (openssl rand -base64 32) or remove the R2_* credentials. Local backups were kept." >&2
    exit 1
  fi
  for FILE in "${BACKUP_FILES[@]}"; do
    BASENAME=$(basename "$FILE")
    if [[ "$BASENAME" == base_* ]]; then
      rclone copy "$FILE" "$R2_REMOTE/base/" --progress
    else
      rclone copy "$FILE" "$R2_REMOTE/dumps/" --progress
    fi
  done
  echo "  Uploaded ${#BACKUP_FILES[@]} file(s) to $R2_REMOTE"

  # Clean up old remote backups — scoped to the prefixes this script writes,
  # so unrelated objects sharing the bucket are never touched.
  for PREFIX in base dumps; do
    rclone delete "$R2_REMOTE/$PREFIX/" --min-age "${RETENTION_DAYS}d" \
      || echo "  WARN: remote retention cleanup failed for $PREFIX/" >&2
  done
  echo "  Cleaned remote backups older than ${RETENTION_DAYS} days (base/, dumps/)"
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

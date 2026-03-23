#!/bin/bash
# ── Billbook PostgreSQL Backup Script ───────────────────────────
# Run via cron: 0 2 * * * /opt/billbook/scripts/backup.sh
# Requires: pg_basebackup, rclone (configured with R2/S3)
set -euo pipefail

# Config
DB_USER="${DB_USER:-billbook}"
DB_NAME="${DB_NAME:-billbook}"
BACKUP_DIR="/var/backups/billbook"
RETENTION_DAYS=30
R2_REMOTE="r2:billbook-backups"  # rclone remote name
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "[$TIMESTAMP] Starting backup..."

# Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

# ── Full base backup ───────────────────────────────────────────
BACKUP_FILE="$BACKUP_DIR/base_${TIMESTAMP}.tar.gz"
pg_basebackup \
  -U "$DB_USER" \
  -D - \
  -Ft \
  -z \
  -P \
  > "$BACKUP_FILE"

echo "Base backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── Also dump as SQL for portability ────────────────────────────
SQL_DUMP="$BACKUP_DIR/dump_${TIMESTAMP}.sql.gz"
pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip > "$SQL_DUMP"

echo "SQL dump created: $SQL_DUMP ($(du -h "$SQL_DUMP" | cut -f1))"

# ── Upload to R2/S3 ────────────────────────────────────────────
if command -v rclone &> /dev/null; then
  rclone copy "$BACKUP_FILE" "$R2_REMOTE/base/" --progress
  rclone copy "$SQL_DUMP" "$R2_REMOTE/dumps/" --progress
  echo "Uploaded to R2"
else
  echo "WARN: rclone not installed, skipping offsite backup"
fi

# ── Cleanup old local backups ───────────────────────────────────
find "$BACKUP_DIR" -name "base_*.tar.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "dump_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "Cleaned up backups older than $RETENTION_DAYS days"

# ── Verify backup integrity ────────────────────────────────────
if gzip -t "$BACKUP_FILE" && gzip -t "$SQL_DUMP"; then
  echo "[$TIMESTAMP] Backup verified OK"
else
  echo "[$TIMESTAMP] ERROR: Backup verification failed!" >&2
  exit 1
fi

echo "[$TIMESTAMP] Backup complete"

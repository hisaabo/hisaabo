#!/bin/bash
# ── Hisaabo Single Database Restore ──────────────────────────────
# Restore a single database from backup without affecting other databases.
# Designed for per-tenant restore in multi-tenant deployments.
#
# Usage:
#   restore-db.sh <database-name> [dump-file]
#
# If dump-file is omitted, uses the most recent dump matching the database name.
#
# Examples:
#   restore-db.sh tenant_acme                           # latest dump
#   restore-db.sh tenant_acme dump_tenant_acme_20260414_030000.sql.gz
#   restore-db.sh hisaabo                               # restore control DB
#
# Env vars:
#   PGHOST, PGUSER, PGPASSWORD     — PostgreSQL connection (defaults: localhost, hisaabo)
#   BACKUP_ENCRYPTION_KEY           — Decryption key (if backups are encrypted)
#   BACKUP_DIR                      — Backup directory (default: /var/backups/hisaabo)
set -euo pipefail

DB_NAME="${1:-}"
DUMP_FILE="${2:-}"
DB_USER="${PGUSER:-${DB_USER:-hisaabo}}"
HOST="${PGHOST:-localhost}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hisaabo}"

if [ -z "$DB_NAME" ]; then
  echo "Usage: restore-db.sh <database-name> [dump-file]" >&2
  echo "" >&2
  echo "Available backups:" >&2
  ls -1t "$BACKUP_DIR"/dump_*.sql.gz* "$BACKUP_DIR"/*.dump* 2>/dev/null | head -20 >&2 || echo "  (none found)" >&2
  exit 1
fi

# ── Find the dump file ─────────────────────────────────────────────
if [ -z "$DUMP_FILE" ]; then
  # Find most recent dump for this database (try SQL dump first, then custom format)
  DUMP_FILE=$(ls -1t "$BACKUP_DIR"/dump_${DB_NAME}_*.sql.gz* 2>/dev/null | head -1 || true)
  if [ -z "$DUMP_FILE" ]; then
    DUMP_FILE=$(ls -1t "$BACKUP_DIR"/${DB_NAME}.dump* 2>/dev/null | head -1 || true)
  fi
  if [ -z "$DUMP_FILE" ]; then
    echo "ERROR: No backup found for database '$DB_NAME' in $BACKUP_DIR" >&2
    echo "" >&2
    echo "Available backups:" >&2
    ls -1t "$BACKUP_DIR"/dump_*.sql.gz* "$BACKUP_DIR"/*.dump* 2>/dev/null | head -20 >&2 || echo "  (none)" >&2
    exit 1
  fi
elif [ ! -f "$DUMP_FILE" ] && [ -f "$BACKUP_DIR/$DUMP_FILE" ]; then
  # Allow passing just the filename without the full path
  DUMP_FILE="$BACKUP_DIR/$DUMP_FILE"
fi

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: Dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "=== Restoring database: $DB_NAME ==="
echo "  From: $DUMP_FILE"
echo "  Host: $HOST"
echo "  User: $DB_USER"

# ── Decrypt if encrypted ──────────────────────────────────────────
WORK_FILE="$DUMP_FILE"
DECRYPTED_TEMP=""

if echo "$DUMP_FILE" | grep -q '\.age$'; then
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "ERROR: Encrypted backup but BACKUP_ENCRYPTION_KEY is not set" >&2
    exit 1
  fi
  DECRYPTED_TEMP="${DUMP_FILE%.age}"
  echo "  Decrypting..."
  echo "$BACKUP_ENCRYPTION_KEY" | age -d -o "$DECRYPTED_TEMP" "$DUMP_FILE"
  WORK_FILE="$DECRYPTED_TEMP"
fi

# ── Verify the target database exists (safety check) ──────────────
DB_EXISTS=$(psql -h "$HOST" -U "$DB_USER" -Atc \
  "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" 2>/dev/null || echo "0")

if [ "$DB_EXISTS" = "1" ]; then
  # Count active connections to warn the operator
  CONN_COUNT=$(psql -h "$HOST" -U "$DB_USER" -Atc \
    "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid != pg_backend_pid()" 2>/dev/null || echo "0")
  if [ "$CONN_COUNT" -gt 0 ]; then
    echo "  WARNING: $CONN_COUNT active connection(s) to $DB_NAME"
    echo "  Terminating connections..."
    psql -h "$HOST" -U "$DB_USER" -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid != pg_backend_pid()" > /dev/null 2>&1 || true
  fi
fi

# ── Restore ───────────────────────────────────────────────────────
echo "  Dropping and recreating $DB_NAME..."
dropdb -h "$HOST" -U "$DB_USER" --if-exists "$DB_NAME"
createdb -h "$HOST" -U "$DB_USER" "$DB_NAME"

if echo "$WORK_FILE" | grep -q '\.sql\.gz$'; then
  echo "  Restoring from SQL dump..."
  gunzip -c "$WORK_FILE" | psql -h "$HOST" -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null
elif echo "$WORK_FILE" | grep -q '\.dump$'; then
  echo "  Restoring from custom-format dump..."
  pg_restore -h "$HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges "$WORK_FILE"
else
  echo "ERROR: Unrecognized dump format: $WORK_FILE" >&2
  exit 1
fi

# ── Cleanup temp decrypted file ───────────────────────────────────
if [ -n "$DECRYPTED_TEMP" ] && [ -f "$DECRYPTED_TEMP" ]; then
  rm -f "$DECRYPTED_TEMP"
fi

# ── Verify ────────────────────────────────────────────────────────
TABLE_COUNT=$(psql -h "$HOST" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo "?")
ROW_COUNT=$(psql -h "$HOST" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables" 2>/dev/null || echo "?")

echo ""
echo "=== Restore complete ==="
echo "  Database: $DB_NAME"
echo "  Tables:   $TABLE_COUNT"
echo "  Rows:     ~$ROW_COUNT"

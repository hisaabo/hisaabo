#!/bin/bash
# ── Hisaabo Single Database Restore ──────────────────────────────
# Restore a single database from backup without affecting other databases.
# Designed for per-tenant restore in multi-tenant deployments.
#
# The dump is first restored into a scratch database and verified; only then is
# it swapped in for the live database (rename). A failed or corrupt restore
# therefore never destroys the existing database.
#
# Usage:
#   restore-db.sh <database-name> [dump-file]
#
# If dump-file is omitted, uses the most recent dump matching the database name.
#
# Examples:
#   restore-db.sh tenant_acme                           # latest dump
#   restore-db.sh tenant_acme dump_tenant_acme_20260414_030000.sql.gz.enc
#   restore-db.sh hisaabo                               # restore control DB
#
# Supported dump formats: .sql.gz, .dump, each optionally encrypted as
#   .enc  (openssl aes-256-cbc -pbkdf2, written by backup.sh; non-interactive)
#   .age  (legacy age passphrase files; age prompts for the passphrase on the
#          terminal, it cannot be supplied via stdin/env)
#
# Env vars:
#   PGHOST, PGUSER, PGPASSWORD     — PostgreSQL connection (defaults: localhost, hisaabo)
#   BACKUP_ENCRYPTION_KEY           — Decryption key for .enc backups
#   BACKUP_DIR                      — Backup directory (default: /var/backups/hisaabo)
#   KEEP_PREVIOUS=1                 — keep the replaced database as _restore_old_<pid>
#                                     instead of dropping it after a successful swap
set -euo pipefail
umask 077

DB_NAME="${1:-}"
DUMP_FILE="${2:-}"
DB_USER="${PGUSER:-${DB_USER:-hisaabo}}"
HOST="${PGHOST:-localhost}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hisaabo}"

list_backups() {
  ls -1t "$BACKUP_DIR"/dump_*.sql.gz* "$BACKUP_DIR"/*.dump* 2>/dev/null | head -20 >&2 || echo "  (none found)" >&2
}

if [ -z "$DB_NAME" ]; then
  echo "Usage: restore-db.sh <database-name> [dump-file]" >&2
  echo "" >&2
  echo "Available backups:" >&2
  list_backups
  exit 1
fi

# Database names are interpolated into SQL and file globs: allow plain
# identifiers only (also the PostgreSQL 63-byte limit).
if ! [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "ERROR: invalid database name '$DB_NAME' (allowed: letters, digits, underscore; must not start with a digit; max 63 chars)" >&2
  exit 1
fi

# ── Find the dump file ─────────────────────────────────────────────
if [ -z "$DUMP_FILE" ]; then
  # Most recent dump for exactly this database. The timestamp suffix is matched
  # strictly so that e.g. "hisaabo" does not pick up "hisaabo_tenant" dumps.
  shopt -s nullglob
  TS='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]'
  # shellcheck disable=SC2206  # intentional glob expansion
  CANDIDATES=("$BACKUP_DIR"/dump_"${DB_NAME}"_${TS}.sql.gz*)
  if [ "${#CANDIDATES[@]}" -eq 0 ]; then
    CANDIDATES=("$BACKUP_DIR"/"${DB_NAME}".dump*)
  fi
  shopt -u nullglob
  if [ "${#CANDIDATES[@]}" -eq 0 ]; then
    echo "ERROR: No backup found for database '$DB_NAME' in $BACKUP_DIR" >&2
    echo "" >&2
    echo "Available backups:" >&2
    list_backups
    exit 1
  fi
  DUMP_FILE=$(ls -1t -- "${CANDIDATES[@]}" | head -1)
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

# ── Cleanup: scratch files and databases, rollback of a half-done swap ──
WORK_DIR=""
TMP_DB="_restore_tmp_$$"
OLD_DB="_restore_old_$$"
STATE="init"   # init -> scratch_created -> live_renamed -> done
LIVE_LOCKED=0

pg() { psql -h "$HOST" -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

cleanup() {
  local rc=$?
  set +e
  [ -n "$WORK_DIR" ] && rm -rf -- "$WORK_DIR"
  if [ "$rc" -ne 0 ]; then
    if [ "$STATE" = "live_renamed" ]; then
      echo "  Swap failed — rolling back to the previous database" >&2
      pg -c "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$DB_NAME\"" >&2
    fi
    if [ "$LIVE_LOCKED" -eq 1 ]; then
      pg -c "ALTER DATABASE \"$DB_NAME\" WITH ALLOW_CONNECTIONS true" >&2
    fi
    if [ "$STATE" != "init" ] && [ "$STATE" != "done" ]; then
      dropdb -h "$HOST" -U "$DB_USER" --if-exists "$TMP_DB" >&2
    fi
    if [ "$STATE" = "done" ]; then
      echo "ERROR: '$DB_NAME' was restored but a post-swap step failed; check for a leftover $OLD_DB database" >&2
    else
      echo "ERROR: restore failed — existing database '$DB_NAME' was left untouched (or rolled back)" >&2
    fi
  fi
}
trap cleanup EXIT

# ── Decrypt if encrypted ──────────────────────────────────────────
WORK_FILE="$DUMP_FILE"
case "$DUMP_FILE" in
  *.enc|*.age)
    WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hisaabo-restore.XXXXXX")
    BASE=$(basename "$DUMP_FILE")
    WORK_FILE="$WORK_DIR/${BASE%.*}"
    echo "  Decrypting..."
    case "$DUMP_FILE" in
      *.enc)
        if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
          echo "ERROR: Encrypted backup but BACKUP_ENCRYPTION_KEY is not set" >&2
          exit 1
        fi
        export BACKUP_ENCRYPTION_KEY
        openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
          -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP_FILE" -out "$WORK_FILE"
        ;;
      *.age)
        # Legacy format: age reads the passphrase from the terminal.
        age -d -o "$WORK_FILE" "$DUMP_FILE"
        ;;
    esac
    ;;
esac

case "$WORK_FILE" in
  *.sql.gz|*.dump) ;;
  *)
    echo "ERROR: Unrecognized dump format: $WORK_FILE" >&2
    exit 1
    ;;
esac

# Cheap integrity check before touching anything (also catches a wrong key).
if [[ "$WORK_FILE" == *.sql.gz ]]; then
  gzip -t "$WORK_FILE"
fi

# ── Restore into a scratch database ───────────────────────────────
echo "  Creating scratch database..."
createdb -h "$HOST" -U "$DB_USER" "$TMP_DB"
STATE="scratch_created"

if [[ "$WORK_FILE" == *.sql.gz ]]; then
  echo "  Restoring from SQL dump..."
  gunzip -c "$WORK_FILE" | psql -h "$HOST" -U "$DB_USER" -d "$TMP_DB" -q \
    -v ON_ERROR_STOP=1 --single-transaction
else
  echo "  Restoring from custom-format dump..."
  pg_restore -h "$HOST" -U "$DB_USER" -d "$TMP_DB" --no-owner --no-privileges \
    --exit-on-error "$WORK_FILE"
fi

TMP_TABLES=$(psql -h "$HOST" -U "$DB_USER" -d "$TMP_DB" -Atc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
if [ "$TMP_TABLES" -eq 0 ]; then
  echo "ERROR: restored dump contains no tables — refusing to replace '$DB_NAME'" >&2
  exit 1
fi

# ── Swap the restored database in ─────────────────────────────────
DB_EXISTS=$(pg -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")

if [ "$DB_EXISTS" = "1" ]; then
  CONN_COUNT=$(pg -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid != pg_backend_pid()")
  if [ "$CONN_COUNT" -gt 0 ]; then
    echo "  WARNING: $CONN_COUNT active connection(s) to $DB_NAME — terminating"
  fi
  # Block new connections, then evict existing ones so the rename can proceed.
  pg -c "ALTER DATABASE \"$DB_NAME\" WITH ALLOW_CONNECTIONS false"
  LIVE_LOCKED=1
  pg -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid != pg_backend_pid()" > /dev/null
  pg -c "ALTER DATABASE \"$DB_NAME\" RENAME TO \"$OLD_DB\""
  STATE="live_renamed"
fi

pg -c "ALTER DATABASE \"$TMP_DB\" RENAME TO \"$DB_NAME\""
STATE="done"

if [ "$DB_EXISTS" = "1" ]; then
  pg -c "ALTER DATABASE \"$OLD_DB\" WITH ALLOW_CONNECTIONS true"
  LIVE_LOCKED=0
  if [ "${KEEP_PREVIOUS:-0}" = "1" ]; then
    echo "  Previous database kept as: $OLD_DB"
  else
    dropdb -h "$HOST" -U "$DB_USER" --if-exists "$OLD_DB"
  fi
fi

# ── Verify ────────────────────────────────────────────────────────
TABLE_COUNT=$(psql -h "$HOST" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
ROW_COUNT=$(psql -h "$HOST" -U "$DB_USER" -d "$DB_NAME" -Atc \
  "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables")

echo ""
echo "=== Restore complete ==="
echo "  Database: $DB_NAME"
echo "  Tables:   $TABLE_COUNT"
echo "  Rows:     ~$ROW_COUNT"

#!/bin/bash
# ── Backup & Restore Integration Test ────────────────────────────
# Verifies that per-database backup/restore works correctly,
# especially single-tenant restore without affecting other tenants.
#
# Requires: running PostgreSQL instance (local or via docker-compose)
#
# Usage:
#   scripts/test-backup-restore.sh              # uses localhost, user=postgres
#   PGHOST=localhost PGUSER=hisaabo scripts/test-backup-restore.sh
#
# Exit code 0 = all tests passed, non-zero = failure
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
HOST="${PGHOST:-localhost}"
USER="${PGUSER:-postgres}"
export PGHOST="$HOST"
export PGUSER="$USER"
BACKUP_DIR=$(mktemp -d)
TEST_PREFIX="_backuptest_$$"

# Test database names — use unique prefix to avoid collisions
DB_CONTROL="${TEST_PREFIX}_hisaabo"
DB_TENANT_A="${TEST_PREFIX}_tenant_alpha"
DB_TENANT_B="${TEST_PREFIX}_tenant_beta"
ALL_DBS="$DB_CONTROL $DB_TENANT_A $DB_TENANT_B"

PASS=0
FAIL=0
TESTS=()

# ── Helpers ───────────────────────────────────────────────────────
log()  { echo "  $*"; }
pass() { PASS=$((PASS + 1)); TESTS+=("PASS: $1"); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); TESTS+=("FAIL: $1"); echo "  FAIL: $1" >&2; }

sql() {
  local db="$1"; shift
  psql -h "$HOST" -U "$USER" -d "$db" -Atc "$*" 2>/dev/null
}

cleanup() {
  echo ""
  echo "── Cleanup ──────────────────────────────────"
  for db in $ALL_DBS; do
    dropdb -h "$HOST" -U "$USER" --if-exists "$db" 2>/dev/null || true
  done
  # Also clean up any verify databases left by backup.sh
  for db in $(psql -h "$HOST" -U "$USER" -Atc \
    "SELECT datname FROM pg_database WHERE datname LIKE '${TEST_PREFIX}%'" 2>/dev/null); do
    dropdb -h "$HOST" -U "$USER" --if-exists "$db" 2>/dev/null || true
  done
  rm -rf "$BACKUP_DIR"
  echo "  Cleaned up test databases and backup dir"
}
trap cleanup EXIT

# ── Setup ─────────────────────────────────────────────────────────
echo "=== Backup & Restore Integration Test ==="
echo "  Host: $HOST, User: $USER"
echo "  Backup dir: $BACKUP_DIR"
echo ""

echo "── Setup: creating test databases ─────────"
for db in $ALL_DBS; do
  dropdb -h "$HOST" -U "$USER" --if-exists "$db" 2>/dev/null || true
  createdb -h "$HOST" -U "$USER" "$db"
  log "Created: $db"
done

# Seed each DB with distinct, verifiable data
sql "$DB_CONTROL" "CREATE TABLE tenants (id serial PRIMARY KEY, name text NOT NULL)"
sql "$DB_CONTROL" "INSERT INTO tenants (name) VALUES ('Alpha Corp'), ('Beta Inc')"

sql "$DB_TENANT_A" "CREATE TABLE invoices (id serial PRIMARY KEY, amount numeric(15,2), party text)"
sql "$DB_TENANT_A" "INSERT INTO invoices (amount, party) VALUES (1000.50, 'Customer A1'), (2500.00, 'Customer A2'), (750.25, 'Customer A3')"
sql "$DB_TENANT_A" "CREATE TABLE items (id serial PRIMARY KEY, name text)"
sql "$DB_TENANT_A" "INSERT INTO items (name) VALUES ('Widget'), ('Gadget')"

sql "$DB_TENANT_B" "CREATE TABLE invoices (id serial PRIMARY KEY, amount numeric(15,2), party text)"
sql "$DB_TENANT_B" "INSERT INTO invoices (amount, party) VALUES (5000.00, 'Customer B1'), (3333.33, 'Customer B2')"
sql "$DB_TENANT_B" "CREATE TABLE items (id serial PRIMARY KEY, name text)"
sql "$DB_TENANT_B" "INSERT INTO items (name) VALUES ('Sprocket')"

echo ""

# ══════════════════════════════════════════════════════════════════
# Test 1: Per-database backup creates separate dump files
# ══════════════════════════════════════════════════════════════════
echo "── Test 1: Per-database backup ────────────"

for db in $ALL_DBS; do
  DUMP_FILE="$BACKUP_DIR/${db}.dump"
  pg_dump -h "$HOST" -U "$USER" "$db" --format=custom --compress=6 --file="$DUMP_FILE"
  log "Dumped: $db ($(du -h "$DUMP_FILE" | cut -f1))"
done

# Verify separate files exist
for db in $ALL_DBS; do
  if [ -f "$BACKUP_DIR/${db}.dump" ]; then
    pass "Dump file exists for $db"
  else
    fail "Dump file missing for $db"
  fi
done

# ══════════════════════════════════════════════════════════════════
# Test 2: Single-tenant restore does NOT affect other tenants
# ══════════════════════════════════════════════════════════════════
echo ""
echo "── Test 2: Single-tenant restore isolation ─"

# Record tenant_b state BEFORE the restore
B_INVOICE_COUNT_BEFORE=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM invoices")
B_ITEM_COUNT_BEFORE=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM items")
B_TOTAL_BEFORE=$(sql "$DB_TENANT_B" "SELECT SUM(amount) FROM invoices")
CONTROL_COUNT_BEFORE=$(sql "$DB_CONTROL" "SELECT COUNT(*) FROM tenants")

# Corrupt tenant_a (simulate data loss / bad migration)
sql "$DB_TENANT_A" "DELETE FROM invoices"
sql "$DB_TENANT_A" "DROP TABLE items"
CORRUPTED_COUNT=$(sql "$DB_TENANT_A" "SELECT COUNT(*) FROM invoices")
if [ "$CORRUPTED_COUNT" = "0" ]; then
  log "Tenant A corrupted (invoices: 0, items table dropped)"
else
  fail "Could not corrupt tenant A for testing"
fi

# Restore ONLY tenant_a
log "Restoring only $DB_TENANT_A..."
dropdb -h "$HOST" -U "$USER" --if-exists "$DB_TENANT_A"
createdb -h "$HOST" -U "$USER" "$DB_TENANT_A"
pg_restore -h "$HOST" -U "$USER" -d "$DB_TENANT_A" --no-owner --no-privileges "$BACKUP_DIR/${DB_TENANT_A}.dump"

# Verify tenant_a is restored
A_INVOICE_COUNT=$(sql "$DB_TENANT_A" "SELECT COUNT(*) FROM invoices")
A_ITEM_COUNT=$(sql "$DB_TENANT_A" "SELECT COUNT(*) FROM items")
if [ "$A_INVOICE_COUNT" = "3" ]; then
  pass "Tenant A invoices restored (count=$A_INVOICE_COUNT)"
else
  fail "Tenant A invoices wrong (expected=3, got=$A_INVOICE_COUNT)"
fi
if [ "$A_ITEM_COUNT" = "2" ]; then
  pass "Tenant A items restored (count=$A_ITEM_COUNT)"
else
  fail "Tenant A items wrong (expected=2, got=$A_ITEM_COUNT)"
fi

# Verify tenant_b was NOT touched
B_INVOICE_COUNT_AFTER=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM invoices")
B_ITEM_COUNT_AFTER=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM items")
B_TOTAL_AFTER=$(sql "$DB_TENANT_B" "SELECT SUM(amount) FROM invoices")
CONTROL_COUNT_AFTER=$(sql "$DB_CONTROL" "SELECT COUNT(*) FROM tenants")

if [ "$B_INVOICE_COUNT_AFTER" = "$B_INVOICE_COUNT_BEFORE" ]; then
  pass "Tenant B invoices untouched ($B_INVOICE_COUNT_AFTER)"
else
  fail "Tenant B invoices CHANGED (before=$B_INVOICE_COUNT_BEFORE, after=$B_INVOICE_COUNT_AFTER)"
fi
if [ "$B_ITEM_COUNT_AFTER" = "$B_ITEM_COUNT_BEFORE" ]; then
  pass "Tenant B items untouched ($B_ITEM_COUNT_AFTER)"
else
  fail "Tenant B items CHANGED (before=$B_ITEM_COUNT_BEFORE, after=$B_ITEM_COUNT_AFTER)"
fi
if [ "$B_TOTAL_AFTER" = "$B_TOTAL_BEFORE" ]; then
  pass "Tenant B monetary totals untouched ($B_TOTAL_AFTER)"
else
  fail "Tenant B monetary totals CHANGED (before=$B_TOTAL_BEFORE, after=$B_TOTAL_AFTER)"
fi
if [ "$CONTROL_COUNT_AFTER" = "$CONTROL_COUNT_BEFORE" ]; then
  pass "Control DB untouched ($CONTROL_COUNT_AFTER tenants)"
else
  fail "Control DB CHANGED (before=$CONTROL_COUNT_BEFORE, after=$CONTROL_COUNT_AFTER)"
fi

# ══════════════════════════════════════════════════════════════════
# Test 3: restore-db.sh script works for single-tenant restore
# ══════════════════════════════════════════════════════════════════
echo ""
echo "── Test 3: restore-db.sh script ───────────"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESTORE_SCRIPT="$SCRIPT_DIR/restore-db.sh"

if [ ! -x "$RESTORE_SCRIPT" ]; then
  fail "restore-db.sh not found or not executable at $RESTORE_SCRIPT"
else
  # Also create a SQL dump for restore-db.sh (it prefers SQL format)
  SQL_DUMP="$BACKUP_DIR/dump_${DB_TENANT_A}_20260414_030000.sql.gz"
  pg_dump -h "$HOST" -U "$USER" -d "$DB_TENANT_A" --no-owner --no-privileges --format=plain | gzip > "$SQL_DUMP"

  # Corrupt tenant_a again
  sql "$DB_TENANT_A" "DELETE FROM invoices"
  log "Tenant A corrupted again for restore-db.sh test"

  # Restore using the script
  BACKUP_DIR="$BACKUP_DIR" DB_USER="$USER" "$RESTORE_SCRIPT" "$DB_TENANT_A" > /dev/null 2>&1

  # Verify
  A_RESTORED=$(sql "$DB_TENANT_A" "SELECT COUNT(*) FROM invoices")
  if [ "$A_RESTORED" = "3" ]; then
    pass "restore-db.sh restored tenant A correctly ($A_RESTORED invoices)"
  else
    fail "restore-db.sh restore failed (expected=3, got=$A_RESTORED)"
  fi

  # Verify tenant_b still untouched
  B_STILL_OK=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM invoices")
  if [ "$B_STILL_OK" = "$B_INVOICE_COUNT_BEFORE" ]; then
    pass "restore-db.sh did not affect tenant B ($B_STILL_OK)"
  else
    fail "restore-db.sh affected tenant B (expected=$B_INVOICE_COUNT_BEFORE, got=$B_STILL_OK)"
  fi
fi

# ══════════════════════════════════════════════════════════════════
# Test 4: Monetary precision preserved through backup/restore cycle
# ══════════════════════════════════════════════════════════════════
echo ""
echo "── Test 4: Monetary precision ─────────────"

# Check exact values survived the round-trip
A_AMOUNT_1=$(sql "$DB_TENANT_A" "SELECT amount FROM invoices WHERE party = 'Customer A1'")
A_AMOUNT_3=$(sql "$DB_TENANT_A" "SELECT amount FROM invoices WHERE party = 'Customer A3'")

if [ "$A_AMOUNT_1" = "1000.50" ]; then
  pass "Monetary precision preserved (1000.50)"
else
  fail "Monetary precision lost (expected=1000.50, got=$A_AMOUNT_1)"
fi
if [ "$A_AMOUNT_3" = "750.25" ]; then
  pass "Monetary precision preserved (750.25)"
else
  fail "Monetary precision lost (expected=750.25, got=$A_AMOUNT_3)"
fi

# ══════════════════════════════════════════════════════════════════
# Test 5: Full restore (all databases) works
# ══════════════════════════════════════════════════════════════════
echo ""
echo "── Test 5: Full restore (all databases) ───"

# Drop all test databases
for db in $ALL_DBS; do
  dropdb -h "$HOST" -U "$USER" --if-exists "$db"
done
log "All test databases dropped"

# Restore all from custom-format dumps
for db in $ALL_DBS; do
  createdb -h "$HOST" -U "$USER" "$db"
  pg_restore -h "$HOST" -U "$USER" -d "$db" --no-owner --no-privileges "$BACKUP_DIR/${db}.dump"
done
log "All databases restored"

# Verify everything
FULL_A=$(sql "$DB_TENANT_A" "SELECT COUNT(*) FROM invoices")
FULL_B=$(sql "$DB_TENANT_B" "SELECT COUNT(*) FROM invoices")
FULL_C=$(sql "$DB_CONTROL" "SELECT COUNT(*) FROM tenants")

if [ "$FULL_A" = "3" ] && [ "$FULL_B" = "2" ] && [ "$FULL_C" = "2" ]; then
  pass "Full restore: all databases correct (A=$FULL_A, B=$FULL_B, control=$FULL_C)"
else
  fail "Full restore: data mismatch (A=$FULL_A expected 3, B=$FULL_B expected 2, control=$FULL_C expected 2)"
fi

# ══════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════
echo ""
echo "=========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "=========================================="
for t in "${TESTS[@]}"; do
  echo "  $t"
done

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "BACKUP/RESTORE TESTS FAILED"
  exit 1
fi

echo ""
echo "ALL BACKUP/RESTORE TESTS PASSED"

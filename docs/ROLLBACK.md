# Migration Rollback Procedures

Emergency reference for rolling back Drizzle ORM migrations in Hisaabo. Drizzle does not generate down/rollback migrations. This document provides reverse SQL for each migration and instructions for backup-based recovery.

**Last updated**: 2026-04-14
**Applies to**: migrations 0000 through 0009

---

## Quick Reference

| Migration | Name | Risk | Data Loss | Recommended Strategy |
|-----------|------|------|-----------|---------------------|
| 0009 | ENUM: `adjusted` status | Low | None (if no rows use the value) | Manual reverse SQL |
| 0008 | Soft-delete columns on items | Low | Soft-deleted items become visible | Manual reverse SQL |
| 0007 | Split invoice_items description | Medium | None (reversible data transform) | Manual reverse SQL |
| 0006 | Accounting/GST/e-invoice tables | High | All data in 14 new tables lost | Backup restore preferred |
| 0005 | Payment gateway configs | Medium | Gateway configs + ENUM type-swaps | Manual reverse SQL |
| 0004 | Session tracking + index | Low | None | Manual reverse SQL |
| 0003 | Recurring invoices | Medium | All recurring templates/runs lost | Manual reverse SQL |
| 0002 | Feature expansion + ENUMs | **Critical** | Too large for manual rollback | Backup restore only |
| 0001 | Alt-unit columns | Low | Unit conversion data lost | Backup restore only |
| 0000 | Initial schema | **Critical** | Everything | Backup restore only |

---

## 1. General Rollback Strategies

Listed in order of preference. Always choose the highest-numbered strategy that applies to your situation.

### Strategy 1: Restore from Backup (Safest)

Full database restore from a known-good backup taken before the migration ran. This is the only option for migrations 0000-0002 and the recommended approach for 0006.

#### ONCE Container

The pre-backup hook (`/hooks/pre-backup`) creates `pg_dump --format=custom` dumps in `/storage/backups/` before ONCE snapshots the `/storage` volume. The post-restore hook (`/hooks/post-restore`) restores from those dumps.

```bash
# 1. Stop the container (or let ONCE handle it during a restore operation)
docker stop hisaabo

# 2. If restoring manually (outside ONCE's restore flow):
#    Exec into the container and restore the specific database
docker exec -it hisaabo sh

# 3. Wait for PostgreSQL to be ready
SOCKETDIR="/storage/run"
pg_isready -h "$SOCKETDIR" -U postgres

# 4. List available backups
ls -lh /storage/backups/

# 5. If backups are encrypted, decrypt first
echo "$BACKUP_ENCRYPTION_KEY" | age -d -o /storage/backups/hisaabo.dump /storage/backups/hisaabo.dump.age

# 6. Restore (WARNING: this drops and recreates the database)
dropdb -h "$SOCKETDIR" -U postgres --if-exists hisaabo
createdb -h "$SOCKETDIR" -U postgres hisaabo
pg_restore -h "$SOCKETDIR" -U postgres -d hisaabo --no-owner --no-privileges /storage/backups/hisaabo.dump

# 7. Verify
psql -h "$SOCKETDIR" -U postgres -d hisaabo -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
```

If you are using the ONCE platform's built-in restore flow, it will unpack `/storage` from the snapshot and then execute `/hooks/post-restore` automatically. No manual intervention is needed.

#### Docker Compose (backup sidecar)

The backup sidecar runs `scripts/backup.sh` on cron. It creates per-database SQL dumps at `/var/backups/hisaabo/dump_<dbname>_<timestamp>.sql.gz` and full base backups at `/var/backups/hisaabo/base_<timestamp>.tar.gz`.

```bash
# 1. Stop the API to prevent writes during restore
docker compose stop api

# 2. List available backups (exec into backup sidecar or the postgres container)
docker compose exec backup ls -lh /var/backups/hisaabo/

# 3. If encrypted, decrypt first
docker compose exec backup sh -c \
  'echo "$BACKUP_ENCRYPTION_KEY" | age -d -o /var/backups/hisaabo/decrypted.sql.gz /var/backups/hisaabo/dump_hisaabo_20260414_030000.sql.gz.age'

# 4. Restore from SQL dump
docker compose exec -T postgres sh -c \
  'gunzip -c /var/backups/hisaabo/dump_hisaabo_20260414_030000.sql.gz | psql -U hisaabo -d hisaabo'

# If you need a clean restore (drop + recreate):
docker compose exec postgres dropdb -U hisaabo --if-exists hisaabo
docker compose exec postgres createdb -U hisaabo hisaabo
docker compose exec -T postgres sh -c \
  'gunzip -c /var/backups/hisaabo/dump_hisaabo_20260414_030000.sql.gz | psql -U hisaabo -d hisaabo'

# 5. Verify
docker compose exec postgres psql -U hisaabo -d hisaabo -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"

# 6. Restart API
docker compose start api
```

### Single-Tenant Restore (Multi-Tenant Deployments)

In multi-tenant mode, each tenant has its own database (`tenant_<slug>`). Backups produce separate dump files per database, so you can restore a single tenant without affecting others.

**This is the preferred approach when a single tenant's data is corrupted or needs rollback while all other tenants remain operational.**

#### ONCE Container

Set the `RESTORE_DB` environment variable to target a single database:

```bash
# Restore only tenant_acme (other tenant databases are untouched)
docker exec -e RESTORE_DB=tenant_acme hisaabo /hooks/post-restore

# Or restore manually:
SOCKETDIR="/storage/run"
dropdb -h "$SOCKETDIR" -U postgres --if-exists tenant_acme
createdb -h "$SOCKETDIR" -U postgres tenant_acme
pg_restore -h "$SOCKETDIR" -U postgres -d tenant_acme --no-owner --no-privileges /storage/backups/tenant_acme.dump
```

#### Docker Compose (backup sidecar)

Use the `restore-db.sh` script included in the backup sidecar:

```bash
# Restore tenant_acme from the most recent backup
docker compose exec backup restore-db.sh tenant_acme

# Restore from a specific backup file
docker compose exec backup restore-db.sh tenant_acme dump_tenant_acme_20260414_030000.sql.gz

# List available backups for a tenant
docker compose exec backup ls -lht /var/backups/hisaabo/dump_tenant_acme_*
```

#### Verification

After restoring a single tenant, verify the other tenants were not affected:

```bash
# Check tenant_acme is restored
docker compose exec postgres psql -U hisaabo -d tenant_acme -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"

# Verify another tenant is untouched (spot-check a known row count)
docker compose exec postgres psql -U hisaabo -d tenant_beta -c \
  "SELECT COUNT(*) FROM invoices"
```

#### Integration Test

Run `scripts/test-backup-restore.sh` to verify per-tenant backup/restore isolation. This test creates multiple databases, backs them up, corrupts one, restores it, and verifies the others remain untouched. **Run this test after any changes to backup/restore scripts.**

```bash
PGHOST=localhost PGUSER=postgres scripts/test-backup-restore.sh
```

---

### Strategy 2: Point-in-Time Recovery (PITR)

Requires WAL archiving to be enabled. The ONCE container enables WAL archiving by default (archives to `/storage/wal_archive/`). For docker-compose, WAL archiving must be configured separately.

Use PITR when you need to restore to a specific moment in time -- for example, "restore to the state just before migration 0009 ran at 14:32 UTC."

```bash
# 1. Find the migration timestamp
#    Check the Drizzle migration tracking table for the exact time the migration was applied:
psql -U postgres -d hisaabo -c \
  "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"
#    The created_at column is a bigint (Unix epoch in milliseconds).
#    Convert to a timestamp for the recovery target:
psql -U postgres -d hisaabo -c \
  "SELECT to_timestamp(created_at / 1000) AS applied_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1"

# 2. Stop PostgreSQL
#    ONCE: stop the container or kill the postgres process
#    docker-compose: docker compose stop postgres

# 3. Create recovery.signal and set recovery target
#    In the PostgreSQL data directory:
touch /storage/pgdata/recovery.signal

# 4. Add recovery settings to postgresql.conf (or a file included by it)
cat >> /storage/pgdata/postgresql.auto.conf <<EOF
restore_command = 'cp /storage/wal_archive/%f %p'
recovery_target_time = '2026-04-14 14:30:00+00'
recovery_target_action = 'pause'
EOF
#    Format: 'YYYY-MM-DD HH:MI:SS+TZ'
#    Set the time to BEFORE the migration ran (subtract a minute from the applied_at time).

# 5. Start PostgreSQL
#    It will replay WAL files up to the target time and pause.

# 6. Verify the state is correct
psql -U postgres -d hisaabo -c \
  "SELECT hash, to_timestamp(created_at / 1000) FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5"

# 7. If satisfied, resume normal operation
psql -U postgres -d hisaabo -c "SELECT pg_wal_replay_resume()"

# 8. Remove the recovery settings you added
#    Edit postgresql.auto.conf and remove the restore_command, recovery_target_time,
#    and recovery_target_action lines. Then restart PostgreSQL.
```

**Important**: After PITR, the WAL timeline changes. You cannot replay forward past the recovery point. Take a fresh backup immediately after completing PITR.

### Strategy 3: Manual Reverse SQL (Last Resort)

Use when backup restore is impractical or when you only need to undo a single small migration (such as an ENUM addition or column add).

**Rules**:
1. ALWAYS take a backup before running manual rollback SQL.
2. Run the SQL in a transaction where possible (`BEGIN; ... COMMIT;`). ENUM type changes cannot run inside transactions.
3. After rollback, delete the migration tracking row so the migration runner does not think it has already been applied.
4. Test the rollback SQL on a copy of the database first if you have time.

---

## 2. PostgreSQL Caveats for Rollbacks

### ENUM values cannot be removed

PostgreSQL has no `ALTER TYPE ... DROP VALUE` statement. To remove a value from an ENUM, you must perform a type-swap:

```sql
-- 1. Verify no rows use the value you want to remove
SELECT COUNT(*) FROM <table> WHERE <column> = '<value_to_remove>';
-- Must return 0. If not, you must update/delete those rows first.

-- 2. Create a replacement type without the unwanted value
CREATE TYPE <type_name>_new AS ENUM('val1', 'val2', ...);
-- List all values EXCEPT the one(s) you want to remove.

-- 3. Update every column that uses the old type
ALTER TABLE <table> ALTER COLUMN <column> TYPE <type_name>_new USING <column>::text::<type_name>_new;
-- Repeat for every table/column that references this type.

-- 4. Drop the old type and rename the new one
DROP TYPE <type_name>;
ALTER TYPE <type_name>_new RENAME TO <type_name>;
```

**ENUM type-swaps cannot run inside a transaction**. If the swap fails partway through, you may have a partially renamed type. This is why verifying zero usage first is critical.

### Foreign key ordering

When dropping tables, you must drop child tables (or their FK constraints) before parent tables. Using `DROP TABLE ... CASCADE` handles FK constraints on the dropped table, but does not drop other tables that depend on it.

### Partial indexes must be dropped explicitly

`DROP TABLE ... CASCADE` removes FK constraints pointing to a table, but indexes on other tables that reference the dropped table's data are a separate concern. If a migration added indexes to existing tables, those indexes must be dropped individually in the rollback.

### After manual rollback, clean up migration tracking

Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`. After a manual rollback, you must delete the tracking row so that the migration runner does not skip the migration on future runs (or so that it does not conflict when the schema no longer matches):

```sql
-- View all tracked migrations
SELECT id, hash, to_timestamp(created_at / 1000) AS applied_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;

-- Delete the specific migration tracking row
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash_from_above>';
```

---

## 3. Per-Migration Reverse SQL

### Migrations 0000-0002: Backup Restore Only

Migrations 0000 (`0000_familiar_boom_boom`), 0001 (`0001_outgoing_marvel_apes`), and 0002 (`0002_pink_talos`) together form the foundational schema: all core ENUM types, all core tables (tenants, users, sessions, businesses, parties, items, invoices, payments, expenses, bank accounts, etc.), dozens of ENUM value additions, and performance indexes (including the `pg_trgm` extension).

Manual rollback of these migrations is not practical. The SQL would effectively `DROP` every table and type in the database, destroying all data. **Use backup restore (Strategy 1) to roll back to a state before these migrations.**

---

### Migration 0003: Recurring Invoices

**File**: `0003_classy_zzzax.sql`
**Description**: Creates 3 ENUM types (`recurring_frequency`, `recurring_run_status`, `recurring_template_status`), 2 tables (`recurring_invoice_templates`, `recurring_invoice_runs`), FK constraints, and 7 indexes.

**WARNING**: All recurring invoice templates and execution history will be permanently lost.

#### Pre-flight checks

```sql
-- Count data that will be lost
SELECT 'templates' AS entity, COUNT(*) AS count FROM recurring_invoice_templates
UNION ALL
SELECT 'runs', COUNT(*) FROM recurring_invoice_runs;
```

#### Rollback SQL

```sql
BEGIN;

-- Drop tables (CASCADE removes FK constraints and dependent indexes)
DROP TABLE IF EXISTS "recurring_invoice_runs" CASCADE;
DROP TABLE IF EXISTS "recurring_invoice_templates" CASCADE;

COMMIT;

-- ENUM drops must be outside the transaction
DROP TYPE IF EXISTS "public"."recurring_template_status";
DROP TYPE IF EXISTS "public"."recurring_run_status";
DROP TYPE IF EXISTS "public"."recurring_frequency";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 6 LIMIT 1
);
-- Or use the exact hash from: SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

#### Post-flight checks

```sql
-- Verify tables are gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('recurring_invoice_templates', 'recurring_invoice_runs');
-- Should return 0 rows

-- Verify types are gone
SELECT typname FROM pg_type
WHERE typname IN ('recurring_frequency', 'recurring_run_status', 'recurring_template_status');
-- Should return 0 rows
```

---

### Migration 0004: Session Tracking + Store Order Index

**File**: `0004_complex_daimon_hellstrom.sql`
**Description**: Adds `last_used_at` column to `sessions` table. Creates an index on `store_orders(invoice_id)`.

**Data loss**: The `last_used_at` timestamps will be lost. No business-critical data is affected.

#### Pre-flight checks

```sql
-- Verify the column and index exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'last_used_at';

SELECT indexname FROM pg_indexes
WHERE indexname = 'store_orders_invoice_idx';
```

#### Rollback SQL

```sql
BEGIN;

DROP INDEX IF EXISTS "store_orders_invoice_idx";
ALTER TABLE "sessions" DROP COLUMN IF EXISTS "last_used_at";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 5 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify column is gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'sessions' AND column_name = 'last_used_at';
-- Should return 0 rows

-- Verify index is gone
SELECT indexname FROM pg_indexes WHERE indexname = 'store_orders_invoice_idx';
-- Should return 0 rows
```

---

### Migration 0005: Payment Gateway Configs

**File**: `0005_amusing_the_professor.sql`
**Description**: Adds ENUM values (`payment_gateway` to `bank_account_type`; `credit_card`, `debit_card`, `net_banking`, `wallet` to `payment_mode`). Creates `payment_gateway_configs` table. Adds `payment_id` to `bank_transactions` and `bank_account_id` to `expenses`.

**WARNING**: Payment gateway configuration data will be lost. ENUM type-swaps required.

#### Pre-flight checks

```sql
-- Check for data that will be lost
SELECT COUNT(*) AS gateway_configs FROM payment_gateway_configs;

-- Check for rows using new ENUM values (must be 0 for type-swap)
SELECT COUNT(*) AS gateway_accounts FROM bank_accounts WHERE account_type = 'payment_gateway';
SELECT COUNT(*) AS cc_payments FROM payments WHERE mode = 'credit_card';
SELECT COUNT(*) AS dc_payments FROM payments WHERE mode = 'debit_card';
SELECT COUNT(*) AS nb_payments FROM payments WHERE mode = 'net_banking';
SELECT COUNT(*) AS wallet_payments FROM payments WHERE mode = 'wallet';
SELECT COUNT(*) AS cc_expenses FROM expenses WHERE mode = 'credit_card';
SELECT COUNT(*) AS dc_expenses FROM expenses WHERE mode = 'debit_card';
SELECT COUNT(*) AS nb_expenses FROM expenses WHERE mode = 'net_banking';
SELECT COUNT(*) AS wallet_expenses FROM expenses WHERE mode = 'wallet';
-- ALL counts must be 0 before proceeding with type-swap.
-- If any are non-zero, update those rows to a valid value first.
```

#### Rollback SQL

```sql
BEGIN;

-- Drop indexes on existing tables
DROP INDEX IF EXISTS "bank_txn_payment_idx";
DROP INDEX IF EXISTS "pg_config_account_idx";
DROP INDEX IF EXISTS "pg_config_business_idx";

-- Drop FK constraint on expenses before dropping column
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_bank_account_id_bank_accounts_id_fk";

-- Drop added columns on existing tables
ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "payment_id";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "bank_account_id";

-- Drop table (CASCADE handles its FK constraints)
DROP TABLE IF EXISTS "payment_gateway_configs" CASCADE;

COMMIT;

-- ENUM type-swaps (must be outside transaction)

-- Type-swap: bank_account_type (remove 'payment_gateway')
CREATE TYPE "public"."bank_account_type_new" AS ENUM('savings', 'current', 'cash', 'upi', 'credit_card');
ALTER TABLE "bank_accounts" ALTER COLUMN "account_type"
  TYPE "public"."bank_account_type_new" USING "account_type"::text::"public"."bank_account_type_new";
DROP TYPE "public"."bank_account_type";
ALTER TYPE "public"."bank_account_type_new" RENAME TO "bank_account_type";

-- Type-swap: payment_mode (remove 'credit_card', 'debit_card', 'net_banking', 'wallet')
CREATE TYPE "public"."payment_mode_new" AS ENUM('cash', 'bank', 'upi', 'cheque', 'other');
ALTER TABLE "payments" ALTER COLUMN "mode"
  TYPE "public"."payment_mode_new" USING "mode"::text::"public"."payment_mode_new";
ALTER TABLE "expenses" ALTER COLUMN "mode"
  TYPE "public"."payment_mode_new" USING "mode"::text::"public"."payment_mode_new";
DROP TYPE "public"."payment_mode";
ALTER TYPE "public"."payment_mode_new" RENAME TO "payment_mode";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 4 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify table is gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'payment_gateway_configs';
-- Should return 0 rows

-- Verify ENUM values
SELECT unnest(enum_range(NULL::bank_account_type));
-- Should show: savings, current, cash, upi, credit_card (no payment_gateway)

SELECT unnest(enum_range(NULL::payment_mode));
-- Should show: cash, bank, upi, cheque, other (no credit_card/debit_card/net_banking/wallet)

-- Verify columns are gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'bank_transactions' AND column_name = 'payment_id';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'expenses' AND column_name = 'bank_account_id';
-- Both should return 0 rows
```

---

### Migration 0006: Accounting, GST, E-Invoice, and Bank Statement Tables

**File**: `0006_medical_zemo.sql`
**Description**: Creates 5 ENUM types, 14 new tables, adds 7 columns to `businesses`, adds 10 columns to `invoices`, and creates approximately 31 indexes (including 3 partial indexes on existing tables: `expenses`, `invoices`, `payments`).

**WARNING**: This is the largest migration. All data in 14 new tables will be permanently lost. Backup restore (Strategy 1) is strongly recommended over manual rollback.

If you must use manual reverse SQL, proceed with extreme caution.

#### Pre-flight checks

```sql
-- Count data across all new tables
SELECT 'bank_categorization_rules' AS tbl, COUNT(*) AS cnt FROM bank_categorization_rules
UNION ALL SELECT 'bank_statement_imports', COUNT(*) FROM bank_statement_imports
UNION ALL SELECT 'bank_statement_lines', COUNT(*) FROM bank_statement_lines
UNION ALL SELECT 'bank_statement_templates', COUNT(*) FROM bank_statement_templates
UNION ALL SELECT 'chart_of_accounts', COUNT(*) FROM chart_of_accounts
UNION ALL SELECT 'e_invoice_configs', COUNT(*) FROM e_invoice_configs
UNION ALL SELECT 'eway_bill_vehicle_updates', COUNT(*) FROM eway_bill_vehicle_updates
UNION ALL SELECT 'eway_bills', COUNT(*) FROM eway_bills
UNION ALL SELECT 'gstr2b_records', COUNT(*) FROM gstr2b_records
UNION ALL SELECT 'gstr2b_uploads', COUNT(*) FROM gstr2b_uploads
UNION ALL SELECT 'itc_ledger_entries', COUNT(*) FROM itc_ledger_entries
UNION ALL SELECT 'itc_utilizations', COUNT(*) FROM itc_utilizations
UNION ALL SELECT 'journal_entries', COUNT(*) FROM journal_entries
UNION ALL SELECT 'journal_entry_lines', COUNT(*) FROM journal_entry_lines
UNION ALL SELECT 'journal_entry_templates', COUNT(*) FROM journal_entry_templates;
-- Review these counts carefully. If any table has significant data, use backup restore instead.
```

#### Rollback SQL

```sql
BEGIN;

-- 1. Drop partial indexes on EXISTING tables first
DROP INDEX IF EXISTS "payments_active_idx";
DROP INDEX IF EXISTS "invoices_active_type_idx";
DROP INDEX IF EXISTS "invoices_active_idx";
DROP INDEX IF EXISTS "invoices_einvoice_status_idx";
DROP INDEX IF EXISTS "expenses_active_idx";

-- 2. Drop columns added to existing tables

-- invoices: 10 columns
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_cancel_reason";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_retry_count";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_error";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "e_invoice_status";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "signed_invoice";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "signed_qr_code";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn_ack_date";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn_ack_number";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "irn";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "is_reverse_charge";

-- businesses: 7 columns
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "annual_turnover";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_purchase_return_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "purchase_return_prefix";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_sales_return_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "sales_return_prefix";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "next_debit_note_number";
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "debit_note_prefix";

-- 3. Drop new tables (order matters: children before parents)
--    journal_entry_lines depends on journal_entries and chart_of_accounts
--    eway_bill_vehicle_updates depends on eway_bills
--    bank_statement_lines depends on bank_statement_imports
--    gstr2b_records depends on gstr2b_uploads
DROP TABLE IF EXISTS "journal_entry_lines" CASCADE;
DROP TABLE IF EXISTS "journal_entry_templates" CASCADE;
DROP TABLE IF EXISTS "journal_entries" CASCADE;
DROP TABLE IF EXISTS "itc_utilizations" CASCADE;
DROP TABLE IF EXISTS "itc_ledger_entries" CASCADE;
DROP TABLE IF EXISTS "gstr2b_records" CASCADE;
DROP TABLE IF EXISTS "gstr2b_uploads" CASCADE;
DROP TABLE IF EXISTS "eway_bill_vehicle_updates" CASCADE;
DROP TABLE IF EXISTS "eway_bills" CASCADE;
DROP TABLE IF EXISTS "e_invoice_configs" CASCADE;
DROP TABLE IF EXISTS "chart_of_accounts" CASCADE;
DROP TABLE IF EXISTS "bank_statement_lines" CASCADE;
DROP TABLE IF EXISTS "bank_statement_imports" CASCADE;
DROP TABLE IF EXISTS "bank_statement_templates" CASCADE;
DROP TABLE IF EXISTS "bank_categorization_rules" CASCADE;

COMMIT;

-- 4. Drop ENUM types (must be outside transaction)
DROP TYPE IF EXISTS "public"."itc_status";
DROP TYPE IF EXISTS "public"."eway_bill_status";
DROP TYPE IF EXISTS "public"."bank_statement_match_status";
DROP TYPE IF EXISTS "public"."bank_statement_import_status";
DROP TYPE IF EXISTS "public"."account_type";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 3 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify all 14 new tables are gone
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'bank_categorization_rules', 'bank_statement_imports', 'bank_statement_lines',
    'bank_statement_templates', 'chart_of_accounts', 'e_invoice_configs',
    'eway_bill_vehicle_updates', 'eway_bills', 'gstr2b_records', 'gstr2b_uploads',
    'itc_ledger_entries', 'itc_utilizations', 'journal_entries',
    'journal_entry_lines', 'journal_entry_templates'
  );
-- Should return 0 rows

-- Verify ENUM types are gone
SELECT typname FROM pg_type
WHERE typname IN ('account_type', 'bank_statement_import_status', 'bank_statement_match_status', 'eway_bill_status', 'itc_status');
-- Should return 0 rows

-- Verify columns removed from invoices
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoices' AND column_name IN ('irn', 'irn_ack_number', 'irn_ack_date', 'signed_qr_code', 'signed_invoice', 'e_invoice_status', 'e_invoice_error', 'e_invoice_retry_count', 'e_invoice_cancel_reason', 'is_reverse_charge');
-- Should return 0 rows

-- Verify columns removed from businesses
SELECT column_name FROM information_schema.columns
WHERE table_name = 'businesses' AND column_name IN ('debit_note_prefix', 'next_debit_note_number', 'sales_return_prefix', 'next_sales_return_number', 'purchase_return_prefix', 'next_purchase_return_number', 'annual_turnover');
-- Should return 0 rows

-- Verify partial indexes on existing tables are gone
SELECT indexname FROM pg_indexes
WHERE indexname IN ('expenses_active_idx', 'invoices_einvoice_status_idx', 'invoices_active_idx', 'invoices_active_type_idx', 'payments_active_idx');
-- Should return 0 rows
```

---

### Migration 0007: Split invoice_items.description into item_name + description

**File**: `0007_strong_mantis.sql`
**Description**: Renames `invoice_items.description` to `item_name`, adds a new `description` column, and migrates `recurring_invoice_templates.line_items` JSONB to rename the `description` key to `itemName`.

**Data loss**: None if reversed correctly. The column rename is reversed, and the JSONB data is transformed back.

#### Pre-flight checks

```sql
-- Verify current column state
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_items' AND column_name IN ('item_name', 'description')
ORDER BY column_name;
-- Should show both 'description' and 'item_name'

-- Check if any invoice_items have data in the new description column
SELECT COUNT(*) FROM invoice_items WHERE description IS NOT NULL;
-- If non-zero, that data will be lost in rollback.

-- Check recurring templates JSONB state
SELECT id, line_items->0 AS sample_item FROM recurring_invoice_templates LIMIT 3;
-- Elements should have 'itemName' key (from the forward migration)
```

#### Rollback SQL

```sql
BEGIN;

-- 1. Reverse the JSONB migration: rename 'itemName' back to 'description', remove the 'description' null key
UPDATE "recurring_invoice_templates"
SET "line_items" = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN elem ? 'itemName' THEN
          (elem - 'itemName' - 'description')
          || jsonb_build_object('description', elem->'itemName')
        ELSE elem
      END
      ORDER BY ord
    )
    FROM jsonb_array_elements("line_items") WITH ORDINALITY AS t(elem, ord)
  ),
  "line_items"
)
WHERE "line_items" IS NOT NULL
  AND jsonb_typeof("line_items") = 'array';

-- 2. Drop the new description column
ALTER TABLE "invoice_items" DROP COLUMN IF EXISTS "description";

-- 3. Rename item_name back to description
ALTER TABLE "invoice_items" RENAME COLUMN "item_name" TO "description";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 2 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify column state
SELECT column_name FROM information_schema.columns
WHERE table_name = 'invoice_items' AND column_name IN ('item_name', 'description');
-- Should show only 'description' (no 'item_name')

-- Verify JSONB state
SELECT id, line_items->0 AS sample_item FROM recurring_invoice_templates LIMIT 3;
-- Elements should have 'description' key (no 'itemName')
```

---

### Migration 0008: Soft-Delete for Items

**File**: `0008_absurd_baron_zemo.sql`
**Description**: Adds `deleted_at` column to `items` and `item_variants` tables. Creates partial indexes (`items_active_idx`, `item_variants_active_idx`) for efficient active-row queries.

**WARNING**: Any items or variants with `deleted_at IS NOT NULL` (soft-deleted) will become visible again after rollback. They were soft-deleted for a reason -- review them before proceeding.

#### Pre-flight checks

```sql
-- Check for soft-deleted items that will become visible again
SELECT COUNT(*) AS soft_deleted_items FROM items WHERE deleted_at IS NOT NULL;
SELECT COUNT(*) AS soft_deleted_variants FROM item_variants WHERE deleted_at IS NOT NULL;
-- If non-zero, these items will reappear in active queries after rollback.
-- Consider whether this is acceptable.
```

#### Rollback SQL

```sql
BEGIN;

-- Drop partial indexes first
DROP INDEX IF EXISTS "items_active_idx";
DROP INDEX IF EXISTS "item_variants_active_idx";

-- Drop columns
ALTER TABLE "items" DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "item_variants" DROP COLUMN IF EXISTS "deleted_at";

COMMIT;

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  OFFSET 1 LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify columns are gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'items' AND column_name = 'deleted_at';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'item_variants' AND column_name = 'deleted_at';
-- Both should return 0 rows

-- Verify indexes are gone
SELECT indexname FROM pg_indexes
WHERE indexname IN ('items_active_idx', 'item_variants_active_idx');
-- Should return 0 rows
```

---

### Migration 0009: ENUM Value 'adjusted' for invoice_status

**File**: `0009_illegal_moira_mactaggert.sql`
**Description**: Adds `'adjusted'` to the `invoice_status` ENUM type.

**Data loss**: None, provided no invoices have `status = 'adjusted'`.

#### Pre-flight checks

```sql
-- CRITICAL: Verify no rows use the value
SELECT COUNT(*) FROM invoices WHERE status = 'adjusted';
-- Must be 0. If non-zero, you must update those rows to a different status first.
-- Example: UPDATE invoices SET status = 'cancelled' WHERE status = 'adjusted';
```

#### Rollback SQL

ENUM type-swap is required. This cannot run inside a transaction.

```sql
-- Type-swap: remove 'adjusted' from invoice_status
-- Full value list after 0002 (unfulfilled added) minus adjusted:
-- draft, unfulfilled, sent, paid, partial, overdue, cancelled
CREATE TYPE "public"."invoice_status_new" AS ENUM(
  'draft', 'unfulfilled', 'sent', 'paid', 'partial', 'overdue', 'cancelled'
);

ALTER TABLE "invoices" ALTER COLUMN "status"
  TYPE "public"."invoice_status_new" USING "status"::text::"public"."invoice_status_new";

DROP TYPE "public"."invoice_status";
ALTER TYPE "public"."invoice_status_new" RENAME TO "invoice_status";

-- Remove migration tracking
DELETE FROM drizzle.__drizzle_migrations
WHERE hash = (
  SELECT hash FROM drizzle.__drizzle_migrations
  ORDER BY created_at DESC
  LIMIT 1
);
```

#### Post-flight checks

```sql
-- Verify ENUM values
SELECT unnest(enum_range(NULL::invoice_status));
-- Should show: draft, unfulfilled, sent, paid, partial, overdue, cancelled
-- Should NOT include 'adjusted'

-- Verify migration tracking
SELECT hash, to_timestamp(created_at / 1000) AS applied_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at DESC
LIMIT 3;
-- The 0009 entry should be gone
```

---

## 4. Rolling Back Multiple Migrations

To roll back multiple migrations, execute the reverse SQL in descending order (newest first). For example, to roll back from 0009 to 0006:

1. Run rollback for 0009
2. Run rollback for 0008
3. Run rollback for 0007

After rolling back, verify that `drizzle.__drizzle_migrations` contains only the rows for migrations you want to keep:

```sql
SELECT id, hash, to_timestamp(created_at / 1000) AS applied_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;
```

Then restart the API. The migration runner acquires an advisory lock (`pg_advisory_lock(72919283)`) and only applies migrations whose hashes are not already tracked, so it will not re-apply the rolled-back migrations unless you redeploy the code that contains them.

---

## 5. After Any Rollback

1. **Take a fresh backup immediately**. The pre-rollback state is gone (or at least, WAL timelines may have changed if you used PITR).
2. **Deploy matching application code**. The API and web app expect the schema to match. If you rolled back a migration, you must also deploy the code version that does not depend on that migration's schema changes.
3. **Run `ANALYZE`** on affected tables so the query planner has accurate statistics:
   ```sql
   ANALYZE;
   ```
4. **Verify the application works end-to-end**. Create an invoice, record a payment, check the dashboard -- exercise the core flows to confirm nothing is broken.

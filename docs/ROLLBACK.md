# Migration Rollback Procedures

Emergency reference for rolling back Drizzle ORM migrations in Hisaabo. Drizzle does not generate down/rollback migrations. This document provides reverse SQL for each migration and instructions for backup-based recovery.

**Last updated**: 2026-11-22
**Applies to**: self-hosted migrations 0000 through 0028 (`packages/db/drizzle`). Multi-tenant deployments use separate control (`drizzle-control`, 0000-0010) and tenant (`drizzle-tenant`, 0000-0013) migration sets; the equivalents for 0014-0028 are listed in section 3.

Downgrading the application from v0.10.1 to v0.10.0, or from v0.10.0 to v0.9.0, needs no reverse SQL; see [Downgrading to v0.10.0](#downgrading-to-v0100) and [Downgrading to v0.9.0](#downgrading-to-v090).

---

## Quick Reference

| Migration | Name | Risk | Data Loss | Recommended Strategy |
|-----------|------|------|-----------|---------------------|
| 0028 | Cache triggers re-installed with `webmcp_disabled` in the `tenants` trigger column list (v0.10.1) | Low | None | Leave in place; if you drop 0027's column, re-create the trigger first (see section 3) |
| 0027 | `tenants.webmcp_disabled` (v0.10.1) | Low | The organization owners' browser-agent switch | Leave in place (older code ignores it) |
| 0026 | `idempotency_keys` table (v0.10.1) | Low | Idempotency keys (they live 15 minutes) | Leave in place (older code ignores it) |
| 0025 | `audit_log.source` (v0.10.1) | Low | The recorded origin (`webmcp` / `mcp`) of audit entries | Leave in place (older code ignores it) |
| 0024 | System accounts 4020, 5020, 5030, 2900 in `chart_of_accounts` (v0.10.1, data only) | Low | None | Leave in place (older code ignores them) |
| 0023 | `recurring_invoice_runs.scheduled_for` and its partial unique index (v0.10.1) | Low | That column's values | Leave in place (older code ignores it) |
| 0022 | Notifications (inbox, outbox, preferences, push devices, push quotas) | Low | Notification inbox and outbox rows, preferences, registered push devices | Leave in place (older code ignores them) |
| 0021 | Job queue controls + operator dashboard tables | Low | Queue controls, operators, ops sessions and audit log | Leave in place (older code ignores them) |
| 0020 | TDS on payment receipts | Low | TDS section configs, party TANs, TDS amounts on payment allocations | Leave in place (see the TDS note in section 3) |
| 0019 | `businesses.store_slug_auto_assigned` flag | Low | That flag | Leave in place |
| 0018 | Cache invalidation NOTIFY triggers | Low | None | Leave in place, or manual reverse SQL |
| 0017 | Global store slug registry | Low | Registry rows (rebuilt by the backfill) | Leave in place |
| 0016 | Index swap on `items` / `bank_*` | Low | None | Leave in place |
| 0015 | Native sign-in, item images, store phone OTP | Low | Item images, pending native sign-ins, OTPs | Leave in place |
| 0014 | Sessions `auth_method`, access tokens | Low | Access tokens | Leave in place |
| 0013 | Business default round-off / terms | Low | Those two settings | Manual reverse SQL |
| 0012 | Business POS flag | Low | POS setting | Manual reverse SQL |
| 0011 | Business logo columns | Low | Uploaded logos | Manual reverse SQL |
| 0010 | `system_config` table | Low | System settings | Manual reverse SQL |
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

The v0.10.1 rows (0023-0028 self-hosted) are the same changes as control 0009-0010 and tenant 0010-0013 on a multi-tenant deployment (the mapping is in section 3). All of them are expand-only: on a rollback to v0.10.0 they are **left in place**, no reverse SQL is needed, and the removal script in section 3 is optional.

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
# (.dump.enc = openssl; legacy .dump.age files: `age -d -o hisaabo.dump hisaabo.dump.age`, prompts for the passphrase)
BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in /storage/backups/hisaabo.dump.enc -out /storage/backups/hisaabo.dump

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

# 3. If encrypted, decrypt first (or skip this and use restore-db.sh, which
#    decrypts, restores into a scratch DB and swaps it in atomically:
#    docker compose exec backup restore-db.sh hisaabo)
docker compose exec backup sh -c \
  'openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_ENCRYPTION_KEY -in /var/backups/hisaabo/dump_hisaabo_20260414_030000.sql.gz.enc -out /var/backups/hisaabo/decrypted.sql.gz'
# Legacy .age backups: age -d -o decrypted.sql.gz <file>.age  (interactive passphrase prompt)

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

In multi-tenant mode, each tenant has its own database (`t_<32 hex>` for tenants created from v0.10.1, `tenant_<slug>` for earlier ones; the name is in `tenants.db_name`). Backups produce separate dump files per database, so you can restore a single tenant without affecting others.

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

A restored database comes back with default privileges (`--no-privileges`, and a freshly created database is connectable by every role). Restart the `api` container, or run `node packages/db/dist/migrate.mjs --restrict-tenant-db-access`, to close it to other tenants' roles again and re-grant its own role; see [Tenant databases and roles](DEPLOYMENT.md#tenant-databases-and-roles-multi-tenant).

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

### Migrations 0010-0013: Small Additive Changes (v0.9.0 and earlier)

All four only add a table or columns, so reverting them is a matter of dropping what they added. Only do this when downgrading below the release that introduced them.

```sql
BEGIN;
-- 0013
ALTER TABLE businesses DROP COLUMN IF EXISTS default_terms_and_conditions;
ALTER TABLE businesses DROP COLUMN IF EXISTS default_round_off;
-- 0012
ALTER TABLE businesses DROP COLUMN IF EXISTS pos_enabled;
-- 0011
ALTER TABLE businesses DROP COLUMN IF EXISTS logo_updated_at;
ALTER TABLE businesses DROP COLUMN IF EXISTS logo_height;
ALTER TABLE businesses DROP COLUMN IF EXISTS logo_width;
ALTER TABLE businesses DROP COLUMN IF EXISTS logo_mime_type;
ALTER TABLE businesses DROP COLUMN IF EXISTS logo_data;
-- 0010
DROP TABLE IF EXISTS system_config;
COMMIT;
```

Then delete the matching rows from `drizzle.__drizzle_migrations` (section 2).

---

### Migrations 0014-0028: Released after v0.9.0

| Self-hosted | Control DB | Tenant DB | Change |
|---|---|---|---|
| 0014 | (already in v0.9.0) | - | `session_auth_method` type, `sessions.auth_method`, `access_tokens` |
| 0015 | 0004 (`native_auth_requests`) | 0004 (`item_images`), 0005 (`store_phone_otps`, store OTP flag) | `native_auth_requests`, `item_images`, `store_phone_otps`, `businesses.store_require_phone_otp` |
| 0016 | - | 0006 | Rebuilds `bsl_import_idx` and `bank_txn_date_idx`, adds `items_active_updated_idx` |
| 0017 | 0005 | - | `store_slugs` registry |
| 0018 | 0006 | - | `hisaabo_cache_notify()` and its triggers |
| 0019 | - | 0007 | `businesses.store_slug_auto_assigned` |
| 0020 | - | 0008 (`tds`) | `tds_section_configs`, `parties.tan`, `payment_allocations.tds_amount` / `tds_section_code` / `tds_rate`, and a system `1600 TDS Receivable` row in `chart_of_accounts` for every business that did not have one |
| 0021 | 0007 (`queue_and_ops`) | - | `ops_role`, `ops_operators`, `ops_sessions`, `ops_audit_log`, `queue_controls` |
| 0022 | 0008 (`notifications`: `notification_preferences`, `push_devices`, `push_quota_usage`, `user_notification_settings`) | 0009 (`notifications`: `notification_inbox`, `notification_outbox`) | The six notification tables (all six in the self-hosted database) |
| 0023 (v0.10.1) | - | 0010 (`recurring_run_occurrence`) | `recurring_invoice_runs.scheduled_for` and the partial unique index `recurring_run_occurrence_uniq` |
| 0024 (v0.10.1) | - | 0011 (`ledger_adjustment_accounts`) | Data only: system accounts `4020 Other Charges`, `5020 Discount Allowed`, `5030 Round Off` and `2900 Suspense / Unreconciled` in `chart_of_accounts` for every business that did not already have the code |
| 0025 (v0.10.1) | - | 0012 (`webmcp_audit_source`) | `audit_log.source` (nullable text: `webmcp`, `mcp` or null) |
| 0026 (v0.10.1) | - | 0013 (`idempotency_keys`) | The `idempotency_keys` table and its two indexes, behind the opt-in `idempotencyKey` input of `invoice.create` and `payment.create` |
| 0027 (v0.10.1) | 0009 (`tenant_webmcp_disabled`) | - | `tenants.webmcp_disabled` (boolean, default false NOT NULL) |
| 0028 (v0.10.1) | 0010 (`webmcp_cache_invalidation_triggers`) | - | Re-installs `hisaabo_cache_notify()` and every cache trigger; the only change is that `hisaabo_cache_tenants` now fires on `UPDATE OF status, plan, webmcp_disabled` instead of `UPDATE OF status, plan` |

The migration step also tries to install the `pgboss` job-queue schema in the control database (self-hosted: the only database). It is not a Drizzle migration and is not tracked in `drizzle.__drizzle_migrations`. If the install fails (for example the role lacks `CREATE` on the database) the step logs `job queue schema NOT installed` and continues; nothing in this release depends on the queue yet.

Everything here is additive (expand-only): no existing column is dropped, retyped or made `NOT NULL` without a default. Older code ignores the new objects, so the recommended "rollback" is to leave them in place and only change the application image. That includes every v0.10.1 migration (0023-0028 self-hosted, control 0009-0010, tenant 0010-0013): **they are all left in place on a rollback to v0.10.0, rolling back needs no reverse SQL, and the removal script below is optional.**

#### Downgrading to v0.10.0

All six v0.10.1 migrations are expand-only and are **left in place**: v0.10.0 does not read the new column, table or accounts, and the re-installed cache triggers (0028) fire on a superset of the old columns, which at worst causes one extra, harmless cache invalidation. There is nothing to reverse and no data to restore. Stop `api` and `worker`, set `HISAABO_API_IMAGE` back to `v0.10.0` (see [Rolling a release back](#6-rolling-back-a-release) for the order of frontends and API), and start it. The migration step of v0.10.0 is a no-op on an upgraded database.

What does not come back, or behaves differently on 0.10.0:

- **Opening balances you reviewed or changed under 0.10.1 flip meaning again.** 0.10.1 reads a party's `opening_balance` as one signed number for everyone (positive = they owe you, negative = you owe them), where 0.10.0 showed a bare "Opening Balance" box and added a supplier's purchases to what you typed (a positive supplier opening balance meant you owe the supplier). If, following the review in [UPGRADING.md](UPGRADING.md#corrected-accounting-and-gst-figures), you flipped the sign of any supplier (or customer) opening balance, or entered one with the mobile app's "To receive" / "To pay" selector, that stored number now means the opposite on 0.10.0, and the supplier's balance and statement start from the other side again. After rolling back, re-run the review query from UPGRADING.md and flip the rows you changed under 0.10.1 back, or accept the 0.10.0 reading deliberately. Supplier balances you never touched are unchanged in the database.
- **Browser-agent (WebMCP) protections and idempotency.** 0.10.0 ignores `tenants.webmcp_disabled`, `audit_log.source` and `idempotency_keys`: an organization's switch is not honoured while you are on 0.10.0, audit entries written meanwhile carry no `source`, and a keyed `invoice.create` or `payment.create` is not de-duplicated (0.10.0 clients never send a key). The stored values are intact and read again on the next upgrade.
- **Ledger adjustment accounts.** 0.10.1's derived ledger posts an invoice's round-off, invoice-level discount and additional charges to 5030, 5020 and 4020 (and a document that does not add up to 2900). 0.10.0 does not post them, so the trial balance and balance sheet can again be out of balance for invoices that use those fields. The accounts stay in the chart of accounts, unused; do not delete them (a later upgrade posts to them again).
- **Recurring invoices.** 0.10.0 has the old scheduler: with more than one API replica it can again generate an occurrence twice. The new column and index are ignored, not violated.

#### Downgrading to v0.9.0

Rehearsed on self-hosted and multi-tenant copies: the v0.9.0 migration step is a no-op on an upgraded database, and v0.9.0 reads and writes it normally.

1. Stop `api` and `worker` (v0.9.0 has no `worker` command).
2. Restore your v0.9.0 `docker-compose.prod.yml`, `nginx/nginx.conf` and `.env.prod`.
3. **ONCE only:** the new image switched PostgreSQL to `scram-sha-256`, and the v0.9.0 image connects without a password. Copy `/storage/pgdata/pg_hba.conf.bak.<timestamp>` back to `/storage/pgdata/pg_hba.conf` before starting v0.9.0.
4. Start the v0.9.0 image.

What does not come back:

- **Store slug losers (multi-tenant).** Ignored by v0.9.0, which resolves slugs per tenant again.
- **TDS on receipts recorded under 0.10.0.** v0.9.0 does not know the `tds_*` columns, so its party ledger, statement and derived ledger count only the net cash of such a receipt, and a ledger can show the withheld TDS as still unsettled. The data is intact; it is read again once you return to 0.10.0 or later. Do not drop the TDS columns to "clean up" after a downgrade, because that erases the record of what was withheld.
- **Notification events.** v0.9.0 has no dispatcher, so events queued in `notification_outbox` stay there until a newer version runs again.

#### Removing the new objects (optional)

Only needed if you want a v0.9.0 schema byte-for-byte, and it deletes data (marked below). Nothing here is needed to run v0.10.0 or v0.10.1: every object is expand-only and rollback leaves it in place. The script below is for a self-hosted database; on a multi-tenant deployment run, in each database, only the statements for objects that the control or tenant migrations in the table above created there. Then remove the matching migration rows from `drizzle.__drizzle_migrations` in each database.

```sql
BEGIN;
-- 0028 / control 0010 (v0.10.1): MUST run before dropping tenants.webmcp_disabled below. The
-- hisaabo_cache_tenants trigger lists that column (UPDATE OF status, plan, webmcp_disabled), and
-- Postgres refuses ALTER TABLE tenants DROP COLUMN webmcp_disabled while a trigger depends on it
-- ("cannot drop column webmcp_disabled of table tenants because other objects depend on it").
-- Re-create the trigger exactly as migration 0018 / control 0006 defined it. The function
-- hisaabo_cache_notify() is unchanged between 0018 and 0028, and the other triggers are identical.
DROP TRIGGER IF EXISTS hisaabo_cache_tenants ON tenants;
CREATE TRIGGER hisaabo_cache_tenants AFTER UPDATE OF status, plan OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION hisaabo_cache_notify('id');
-- 0027 / control 0009 (v0.10.1). Destructive: resets every organization's browser-agent switch.
ALTER TABLE tenants DROP COLUMN IF EXISTS webmcp_disabled;
-- 0026 / tenant 0013 (v0.10.1). Only holds idempotency keys younger than 15 minutes.
DROP TABLE IF EXISTS idempotency_keys;
-- 0025 / tenant 0012 (v0.10.1). Destructive: erases the recorded origin (webmcp / mcp) of audit entries.
ALTER TABLE audit_log DROP COLUMN IF EXISTS source;
-- 0024 / tenant 0011 (v0.10.1, ledger_adjustment_accounts): data only. It added system accounts
-- 4020, 5020, 5030 and 2900 to chart_of_accounts; older code ignores them. Leave them in place:
-- 0.10.1 journals and documents may already post to them, and deleting them breaks nothing but the
-- ledger's fall-back to 5990 / 4100.
-- 0023 / tenant 0010 (v0.10.1; older code ignores both, so this is optional)
DROP INDEX IF EXISTS recurring_run_occurrence_uniq;
ALTER TABLE recurring_invoice_runs DROP COLUMN IF EXISTS scheduled_for;
-- 0022 / control 0008 (preferences, devices, quotas, settings), tenant 0009 (inbox, outbox)
-- Destructive: deletes all notifications, preferences and registered push devices.
DROP TABLE IF EXISTS notification_inbox, notification_outbox, notification_preferences,
  push_devices, push_quota_usage, user_notification_settings;
-- 0021 / control 0007
DROP TABLE IF EXISTS queue_controls, ops_audit_log, ops_sessions, ops_operators;
DROP TYPE IF EXISTS ops_role;
-- 0020 / tenant 0008
-- Destructive: erases the record of TDS withheld on receipts. The 1600 TDS Receivable row
-- in chart_of_accounts is left in place (v0.9.0 reads it like any other account).
DROP TABLE IF EXISTS tds_section_configs;
ALTER TABLE payment_allocations DROP COLUMN IF EXISTS tds_amount;
ALTER TABLE payment_allocations DROP COLUMN IF EXISTS tds_section_code;
ALTER TABLE payment_allocations DROP COLUMN IF EXISTS tds_rate;
ALTER TABLE parties DROP COLUMN IF EXISTS tan;
-- 0019 / tenant 0007
ALTER TABLE businesses DROP COLUMN IF EXISTS store_slug_auto_assigned;
-- 0018 / control 0006
DROP FUNCTION IF EXISTS hisaabo_cache_notify() CASCADE;  -- also drops its triggers
-- 0017 / control 0005
DROP TABLE IF EXISTS store_slugs;
-- 0015 / control 0004, tenant 0004-0005
ALTER TABLE businesses DROP COLUMN IF EXISTS store_require_phone_otp;
DROP TABLE IF EXISTS store_phone_otps, item_images, native_auth_requests;
-- 0014 (self-hosted only; the control DB already had these in v0.9.0)
DROP TABLE IF EXISTS access_tokens;
ALTER TABLE sessions DROP COLUMN IF EXISTS auth_method;
DROP TYPE IF EXISTS session_auth_method;
COMMIT;
-- job queue (not a Drizzle migration; stop all workers first)
DROP SCHEMA IF EXISTS pgboss CASCADE;
```

0016 only swaps indexes and is safe to keep.

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

---

## 6. Rolling Back a Release

This is about application versions, not schema (sections 1 to 5). A release is deployed API first, then the frontends (see the [Release runbook](DEPLOYMENT.md#release-runbook)), so roll it back the other way round: **frontends first, then the API**. The older frontend must be live before the older API, because a newer frontend can call procedures an older API does not have.

1. **Frontends.** Actions → Deploy Web, Deploy Store and Deploy API Docs → Run workflow with the previous release tag (for example `v0.10.0`). Tick **`allow_api_mismatch`**: every production deploy refuses to put a frontend on a version that differs from the production API's (here the API is still on the newer version, which is exactly the downgrade the check guards against), and the override is logged as a warning. Approve the `production` deployment. These manual runs do not wait for the API. Then purge `/store/*` on the CDN.
2. **API.** Set `HISAABO_API_IMAGE` in `.env.prod` back to the previous tag and run `pull api` and `up -d api` (see [Upgrading a pinned install](DEPLOYMENT.md#upgrading-a-pinned-install)). If the newer API already applied migrations, read sections 1 to 5 first: most migrations are expand-only and are left in place, and a restore from a pre-upgrade backup is the safe way back when one is not.
3. **Confirm** with `curl https://api.hisaabo.in/api/version`: it must report the version you rolled back to (an API older than 0.10.1 answers 404).

Do not use the Release workflow to roll back: it would only re-verify the existing images and then wait for, or check, the API again. The older version's images already exist and the deploy workflows rebuild its frontends from the tag, so a rollback is the two steps above and never needs a re-tag.

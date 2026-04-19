/**
 * test-db.ts — Shared database helpers for integration tests.
 *
 * WHY THIS FILE EXISTS:
 * Integration tests need real Drizzle ORM instances pointed at the test
 * database. This file vends:
 *   - getTestClient()     — raw postgres.js client (used by query-counter)
 *   - getControlDb()      — Drizzle + control schema (users, tenants, sessions…)
 *   - getTenantTestDb()   — Drizzle + tenant schema (businesses, invoices…)
 *   - truncateAllTables() — wipe all rows between test suites
 *   - closeTestDb()       — gracefully close connections at afterAll
 *
 * In self-hosted mode (MULTI_TENANT=false), the control and tenant schemas
 * live in the same PostgreSQL database. Both Drizzle instances point at the
 * same URL but carry different schema maps so that query types are correct.
 *
 * IMPORTANT: Import this file only from test helpers or test spec files.
 * env-setup.ts must run first (ensured by vitest setupFiles ordering).
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
// Import schema namespaces via the package barrel. The barrel re-exports all
// named exports from both control-schema and tenant-schema. We need separate
// schema objects for typing the two Drizzle instances, so we pull them via
// named re-exports that the barrel already provides.
import {
  // Pool teardown (see closeTestDb below — required to prevent connection
  // leaks across vitest's per-file module isolation)
  closeControlClient,
  closeAllTenantPools,
  // Control schema tables (used only for typing ControlTestDb)
  users,
  tenants,
  sessions,
  tenantMembers,
  invitations,
  apiKeys,
  magicLinkTokens,
  // Tenant schema tables (used only for typing TenantTestDb)
  businesses,
  parties,
  items,
  itemVariants,
  invoices,
  invoiceItems,
  payments,
  paymentAllocations,
  expenses,
  bankAccounts,
  bankTransactions,
  paymentGatewayConfigs,
  stockAdjustments,
  salesTargets,
  auditLog,
  shipments,
  shipmentEvents,
  storeOrders,
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
  journalEntryTemplates,
  itcLedgerEntries,
  itcUtilizations,
  bankStatementTemplates,
  bankStatementImports,
  bankStatementLines,
  bankCategorizationRules,
  eInvoiceConfigs,
  ewayBills,
  ewayBillVehicleUpdates,
  gstr2bUploads,
  gstr2bRecords,
} from "@hisaabo/db";

// Reconstruct schema objects for Drizzle so each instance has only its tables
const controlSchema = {
  users,
  tenants,
  sessions,
  tenantMembers,
  invitations,
  apiKeys,
  magicLinkTokens,
};

const tenantSchema = {
  businesses,
  parties,
  items,
  itemVariants,
  invoices,
  invoiceItems,
  payments,
  paymentAllocations,
  expenses,
  bankAccounts,
  bankTransactions,
  paymentGatewayConfigs,
  stockAdjustments,
  salesTargets,
  auditLog,
  shipments,
  shipmentEvents,
  storeOrders,
  chartOfAccounts,
  journalEntries,
  journalEntryLines,
  journalEntryTemplates,
  itcLedgerEntries,
  itcUtilizations,
  bankStatementTemplates,
  bankStatementImports,
  bankStatementLines,
  bankCategorizationRules,
  eInvoiceConfigs,
  ewayBills,
  ewayBillVehicleUpdates,
  gstr2bUploads,
  gstr2bRecords,
};

// Re-export the Drizzle type aliases so callers don't need to import drizzle directly.
// These are declared after the schema objects below, but TypeScript hoists type
// declarations so callers can reference them freely.
export type ControlTestDb = ReturnType<typeof drizzle<typeof controlSchema>>;
export type TenantTestDb = ReturnType<typeof drizzle<typeof tenantSchema>>;

// ── Singleton client ───────────────────────────────────────────────────────────
// A single postgres.js client is shared across all helpers in a test run. It is
// lazily created on first use and closed by closeTestDb().

let _client: ReturnType<typeof postgres> | null = null;
let _controlDb: ControlTestDb | null = null;
let _tenantDb: TenantTestDb | null = null;

function getUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Make sure env-setup.ts is listed in vitest setupFiles.",
    );
  }
  return url;
}

/**
 * Returns the shared raw postgres.js client. Used by the query counter to
 * attach the debug callback and by truncateAllTables for raw SQL.
 */
export function getTestClient(): ReturnType<typeof postgres> {
  if (!_client) {
    _client = postgres(getUrl(), {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }
  return _client;
}

/**
 * Returns a Drizzle instance typed with the control schema.
 * Queries against: users, tenants, sessions, tenantMembers, invitations, apiKeys.
 */
export function getControlDb(): ControlTestDb {
  if (!_controlDb) {
    _controlDb = drizzle(getTestClient(), { schema: controlSchema });
  }
  return _controlDb;
}

/**
 * Returns a Drizzle instance typed with the tenant schema.
 * Queries against: businesses, parties, items, invoices, payments, expenses, bankAccounts, etc.
 */
export function getTenantTestDb(): TenantTestDb {
  if (!_tenantDb) {
    _tenantDb = drizzle(getTestClient(), { schema: tenantSchema });
  }
  return _tenantDb;
}

// ── Table truncation ───────────────────────────────────────────────────────────

/**
 * TRUNCATE all tables in dependency-safe (leaf-to-root) order.
 *
 * The CASCADE clause handles FK dependencies automatically, but ordering the
 * statement from leaf tables to root reduces the number of FK graph traversals
 * the DB has to do and gives a clear mental model for readers.
 *
 * Call this in afterAll() of each test suite so suites start clean without
 * paying the cost of a per-test truncate.
 */
export async function truncateAllTables(): Promise<void> {
  const client = getTestClient();

  // Single statement: cascade handles FK order for us. The explicit list
  // is here so we never accidentally miss a new table added to the schema.
  await client`
    TRUNCATE TABLE
      -- Tenant schema (leaf tables first)
      gstr2b_records,
      gstr2b_uploads,
      eway_bill_vehicle_updates,
      eway_bills,
      e_invoice_configs,
      bank_categorization_rules,
      bank_statement_lines,
      bank_statement_imports,
      bank_statement_templates,
      itc_utilizations,
      itc_ledger_entries,
      journal_entry_templates,
      journal_entry_lines,
      journal_entries,
      chart_of_accounts,
      shipment_events,
      shipments,
      store_orders,
      audit_log,
      stock_adjustments,
      sales_targets,
      bank_transactions,
      payment_gateway_configs,
      bank_accounts,
      payment_allocations,
      payments,
      invoice_items,
      item_variants,
      invoices,
      expenses,
      items,
      parties,
      businesses,
      -- Control schema
      api_keys,
      magic_link_tokens,
      invitations,
      tenant_members,
      sessions,
      tenants,
      users
    CASCADE
  `;
}

/**
 * Closes all open postgres.js connections held by this test file.
 *
 * Call in the afterAll() hook of every test file that touches the DB.
 *
 * Closes THREE pools:
 *   1. The test-helper's shared client (getTestClient / _client above).
 *   2. The @hisaabo/db control-plane pool (controlClient in control-client.ts).
 *   3. The @hisaabo/db tenant pools (singleTenantDb + per-tenant in
 *      tenant-pool.ts).
 *
 * (2) and (3) matter because Vitest's per-file module isolation
 * (`isolate: true` is the default and we rely on it for `vi.mock` scoping)
 * re-evaluates @hisaabo/db for EACH test file, so each file gets its own
 * fresh pools. If we only closed (1), the old @hisaabo/db pools from prior
 * files would stay alive in the single worker process (`pool: "forks"` +
 * `singleFork: true`) until `idle_timeout` expired, monotonically growing
 * the total connection count and exhausting the test DB's
 * `max_connections` limit mid-run. That manifested as intermittent
 * `PostgresError: sorry, too many clients already` failures in the tests
 * scheduled late in the suite.
 */
export async function closeTestDb(): Promise<void> {
  const pending: Promise<void>[] = [];

  if (_client) {
    pending.push(_client.end({ timeout: 5 }));
    _client = null;
    _controlDb = null;
    _tenantDb = null;
  }

  // Also close @hisaabo/db's module-level pools. These are re-created per
  // test file by Vitest's module isolation, so they must be closed per file
  // too — otherwise they leak across the run.
  pending.push(closeControlClient());
  pending.push(closeAllTenantPools());

  await Promise.all(pending);
}

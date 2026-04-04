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
 * Closes all open postgres.js connections. Call in the global afterAll hook or
 * at the end of the last test suite to let Vitest exit cleanly.
 */
export async function closeTestDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _controlDb = null;
    _tenantDb = null;
  }
}

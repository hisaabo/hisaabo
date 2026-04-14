/**
 * Programmatic database migration runner.
 *
 * Usage:
 *   pnpm --filter @hisaabo/db migrate          # run migrations
 *   pnpm --filter @hisaabo/db migrate:verify    # check status only (--verify-only)
 *
 * Self-hosted (MULTI_TENANT !== "true"):
 *   Applies drizzle/ (unified) migrations to DATABASE_URL.
 *
 * Cloud (MULTI_TENANT === "true"):
 *   1. Applies drizzle-control/ migrations to CONTROL_DATABASE_URL
 *   2. Discovers all active tenants from the control DB
 *   3. Applies drizzle-tenant/ migrations to each tenant DB
 */

import { config } from "dotenv";
if (process.env.NODE_ENV !== "production") {
  config({ path: "../../.env" });
}

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ── Path resolution ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PKG_ROOT = resolve(__dirname, "..");

const MIGRATIONS_UNIFIED = resolve(DB_PKG_ROOT, "drizzle");
const MIGRATIONS_CONTROL = resolve(DB_PKG_ROOT, "drizzle-control");
const MIGRATIONS_TENANT = resolve(DB_PKG_ROOT, "drizzle-tenant");

// Advisory lock ID — prevents concurrent migration runs during rolling deploys
const ADVISORY_LOCK_ID = 72919283;

// Max tenant migrations to run in parallel
const TENANT_CONCURRENCY = 5;

// ── Logging ──────────────────────────────────────────────────
function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  const entry = { level, msg, ts: new Date().toISOString(), ...data };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ── Types ────────────────────────────────────────────────────
interface MigrationResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

interface TenantMigrationReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  failures: Array<{ tenantId: string; slug: string; error: string }>;
}

// ── Baseline detection ───────────────────────────────────────
//
// Databases set up with `db:push` have the schema but no migration
// tracking. Before running migrations, we detect this state and seed
// the tracking table so drizzle-orm skips already-applied migrations.

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

async function baselineIfNeeded(
  db: ReturnType<typeof drizzle>,
  migrationsFolder: string,
  migrationsTable: string,
  label: string,
): Promise<void> {
  const migrationsSchema = "drizzle";

  // Ensure schema and tracking table exist
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS "${migrationsSchema}"."${migrationsTable}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`),
  );

  // Check if any migrations are already tracked
  const existing = await db.execute(
    sql.raw(`SELECT COUNT(*)::int AS count FROM "${migrationsSchema}"."${migrationsTable}"`),
  );
  const trackedCount = (existing[0] as { count: number }).count;
  if (trackedCount > 0) {
    return; // Already has migration history — nothing to baseline
  }

  // Check if any application tables exist (sign of a db:push setup)
  const tableCheck = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != '__drizzle_migrations'
  `);
  const tableCount = (tableCheck[0] as { count: number }).count;
  if (tableCount === 0) {
    return; // Fresh database — no baselining needed, migrations will run normally
  }

  // Schema exists but no migrations tracked — seed the tracking table
  const journalPath = resolve(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: JournalEntry[] };

  log("warn", `${label}: detected existing schema with no migration history — baselining`, {
    tables: tableCount,
    migrations: journal.entries.length,
  });

  for (const entry of journal.entries) {
    const sqlFile = resolve(migrationsFolder, `${entry.tag}.sql`);
    if (!existsSync(sqlFile)) {
      log("warn", `${label}: skipping missing migration file during baseline: ${entry.tag}`);
      continue;
    }
    const content = readFileSync(sqlFile, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");

    await db.execute(
      sql.raw(
        `INSERT INTO "${migrationsSchema}"."${migrationsTable}" (hash, created_at) VALUES ('${hash}', ${entry.when})`,
      ),
    );
  }

  log("info", `${label}: baselined ${journal.entries.length} migration(s)`);
}

// ── Core migration function ──────────────────────────────────

async function runMigrations(
  databaseUrl: string,
  migrationsFolder: string,
  label: string,
  opts?: { migrationsTable?: string },
): Promise<MigrationResult> {
  const start = Date.now();
  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 15,
    onnotice: () => {},
  });
  const db = drizzle(client);

  try {
    // Acquire advisory lock to prevent concurrent migration runs
    await db.execute(sql`SELECT pg_advisory_lock(${sql.raw(String(ADVISORY_LOCK_ID))})`);

    try {
      // Detect databases set up via db:push (schema exists, no tracking)
      // and seed the tracking table so migrate() skips existing migrations
      const table = opts?.migrationsTable ?? "__drizzle_migrations";
      await baselineIfNeeded(db, migrationsFolder, table, label);

      await migrate(db, {
        migrationsFolder,
        ...(opts?.migrationsTable ? { migrationsTable: opts.migrationsTable } : {}),
      });
    } finally {
      await db.execute(sql`SELECT pg_advisory_unlock(${sql.raw(String(ADVISORY_LOCK_ID))})`);
    }

    const durationMs = Date.now() - start;
    log("info", `${label}: migrations applied successfully`, { durationMs });
    return { success: true, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    log("error", `${label}: migration failed`, { durationMs, error });
    return { success: false, durationMs, error };
  } finally {
    await client.end();
  }
}

// ── Self-hosted mode ─────────────────────────────────────────

async function migrateSelfHosted(): Promise<boolean> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log("error", "DATABASE_URL is not set");
    return false;
  }

  if (!existsSync(resolve(MIGRATIONS_UNIFIED, "meta", "_journal.json"))) {
    log("error", "Unified migration directory not found", { path: MIGRATIONS_UNIFIED });
    return false;
  }

  log("info", "Self-hosted mode: running unified migrations", { target: "DATABASE_URL" });
  const result = await runMigrations(databaseUrl, MIGRATIONS_UNIFIED, "unified");
  return result.success;
}

// ── Multi-tenant mode ────────────────────────────────────────

async function migrateMultiTenant(): Promise<boolean> {
  const controlUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL;
  if (!controlUrl) {
    log("error", "CONTROL_DATABASE_URL or DATABASE_URL is not set");
    return false;
  }

  // Step 1: Migrate control DB
  if (!existsSync(resolve(MIGRATIONS_CONTROL, "meta", "_journal.json"))) {
    log("error", "Control migration directory not found", { path: MIGRATIONS_CONTROL });
    return false;
  }

  log("info", "Multi-tenant mode: running control DB migrations", { target: "CONTROL_DATABASE_URL" });
  const controlResult = await runMigrations(controlUrl, MIGRATIONS_CONTROL, "control", {
    migrationsTable: "__drizzle_control_migrations",
  });
  if (!controlResult.success) {
    log("error", "Control DB migration failed — cannot proceed to tenant migrations");
    return false;
  }

  // Step 2: Migrate all tenant DBs
  if (!existsSync(resolve(MIGRATIONS_TENANT, "meta", "_journal.json"))) {
    log("error", "Tenant migration directory not found", { path: MIGRATIONS_TENANT });
    return false;
  }

  const report = await migrateAllTenants(controlUrl);

  log("info", "Tenant migration summary", {
    total: report.total,
    succeeded: report.succeeded,
    failed: report.failed,
    skipped: report.skipped,
  });

  if (report.failures.length > 0) {
    for (const f of report.failures) {
      log("error", `Tenant migration failed: ${f.slug}`, { tenantId: f.tenantId, error: f.error });
    }
    // Individual tenant failures are non-fatal — other tenants can still be served
    log("warn", `${report.failed} tenant(s) failed migration — they may experience errors`);
  }

  return true; // control DB succeeded, which is what matters for startup
}

async function migrateAllTenants(controlUrl: string): Promise<TenantMigrationReport> {
  const report: TenantMigrationReport = {
    total: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    failures: [],
  };

  // Connect to control DB to discover tenants
  const client = postgres(controlUrl, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 15,
    onnotice: () => {},
  });

  try {
    const rows = await client<{
      id: string;
      slug: string;
      db_name: string | null;
      db_host: string | null;
      db_port: string | null;
      db_user: string | null;
      db_password: string | null;
    }[]>`
      SELECT id, slug, db_name, db_host, db_port, db_user, db_password
      FROM tenants
      WHERE status = 'active'
    `;

    report.total = rows.length;
    log("info", `Found ${rows.length} active tenant(s) to migrate`);

    // Process in batches of TENANT_CONCURRENCY
    for (let i = 0; i < rows.length; i += TENANT_CONCURRENCY) {
      const batch = rows.slice(i, i + TENANT_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (tenant) => {
          if (!tenant.db_name) {
            report.skipped++;
            return;
          }

          const connectionString = await buildTenantConnectionString(tenant);
          const result = await migrateSingleTenantDb(connectionString, tenant.slug);

          if (result.success) {
            report.succeeded++;
          } else {
            report.failed++;
            report.failures.push({
              tenantId: tenant.id,
              slug: tenant.slug,
              error: result.error || "unknown error",
            });
          }
        }),
      );

      // Check for unexpected rejections (bugs, not migration failures)
      for (const r of results) {
        if (r.status === "rejected") {
          report.failed++;
          log("error", "Unexpected error during tenant migration batch", {
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }
    }
  } finally {
    await client.end();
  }

  return report;
}

async function buildTenantConnectionString(tenant: {
  db_host: string | null;
  db_port: string | null;
  db_user: string | null;
  db_password: string | null;
  db_name: string | null;
}): Promise<string> {
  if (!tenant.db_name) {
    throw new Error("Tenant has no db_name configured");
  }
  const host = tenant.db_host || "localhost";
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error(`Invalid tenant DB host: ${host}`);
  }
  const port = tenant.db_port || "5432";
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid tenant DB port: ${port}`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(tenant.db_name)) {
    throw new Error(`Invalid tenant DB name: ${tenant.db_name}`);
  }

  const user = encodeURIComponent(tenant.db_user || "hisaabo");

  // Decrypt password — lazy import to avoid loading crypto module if not needed
  const { decryptDbPassword } = await import("./crypto.js");
  const rawPassword = decryptDbPassword(tenant.db_password || "");
  const password = encodeURIComponent(rawPassword);

  return `postgresql://${user}:${password}@${host}:${portNum}/${tenant.db_name}`;
}

// ── Exported for use by provision-tenant.ts ──────────────────

export async function migrateSingleTenantDb(
  connectionString: string,
  label: string,
): Promise<MigrationResult> {
  return runMigrations(connectionString, MIGRATIONS_TENANT, `tenant:${label}`, {
    migrationsTable: "__drizzle_tenant_migrations",
  });
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  const mode = isMultiTenant ? "multi-tenant" : "self-hosted";

  log("info", `Hisaabo migration runner starting`, { mode });

  const success = isMultiTenant ? await migrateMultiTenant() : await migrateSelfHosted();

  if (!success) {
    log("error", "Migration failed — refusing to continue");
    process.exit(1);
  }

  log("info", "All migrations completed successfully");
}

main().catch((err) => {
  log("error", "Unhandled migration error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});

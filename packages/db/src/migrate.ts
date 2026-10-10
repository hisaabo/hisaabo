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
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ── Path resolution ──────────────────────────────────────────
//
// migrate.ts is consumed in several layouts — we must find the migration SQL
// folders in each one:
//   1. Dev (tsx): __dirname = packages/db/src            → ../drizzle-*
//   2. migrate-cli bundle: __dirname = packages/db/dist  → ../drizzle-*
//   3. API bundle (tsup noExternal inlines @hisaabo/db): __dirname =
//      packages/api/dist → must hop over to packages/db/drizzle-*
//
// Case 3 is the one that broke tenant provisioning at runtime: the control-DB
// migration at startup uses case 2 (standalone migrate.mjs) and worked, but
// provisionTenantDatabase() calls migrateSingleTenantDb() from the inlined API
// bundle, which resolved drizzle-tenant/ under packages/api/ (nonexistent).
//
// Resolution order: HISAABO_MIGRATIONS_DIR override → sibling of __dirname →
// monorepo cwd layout → error at call time with a clear message.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PKG_ROOT = resolve(__dirname, "..");

/**
 * Build the ordered candidate list for a migration subdir. Pure + injectable
 * so unit tests can verify ordering + fallback behavior without mutating
 * process state.
 */
export function buildMigrationsDirCandidates(
  subdir: string,
  opts: { dbPkgRoot: string; currentDir: string; cwd: string; override?: string | null },
): string[] {
  return [
    ...(opts.override ? [resolve(opts.override, subdir)] : []),
    resolve(opts.dbPkgRoot, subdir),                              // cases 1 & 2 (dev, migrate-cli bundle)
    resolve(opts.currentDir, "..", "..", "db", subdir),           // case 3: api/dist → db/
    resolve(opts.cwd, "packages/db", subdir),                     // monorepo cwd fallback
  ];
}

/**
 * Given an ordered candidate list, return the first one whose
 * meta/_journal.json exists (via the injected probe). If none exist, return
 * the first candidate so the eventual drizzle error message points at the
 * expected location.
 *
 * The `probe` parameter lets unit tests substitute a fake filesystem without
 * having to mkdir a real fixture tree for every layout.
 */
export function pickExistingMigrationsDir(
  candidates: string[],
  probe: (path: string) => boolean = existsSync,
): string {
  for (const p of candidates) {
    if (probe(resolve(p, "meta", "_journal.json"))) return p;
  }
  return candidates[0];
}

function resolveMigrationsDir(subdir: string): string {
  const candidates = buildMigrationsDirCandidates(subdir, {
    dbPkgRoot: DB_PKG_ROOT,
    currentDir: __dirname,
    cwd: process.cwd(),
    override: process.env.HISAABO_MIGRATIONS_DIR,
  });
  return pickExistingMigrationsDir(candidates);
}

const MIGRATIONS_UNIFIED = resolveMigrationsDir("drizzle");
const MIGRATIONS_CONTROL = resolveMigrationsDir("drizzle-control");
const MIGRATIONS_TENANT = resolveMigrationsDir("drizzle-tenant");

// Advisory lock ID — prevents concurrent migration runs during rolling deploys
const ADVISORY_LOCK_ID = 72919283;

// Max tenant migrations to run in parallel
const TENANT_CONCURRENCY = 5;

// ── Lock timeout ─────────────────────────────────────────────
//
// DDL needs ACCESS EXCLUSIVE (or similar) locks. Without a lock_timeout, a
// migration waiting behind one long-running transaction makes every later
// query on that table queue behind the migration — a full outage for that
// table. With it, the migration gives up quickly and is retried with backoff
// instead, so live traffic is never stuck behind it.
//
// drizzle applies all pending migrations in one transaction, so a timed-out
// attempt rolls back cleanly and the retry starts from the same state.
//
//   MIGRATION_LOCK_TIMEOUT  Postgres duration, e.g. "5s", "500ms" (default 5s; "0" disables)
//   MIGRATION_LOCK_RETRIES  retries after the first attempt (default 5)

const DEFAULT_LOCK_TIMEOUT = "5s";
const DEFAULT_LOCK_RETRIES = 5;
const LOCK_NOT_AVAILABLE = "55P03";

function lockTimeoutSetting(): string {
  const raw = (process.env.MIGRATION_LOCK_TIMEOUT ?? DEFAULT_LOCK_TIMEOUT).trim();
  // Interpolated into SET, so only accept a plain duration.
  if (/^\d+(ms|s|min)?$/.test(raw)) return raw;
  log("warn", `Invalid MIGRATION_LOCK_TIMEOUT "${raw}" — using ${DEFAULT_LOCK_TIMEOUT}`);
  return DEFAULT_LOCK_TIMEOUT;
}

function lockRetries(): number {
  const raw = process.env.MIGRATION_LOCK_RETRIES;
  if (raw === undefined) return DEFAULT_LOCK_RETRIES;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0) return n;
  log("warn", `Invalid MIGRATION_LOCK_RETRIES "${raw}" — using ${DEFAULT_LOCK_RETRIES}`);
  return DEFAULT_LOCK_RETRIES;
}

/** True if err (or anything in its cause chain) is Postgres lock_not_available. */
export function isLockTimeout(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 5; depth++) {
    if ((cur as { code?: string }).code === LOCK_NOT_AVAILABLE) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs fn, retrying with exponential backoff (1s, 2s, 4s … capped at 30s,
 * plus jitter) when it fails because a lock could not be acquired within
 * lock_timeout. Any other error is rethrown immediately.
 */
export async function withLockRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = lockRetries(),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isLockTimeout(err)) throw err;
      if (attempt >= retries) {
        log("error", `${label}: could not acquire a lock after ${attempt + 1} attempt(s) — a long-running transaction is likely holding it (check pg_stat_activity)`);
        throw err;
      }
      const delayMs = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      log("warn", `${label}: lock timeout — retrying`, { attempt: attempt + 1, retries, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

// ── Logging ──────────────────────────────────────────────────
export function log(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
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

// ── Lenient migration for db:push databases ─────────────────
//
// Databases set up with `db:push` have tables but no migration tracking.
// drizzle-orm's migrate() runs all pending migrations in one transaction,
// so if migration 0000 (CREATE TYPE) fails because it exists, later
// migrations (ALTER TABLE ADD COLUMN) never run.
//
// This function detects that case and runs each migration individually,
// tolerating "already exists" errors (PG codes 42710, 42P07, 42701)
// while actually applying ALTER statements that are genuinely missing.

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

// PostgreSQL error codes for "object already exists" — safe to skip
const ALREADY_EXISTS_CODES = new Set([
  "42710", // duplicate_object (types, enums)
  "42P07", // duplicate_table
  "42701", // duplicate_column
]);

/**
 * Checks whether this database needs lenient migration mode.
 * Returns true if tables exist but no migrations are tracked.
 */
async function needsLenientMode(
  client: ReturnType<typeof postgres>,
  migrationsTable: string,
): Promise<boolean> {
  // Ensure tracking infrastructure exists
  await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
  await client.unsafe(
    `CREATE TABLE IF NOT EXISTS "drizzle"."${migrationsTable}" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );

  const [{ count: trackedCount }] = await client<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM "drizzle".${client.unsafe(`"${migrationsTable}"`)}
  `;
  if (trackedCount > 0) return false;

  const [{ count: tableCount }] = await client<[{ count: number }]>`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `;
  return tableCount > 0;
}

/**
 * Runs each migration individually, tolerating "already exists" errors.
 * Each statement within a migration is executed separately. Statements
 * that fail with already-exists codes are skipped; any other error aborts.
 * Successfully processed migrations are recorded in the tracking table.
 */
async function runLenientMigrations(
  client: ReturnType<typeof postgres>,
  migrationsFolder: string,
  migrationsTable: string,
  label: string,
): Promise<{ applied: number; skippedStatements: number }> {
  const journalPath = resolve(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: JournalEntry[] };

  let applied = 0;
  let skippedStatements = 0;

  for (const entry of journal.entries) {
    const sqlFile = resolve(migrationsFolder, `${entry.tag}.sql`);
    if (!existsSync(sqlFile)) continue;

    const content = readFileSync(sqlFile, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex");
    const statements = content.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

    for (const stmt of statements) {
      try {
        // Statements run outside a transaction here, so retry each one on its own.
        await withLockRetry(`${label}: ${entry.tag}`, () => client.unsafe(stmt));
      } catch (err: unknown) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode && ALREADY_EXISTS_CODES.has(pgCode)) {
          skippedStatements++;
        } else {
          // Real error — abort
          throw new Error(
            `${label}: migration ${entry.tag} failed on statement: ${(err as Error).message}\nSQL: ${stmt.slice(0, 200)}`,
            { cause: err },
          );
        }
      }
    }

    // Track this migration as applied
    await client.unsafe(
      `INSERT INTO "drizzle"."${migrationsTable}" (hash, created_at) VALUES ('${hash}', ${entry.when})`,
    );
    applied++;
  }

  return { applied, skippedStatements };
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
    await client.unsafe(`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`);

    try {
      // Set only after the advisory lock is held: lock_timeout also applies to
      // advisory locks, and a second replica must keep waiting for the first
      // one's migrations rather than time out.
      const lockTimeout = lockTimeoutSetting();
      await client.unsafe(`SET lock_timeout = '${lockTimeout}'`);

      const table = opts?.migrationsTable ?? "__drizzle_migrations";
      const lenient = await needsLenientMode(client, table);

      if (lenient) {
        // Database was set up with db:push — run each migration individually,
        // tolerating "already exists" errors while applying genuinely missing changes.
        log("warn", `${label}: existing schema with no migration tracking — running in lenient mode`);
        const { applied, skippedStatements } = await runLenientMigrations(
          client, migrationsFolder, table, label,
        );
        log("info", `${label}: lenient mode complete`, { applied, skippedStatements });
      } else {
        // Normal path: drizzle-orm handles tracking and only applies pending migrations
        await withLockRetry(label, () =>
          migrate(db, {
            migrationsFolder,
            ...(opts?.migrationsTable ? { migrationsTable: opts.migrationsTable } : {}),
          }),
        );
      }
    } finally {
      await client.unsafe(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`);
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

/**
 * Build the connection string the migrator should use to talk to a tenant DB.
 *
 * IMPORTANT: tenant schema migrations run as the **superuser** (the admin
 * credentials embedded in CONTROL_DATABASE_URL / DATABASE_URL), not as the
 * per-tenant application user.
 *
 * Why: drizzle auto-creates its metadata in a dedicated `drizzle` schema on
 * first migrate. That schema is owned by whoever ran the initial migration —
 * which is the superuser (see provisionTenantDatabase Step 3). The per-tenant
 * user was never granted USAGE on `drizzle`, so if migrations ran as that
 * user they would fail with "permission denied for schema drizzle" on every
 * subsequent schema change.
 *
 * The runtime tenant connection (tenant-pool.ts) continues to use the
 * per-tenant user so application queries stay least-privileged. This
 * function is migration-specific.
 */
async function buildTenantConnectionString(tenant: {
  db_host: string | null;
  db_port: string | null;
  db_user: string | null;       // retained in signature for logging/compat
  db_password: string | null;   // (not used for migration connections — see above)
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

  // Pull admin creds from the control URL. CONTROL_DATABASE_URL takes
  // precedence; otherwise fall back to DATABASE_URL (self-hosted) so
  // self-provisioned dev clusters also work without extra env vars.
  const adminUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL;
  if (!adminUrl) {
    throw new Error("CONTROL_DATABASE_URL / DATABASE_URL required for tenant migrations");
  }
  const parsed = new URL(adminUrl);
  // Re-emit username/password in already-URL-encoded form (URL.username keeps
  // them encoded on read). Re-validating the tenant host/port against the
  // control host is not required because operators may host tenants on
  // different nodes than the control DB.

  return `postgresql://${parsed.username}:${parsed.password}@${host}:${portNum}/${tenant.db_name}`;
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

/**
 * Startup sanity check: verify that the migration SQL directories this
 * process will need at runtime are actually present on disk.
 *
 * Called from `packages/api/src/server.ts` before the HTTP listener starts,
 * so deployments with a broken bundle layout (e.g. missing copy in
 * Dockerfile) fail fast at boot instead of at the first user signup.
 *
 * Returns an array of missing-dir descriptions; empty means all good.
 */
export function assertMigrationsPresent(): string[] {
  const missing: string[] = [];
  const isMultiTenant = process.env.MULTI_TENANT === "true";

  if (isMultiTenant) {
    if (!existsSync(resolve(MIGRATIONS_CONTROL, "meta", "_journal.json"))) {
      missing.push(`control migrations not found at ${MIGRATIONS_CONTROL}`);
    }
    if (!existsSync(resolve(MIGRATIONS_TENANT, "meta", "_journal.json"))) {
      missing.push(`tenant migrations not found at ${MIGRATIONS_TENANT}`);
    }
  } else {
    if (!existsSync(resolve(MIGRATIONS_UNIFIED, "meta", "_journal.json"))) {
      missing.push(`unified migrations not found at ${MIGRATIONS_UNIFIED}`);
    }
  }

  return missing;
}

// ── Main ─────────────────────────────────────────────────────
//
// NOTE: main() is exported for use by the CLI entry point (migrate-cli.ts).
// It is intentionally NOT invoked at module load. Importing this file for its
// function exports (e.g. migrateSingleTenantDb from provision-tenant.ts) must
// not trigger migrations — previously a top-level main() call here caused the
// API server to attempt migrations and crash on startup when tsup bundled
// @hisaabo/db into packages/api/dist/ (wrong path resolution + process.exit).

export async function main() {
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

import { config } from "dotenv";
// Only load .env in development — in production (Docker), env vars are injected
// by the container runtime. The relative path resolves from cwd, not this file.
if (process.env.NODE_ENV !== "production") {
  config({ path: "../../.env" });
}

import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { migrateSingleTenantDb } from "./migrate.js";

// ── Helpers ────────────────────────────────────────────────────

/**
 * Sanitize an identifier so it is safe to embed in a double-quoted SQL identifier.
 * Allows only [a-z0-9_] — rejects anything else to prevent injection.
 */
function sanitizeIdentifier(value: string): string {
  const clean = value.replace(/[^a-z0-9_]/g, "_");
  if (!clean || clean.length > 63) {
    throw new Error(`Invalid SQL identifier after sanitization: "${clean}"`);
  }
  return clean;
}

/**
 * Parse the host, port, and connection components from a PostgreSQL URL.
 * Falls back to localhost:5432 and the last path segment as the database name.
 */
function parseConnectionUrl(url: string): {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  baseUrl: string; // without the database name part
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || "localhost",
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    // Base URL suitable for connecting to a different database on the same server
    baseUrl: `postgresql://${parsed.username}:${parsed.password}@${parsed.hostname}:${parsed.port || "5432"}`,
  };
}

// ── Main export ────────────────────────────────────────────────

export interface TenantDbConfig {
  dbName: string;
  dbHost: string;
  dbPort: string;
  dbUser: string;
  dbPassword: string;
}

/**
 * Best-effort cleanup for a tenant's physical database and role.
 *
 * Used as a compensator when the outer control-DB transaction fails AFTER
 * `provisionTenantDatabase` has already created the physical DB/USER. Since
 * CREATE DATABASE / CREATE USER are non-transactional, we must drop them
 * manually on outer-tx failure — otherwise the cluster accumulates orphan
 * `tenant_*` databases + roles forever.
 *
 * Idempotent: uses IF EXISTS, terminates live connections before DROP, and
 * swallows any individual failure (we do not want to mask the caller's
 * original error with a cleanup error). Callers should log any thrown error
 * separately; this function itself never throws.
 *
 * Both identifiers MUST have already been sanitized by the caller (i.e. they
 * came from a round-trip through this module's own provisioning). We still
 * re-validate with a character-class check as defence-in-depth against a
 * future caller passing attacker-controlled input.
 */
export async function cleanupTenantDatabase(dbName: string, dbUser: string): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(dbName) || !/^[a-z0-9_]+$/.test(dbUser)) {
    // Refuse to run DROP statements with an unsanitized identifier — no-op.
    return;
  }
  const controlUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL;
  if (!controlUrl) return;

  const { baseUrl } = parseConnectionUrl(controlUrl);
  const cleanupClient = postgres(`${baseUrl}/postgres`, {
    max: 1,
    idle_timeout: 0,
    connect_timeout: 15,
    onnotice: () => {},
  });

  try {
    // Terminate lingering sessions so DROP DATABASE doesn't block.
    // The datname literal is quoted here because pg_terminate_backend takes
    // datname as text (not an identifier); sanitization above guarantees
    // no quote injection is possible.
    await cleanupClient.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    ).catch(() => {});
    await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
    await cleanupClient.unsafe(`DROP USER IF EXISTS "${dbUser}"`).catch(() => {});
  } finally {
    await cleanupClient.end().catch(() => {});
  }
}

/**
 * Provisions a new PostgreSQL database for a tenant:
 *   1. Creates the database
 *   2. Creates a dedicated PG user with a random password
 *   3. Grants the user full access
 *   4. Applies the tenant schema via programmatic migrations
 *
 * Only call this when MULTI_TENANT=true.
 */
export async function provisionTenantDatabase(
  tenantId: string,
  tenantSlug: string,
): Promise<TenantDbConfig> {
  const controlUrl = process.env.CONTROL_DATABASE_URL || process.env.DATABASE_URL;
  if (!controlUrl) {
    throw new Error("CONTROL_DATABASE_URL or DATABASE_URL is required for tenant provisioning");
  }

  const { host, port, baseUrl } = parseConnectionUrl(controlUrl);

  // Sanitize names for safe use in double-quoted SQL identifiers
  const rawSlug = tenantSlug.toLowerCase();
  const safeSuffix = sanitizeIdentifier(rawSlug.replace(/[^a-z0-9_]/g, "_").slice(0, 40));
  const dbName = sanitizeIdentifier(`tenant_${safeSuffix}`);
  const dbUser = sanitizeIdentifier(`tenant_${safeSuffix}_user`);
  const dbPassword = randomBytes(32).toString("base64url");

  // Single try/catch wraps ALL side-effecting steps (CREATE DATABASE, CREATE
  // USER, GRANT, schema grants, migrations). Any failure triggers
  // cleanupTenantDatabase() so we never leave a half-provisioned pair behind.
  //
  // Previously there were two try blocks and only the second had cleanup — a
  // failure between CREATE DATABASE and CREATE USER (or during the cluster
  // GRANT) would orphan resources. This unified form closes that gap.
  try {
    // ── Step 1: Create DB and user via the control (superuser) connection ──
    // Connect to `postgres` maintenance database to run CREATE DATABASE.
    // postgres.js does not support `CREATE DATABASE` inside transactions, so we
    // use max:1 and no idle_timeout to get a clean single-use connection.
    const adminClient = postgres(`${baseUrl}/postgres`, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      onnotice: () => {}, // suppress notices
    });

    try {
      // Create the database (identifier is sanitized above — safe to interpolate)
      await adminClient.unsafe(`CREATE DATABASE "${dbName}"`);

      // Create the dedicated user with a securely-generated password.
      // base64url output is [A-Za-z0-9_-] only — assert this before interpolating.
      if (!/^[A-Za-z0-9_-]+$/.test(dbPassword)) {
        throw new Error("Generated password contains unexpected characters — refusing to interpolate into SQL");
      }
      await adminClient.unsafe(
        `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword}'`,
      );

      // Grant all privileges on the database to the dedicated user
      await adminClient.unsafe(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
    } finally {
      await adminClient.end();
    }

    // ── Step 2: Connect to the new DB as superuser and grant schema privileges ──
    const newDbAdminClient = postgres(`${baseUrl}/${dbName}`, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      onnotice: () => {},
    });

    try {
      await newDbAdminClient.unsafe(`GRANT ALL ON SCHEMA public TO "${dbUser}"`);
      await newDbAdminClient.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${dbUser}"`);
      await newDbAdminClient.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${dbUser}"`);
    } finally {
      await newDbAdminClient.end();
    }

    // ── Step 3: Apply tenant schema via programmatic migrations ────
    // Uses drizzle-orm's migrate() directly — no npx subprocess needed.
    // The superuser connection is used so migrations can create extensions/types.
    const tenantUrl = `${baseUrl}/${dbName}`;

    const result = await migrateSingleTenantDb(tenantUrl, dbName);
    if (!result.success) {
      throw new Error(`Tenant schema migration failed: ${result.error}`);
    }

    // ── Step 4: Grant the per-tenant user access to drizzle metadata ──
    //
    // The drizzle migrator auto-created the `drizzle` schema during Step 3
    // while connected as the superuser. That schema is owned by the
    // superuser and nothing has granted it to the per-tenant user, so if
    // anything connecting as the per-tenant user ever tries to introspect
    // migration state it would hit "permission denied for schema drizzle".
    //
    // Tenant migrations themselves now always run as the superuser (see
    // migrate.ts::buildTenantConnectionString), but the grants here are
    // defence-in-depth so the per-tenant user can still read its own
    // migration history if an operator or admin tool asks for it.
    const grantClient = postgres(`${baseUrl}/${dbName}`, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      onnotice: () => {},
    });
    try {
      await grantClient.unsafe(`GRANT USAGE ON SCHEMA drizzle TO "${dbUser}"`);
      await grantClient.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO "${dbUser}"`);
      await grantClient.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT ON TABLES TO "${dbUser}"`);
    } finally {
      await grantClient.end();
    }
  } catch (err) {
    // Compensate: drop whatever was created (idempotent, best-effort).
    await cleanupTenantDatabase(dbName, dbUser);
    throw err;
  }

  // Encrypt the password before returning — stored encrypted in the tenants table
  const { encryptDbPassword } = await import("./crypto.js");

  return {
    dbName,
    dbHost: host,
    dbPort: port,
    dbUser,
    dbPassword: encryptDbPassword(dbPassword),
  };
}

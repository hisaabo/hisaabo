import { config } from "dotenv";
// Only load .env in development — in production (Docker), env vars are injected
// by the container runtime. The relative path resolves from cwd, not this file.
if (process.env.NODE_ENV !== "production") {
  config({ path: "../../.env" });
}

import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const execFileAsync = promisify(execFile);

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
 * Provisions a new PostgreSQL database for a tenant:
 *   1. Creates the database
 *   2. Creates a dedicated PG user with a random password
 *   3. Grants the user full access
 *   4. Runs the tenant schema via `drizzle-kit push`
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

  // ── Step 1 & 2: Create DB and user via the control (superuser) connection ──
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
    // CREATE DATABASE cannot run inside a transaction block — postgres.js sends
    // each query in its own implicit transaction by default when using tagged
    // template literals directly (not inside a tx() callback), so this is safe.

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

    // Also grant schema usage so the user can create/access tables
    // This must be done after connecting to the new database (step 3), but we
    // pre-grant here so drizzle-kit push (which connects as superuser) can run.
  } finally {
    await adminClient.end();
  }

  // Steps 3 & 4 are wrapped in a try/catch so we can clean up the DB and user
  // created in steps 1 & 2 if anything goes wrong (prevents orphaned resources).
  try {
    // ── Step 3: Connect to the new DB as superuser and grant schema privileges ──
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

    // ── Step 4: Push the tenant schema using drizzle-kit push ─────
    // drizzle-tenant.config.ts uses DATABASE_URL as its connection target.
    // We override it for this subprocess so it targets the new tenant DB.
    // The superuser connection is used so drizzle-kit can create extensions/types.
    const tenantUrl = `${baseUrl}/${dbName}`;

    // Resolve the db package root via package resolution.
    // When tsup bundles this into the API dist, import.meta.url points to the
    // wrong directory. createRequire + resolve works regardless of bundling.
    const _require = createRequire(import.meta.url);
    const dbPackageRoot = dirname(_require.resolve("@hisaabo/db/package.json"));

    const configPath = resolve(dbPackageRoot, "drizzle-tenant.config.ts");

    await execFileAsync(
      "npx",
      ["drizzle-kit", "push", "--config", configPath, "--force"],
      {
        env: {
          ...process.env,
          DATABASE_URL: tenantUrl,
        },
        cwd: dbPackageRoot,
        timeout: 60_000,
      },
    );
  } catch (err) {
    // ── Rollback: drop the orphaned DB and user ──────────────────
    const cleanupClient = postgres(`${baseUrl}/postgres`, {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 15,
      onnotice: () => {},
    });
    try {
      // Terminate any lingering connections to the tenant DB before dropping
      await cleanupClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
      );
      await cleanupClient.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      await cleanupClient.unsafe(`DROP USER IF EXISTS "${dbUser}"`);
    } catch {
      // Best-effort cleanup — log but don't mask the original error
    } finally {
      await cleanupClient.end();
    }
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

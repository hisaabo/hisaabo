import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as tenantSchema from "./tenant-schema.js";
import { controlDb } from "./control-client.js";
import { tenants } from "./control-schema.js";
import { eq } from "drizzle-orm";

export type TenantDatabase = ReturnType<typeof drizzle<typeof tenantSchema>>;

// ── FINDING 6: Connection string component validators ──────────
function sanitizeDbComponent(value: string): string {
  return encodeURIComponent(value);
}

function validateDbHost(host: string): string {
  // Only allow alphanumeric, dots, hyphens (valid hostnames)
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error(`Invalid database host: ${host}`);
  }
  return host;
}

function validateDbPort(port: string): string {
  const num = parseInt(port, 10);
  if (isNaN(num) || num < 1 || num > 65535) {
    throw new Error(`Invalid database port: ${port}`);
  }
  return String(num);
}

function validateDbName(name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid database name: ${name}`);
  }
  return name;
}

// ── FINDING 19: Store raw client alongside drizzle for cleanup ─
interface PoolEntry {
  db: TenantDatabase;
  client: ReturnType<typeof postgres>; // raw client for cleanup
  lastUsed: number;
}

function createTenantDb(connectionString: string): { db: TenantDatabase; client: ReturnType<typeof postgres> } {
  const client = postgres(connectionString, {
    max: parseInt(process.env.TENANT_POOL_PER_DB_MAX || "5", 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema: tenantSchema });
  return { db, client };
}

const isMultiTenant = process.env.MULTI_TENANT === "true";

// Self-hosted: single tenant DB is the same as the main DB
const singleTenantUrl = process.env.DATABASE_URL!;
let singleTenantDb: TenantDatabase | null = null;
let singleTenantClient: ReturnType<typeof postgres> | null = null;

function getSingleTenantDb(): TenantDatabase {
  if (!singleTenantDb) {
    const { db, client } = createTenantDb(singleTenantUrl);
    singleTenantDb = db;
    singleTenantClient = client;
  }
  return singleTenantDb;
}

const tenantPools = new Map<string, PoolEntry>();
const MAX_POOLS = parseInt(process.env.TENANT_POOL_MAX || "50", 10);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Evict idle pools periodically (FINDING 19: close connection on eviction).
// .unref() so the timer does not keep the process alive on exit — critical
// for test runs where we want Node to exit cleanly after all files finish.
const evictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of tenantPools) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      entry.client.end();
      tenantPools.delete(id);
    }
  }
}, 60_000);
evictionTimer.unref();

async function resolveConnectionString(tenantId: string): Promise<string> {
  const [tenant] = await controlDb
    .select({
      dbName: tenants.dbName,
      dbHost: tenants.dbHost,
      dbPort: tenants.dbPort,
      dbUser: tenants.dbUser,
      dbPassword: tenants.dbPassword,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant || !tenant.dbName) {
    throw new Error(`Tenant ${tenantId} not found or has no DB config`);
  }

  // FINDING 6: Validate/sanitize all connection string components to prevent injection
  const host = validateDbHost(tenant.dbHost || "localhost");
  const port = validateDbPort(tenant.dbPort || "5432");
  const user = sanitizeDbComponent(tenant.dbUser || "hisaabo");
  // Decrypt tenant password (handles legacy plaintext gracefully)
  const { decryptDbPassword } = await import("./crypto.js");
  const password = sanitizeDbComponent(decryptDbPassword(tenant.dbPassword || ""));
  const dbName = validateDbName(tenant.dbName);

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}`;
}

export async function getTenantDb(tenantId: string): Promise<TenantDatabase> {
  // Self-hosted: always return the single DB
  if (!isMultiTenant) {
    return getSingleTenantDb();
  }

  // Cloud: check pool cache
  const existing = tenantPools.get(tenantId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.db;
  }

  // Create new pool
  if (tenantPools.size >= MAX_POOLS) {
    // Evict LRU (FINDING 19: close connection before evicting)
    let oldestId = "";
    let oldestTime = Infinity;
    for (const [id, entry] of tenantPools) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestId = id;
      }
    }
    if (oldestId) {
      const evicted = tenantPools.get(oldestId);
      if (evicted) evicted.client.end();
      tenantPools.delete(oldestId);
    }
  }

  const connectionString = await resolveConnectionString(tenantId);
  const { db, client } = createTenantDb(connectionString);

  tenantPools.set(tenantId, {
    db,
    client,
    lastUsed: Date.now(),
  });

  return db;
}

/**
 * Closes all tenant postgres.js pools held by this module instance. Intended
 * for test teardown only — production code should leave pools alive for the
 * life of the process.
 *
 * Exported because Vitest's per-file module isolation (`isolate: true` default)
 * re-evaluates this module for each test file, so each file creates its own
 * fresh `singleTenantDb` pool and/or per-tenant pools. Without an explicit
 * close, the old pools' idle connections stay alive in the single worker
 * process until `idle_timeout` elapses, and the test DB's `max_connections`
 * limit gets exhausted mid-run. Calling this in the test helper's `afterAll`
 * gives the pools a clean exit.
 */
export async function closeAllTenantPools(): Promise<void> {
  clearInterval(evictionTimer);

  const toClose: Promise<void>[] = [];

  if (singleTenantClient) {
    toClose.push(singleTenantClient.end({ timeout: 5 }));
    singleTenantClient = null;
    singleTenantDb = null;
  }

  for (const [, entry] of tenantPools) {
    toClose.push(entry.client.end({ timeout: 5 }));
  }
  tenantPools.clear();

  await Promise.all(toClose);
}

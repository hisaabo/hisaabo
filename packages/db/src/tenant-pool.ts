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
type PgClient = ReturnType<typeof postgres>;

interface PoolEntry {
  db: TenantDatabase;
  client: PgClient; // raw client, kept so shutdown/test teardown can end it
  lastUsed: number;
}

/** Seconds a connection may sit idle before postgres.js closes it on its own. */
const CONNECTION_IDLE_TIMEOUT_S = 20;

function createTenantDb(connectionString: string): { db: TenantDatabase; client: PgClient } {
  const client = postgres(connectionString, {
    max: parseInt(process.env.TENANT_POOL_PER_DB_MAX || "5", 10),
    idle_timeout: CONNECTION_IDLE_TIMEOUT_S,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema: tenantSchema });
  return { db, client };
}

const isMultiTenant = process.env.MULTI_TENANT === "true";

// Self-hosted: single tenant DB is the same as the main DB
const singleTenantUrl = process.env.DATABASE_URL!;
let singleTenantDb: TenantDatabase | null = null;
let singleTenantClient: PgClient | null = null;

function getSingleTenantDb(): TenantDatabase {
  if (!singleTenantDb) {
    const { db, client } = createTenantDb(singleTenantUrl);
    singleTenantDb = db;
    singleTenantClient = client;
  }
  return singleTenantDb;
}

/**
 * Live pools, in LRU order: a `Map` iterates in insertion order and a hit
 * re-inserts its entry, so the first key is always the least recently used.
 */
const tenantPools = new Map<string, PoolEntry>();
/** Pool creations in flight, so concurrent first requests for a tenant share one pool. */
const pendingPools = new Map<string, Promise<TenantDatabase>>();
const MAX_POOLS = Math.max(1, parseInt(process.env.TENANT_POOL_MAX || "50", 10) || 50);
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Pools dropped from the cache whose connections may still be open ("draining"),
 * oldest first. Two jobs: it bounds how many connections eviction can leave
 * behind (see retirePool), and it lets `closeAllTenantPools` (shutdown, test
 * teardown) end them too. A pool is forgotten RETIRED_TRACK_MS after eviction,
 * by which point its connections have idled out unless a holder is still using
 * it (which then simply idles out later).
 */
const retiredClients = new Set<PgClient>();
const RETIRED_TRACK_MS = 2 * CONNECTION_IDLE_TIMEOUT_S * 1000;

/**
 * Most evicted pools allowed to drain at once; past it the oldest is ended
 * (retirePool). Defaults to TENANT_POOL_MAX; 0 ends every evicted pool at once.
 */
function parseDrainingMax(): number {
  const n = parseInt(process.env.TENANT_POOL_DRAINING_MAX ?? "", 10);
  return Number.isInteger(n) && n >= 0 ? n : MAX_POOLS;
}
const MAX_DRAINING = parseDrainingMax();
/** How long ending the oldest draining pool waits for its in-flight queries (seconds). */
const DRAIN_END_TIMEOUT_S = 30;
const DRAIN_WARN_EVERY_MS = 60_000;
let lastDrainWarn = 0;

/**
 * Drops a pool from the cache. Its client is normally NOT ended.
 *
 * A request takes its `db` once (tRPC `hasTenantAccess`) and keeps using it for
 * the rest of the request, and a few background tasks hold one for longer, so
 * the pool being evicted may still be in use. Ending it is not safe:
 *
 *  - `end()` (postgres.js 3.4.9, src/index.js `end`) flags the client as
 *    ending; every later pool-level query or `begin()` on it then rejects with
 *    CONNECTION_ENDED. That is the bug this replaces.
 *  - `close()` is no better in 3.4.9. It lets in-flight work finish and later
 *    queries reconnect, but it calls `end()` on every connection, and a
 *    connection that is not live (never opened, or already closed by
 *    `idle_timeout`) is moved to the `ended` queue and never comes back. Once
 *    all of them are stranded a later query waits forever instead of failing.
 *    Idle pools, the ones eviction normally picks, are exactly that case.
 *
 * So the client is left alone. Nothing new reaches it through the cache;
 * holders keep a fully working client (queries, transactions and in-flight
 * work, with lazy reconnect); and its connections close by themselves once
 * idle (`idle_timeout`, CONNECTION_IDLE_TIMEOUT_S), after which it is garbage.
 *
 * Connection math. Per process, tenant connections never exceed
 *
 *   (TENANT_POOL_MAX + TENANT_POOL_DRAINING_MAX) x TENANT_POOL_PER_DB_MAX
 *
 * (plus one per `withDedicatedTenantDb` visit in progress, and pools that were
 * evicted more than ~40 s ago but are still in active use by a long-running
 * holder). Without a cap that would not hold: a pool that is dropped keeps its
 * connections for 20 s, so a burst across many tenants would leave a pool's
 * worth of connections behind for every tenant touched in that window. The cap
 * is what makes the bound real: when more than MAX_DRAINING evicted pools are
 * draining, the OLDEST is ended with `end({ timeout: 30 })`, which closes its
 * connections as soon as their queries finish (up to 30 s, then they are cut).
 *
 * Trade-off: that `end()` is the CONNECTION_ENDED hazard above, confined to a
 * storm (more than MAX_DRAINING evictions inside the idle window). A holder of
 * that oldest pool keeps any query or transaction already running on it, but a
 * NEW query or transaction it starts afterwards fails with CONNECTION_ENDED.
 * Size TENANT_POOL_MAX to the tenants that are active at once so this stays
 * rare, and watch for the warning below.
 *
 * The sum over all API and worker processes must stay below the server's
 * `max_connections` minus its reserved superuser slots; docs/DEPLOYMENT.md has
 * the budget and recommended values.
 */
function retirePool(entry: PoolEntry): void {
  const client = entry.client;
  retiredClients.add(client);
  setTimeout(() => retiredClients.delete(client), RETIRED_TRACK_MS).unref();

  while (retiredClients.size > MAX_DRAINING) {
    const oldest = retiredClients.values().next().value as PgClient;
    retiredClients.delete(oldest);
    oldest.end({ timeout: DRAIN_END_TIMEOUT_S }).catch(() => {});
    const now = Date.now();
    if (now - lastDrainWarn > DRAIN_WARN_EVERY_MS) {
      lastDrainWarn = now;
      console.warn(
        `[tenant-pool] more than ${MAX_DRAINING} evicted pools were still draining; ended the oldest. ` +
          "The tenant pool cache is smaller than the set of tenants being served at once: raise " +
          "TENANT_POOL_MAX (and Postgres max_connections) or lower TENANT_POOL_PER_DB_MAX; see docs/DEPLOYMENT.md.",
      );
    }
  }
}

// Evict idle pools periodically (FINDING 19). Evicted pools are retired, not
// ended; see retirePool. .unref() so the timer does not keep the process alive
// on exit — critical for test runs where we want Node to exit cleanly after all
// files finish.
const evictionTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of tenantPools) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      tenantPools.delete(id);
      retirePool(entry);
    }
  }
}, 60_000);
evictionTimer.unref();

/**
 * Builds the connection string for a tenant from the control database.
 * Exported for callers that need their own, short-lived connection to a tenant
 * database instead of a slot in the shared pool cache (see withDedicatedTenantDb).
 */
export async function resolveConnectionString(tenantId: string): Promise<string> {
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

  // Cloud: check pool cache. Re-inserting moves the entry to the most recently used end.
  const existing = tenantPools.get(tenantId);
  if (existing) {
    existing.lastUsed = Date.now();
    tenantPools.delete(tenantId);
    tenantPools.set(tenantId, existing);
    return existing.db;
  }

  // Concurrent first requests for the same tenant share one pool.
  const inFlight = pendingPools.get(tenantId);
  if (inFlight) return inFlight;

  const creating = (async () => {
    const connectionString = await resolveConnectionString(tenantId);
    const { db, client } = createTenantDb(connectionString);

    // Make room only now that the new pool exists, so the cache never exceeds
    // MAX_POOLS. The evicted pool is retired, not ended (see retirePool).
    while (tenantPools.size >= MAX_POOLS) {
      const [oldestId, oldest] = tenantPools.entries().next().value as [string, PoolEntry];
      tenantPools.delete(oldestId);
      retirePool(oldest);
    }
    tenantPools.set(tenantId, { db, client, lastUsed: Date.now() });
    return db;
  })();

  pendingPools.set(tenantId, creating);
  try {
    return await creating;
  } finally {
    pendingPools.delete(tenantId);
  }
}

/**
 * Runs `fn` with a tenant database handle backed by its own client (one
 * connection), then ends that client. Use it for background loops that visit
 * many tenants (the recurring-invoice scheduler): going through `getTenantDb`
 * would cycle every tenant through the shared LRU and evict the pools live
 * requests are using.
 *
 * `fn` must use the handle it is given (and the `tx` of any transaction it
 * opens), never another handle on the same client: a transaction holds the
 * only connection, so a second query on the outer handle would wait for it.
 *
 * Self-hosted: there is one database and its long-lived pool, so `fn` just
 * gets that and nothing is ended.
 */
export async function withDedicatedTenantDb<T>(
  tenantId: string,
  fn: (db: TenantDatabase) => Promise<T>,
): Promise<T> {
  if (!isMultiTenant) {
    return fn(getSingleTenantDb());
  }

  const client = postgres(await resolveConnectionString(tenantId), {
    max: 1,
    idle_timeout: CONNECTION_IDLE_TIMEOUT_S, // backstop; the client is ended below
    connect_timeout: 10,
  });
  try {
    return await fn(drizzle(client, { schema: tenantSchema }));
  } finally {
    await client.end({ timeout: 5 }).catch(() => {});
  }
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

  // Pools evicted but possibly still draining: nothing will use them after this.
  for (const client of retiredClients) {
    toClose.push(client.end({ timeout: 5 }));
  }
  retiredClients.clear();

  await Promise.all(toClose);
}

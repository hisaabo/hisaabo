/**
 * tenant-db-isolation.test.ts — tenant database naming and access.
 *
 *  F-P2  Names are random (t_<32 hex> / t_<32 hex>_u), never derived from the slug:
 *        two tenants whose slugs share a long base used to get the same truncated
 *        `tenant_<40 chars>` database and the second sign-up failed.
 *  F-P3  CREATE DATABASE grants CONNECT/TEMPORARY to PUBLIC, so every tenant's role
 *        could open every other tenant's database. Provisioning now revokes that and
 *        grants the tenant's own role; restrictExistingTenantDatabases() (run by the
 *        migrate step) does the same for databases provisioned before.
 *
 * Runs against the real cluster of the test database. It provisions real databases
 * and roles (named t_* / tenant_isoleg_*) and drops every one it created.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  provisionTenantDatabase,
  cleanupTenantDatabase,
  generateTenantDbNames,
  restrictExistingTenantDatabases,
  decryptDbPassword,
  tenants,
  type TenantDbConfig,
} from "@hisaabo/db";
import { createUser, createTenant } from "./helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { createCallerFactory } from "../trpc.js";
import { appRouter } from "../router.js";

const controlUrl = process.env.CONTROL_DATABASE_URL!;
const control = new URL(controlUrl);
const admin = postgres(Object.assign(new URL(controlUrl), { pathname: "/postgres" }).toString(), {
  max: 2,
  onnotice: () => {},
});

const created: { dbName: string; dbUser: string }[] = [];
const track = <T extends { dbName: string; dbUser: string }>(c: T): T => {
  created.push({ dbName: c.dbName, dbUser: c.dbUser });
  return c;
};

function urlAs(user: string, password: string, db: string): string {
  const u = new URL(controlUrl);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
}

/** Opens a session and runs a trivial query; Postgres refuses CONNECT with SQLSTATE 42501. */
async function connectOutcome(url: string): Promise<"ok" | "denied"> {
  const c = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} });
  try {
    await c`select 1`;
    return "ok";
  } catch (e) {
    if ((e as { code?: string }).code === "42501") return "denied";
    throw e;
  } finally {
    await c.end({ timeout: 2 });
  }
}

const as = (c: TenantDbConfig, db: string) => connectOutcome(urlAs(c.dbUser, decryptDbPassword(c.dbPassword), db));
const asMigrator = (db: string) => connectOutcome(Object.assign(new URL(controlUrl), { pathname: `/${db}` }).toString());

/** How the pre-0.10.1 code named a tenant database from its slug (for the regression anchor). */
const legacyDbName = (slug: string) => `tenant_${slug.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`;

const ENV_KEYS = ["MULTI_TENANT", "ENCRYPTION_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

beforeAll(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const c of created) await cleanupTenantDatabase(c.dbName, c.dbUser);
  await admin.end({ timeout: 2 });
  await truncateAllTables();
  await closeTestDb();
});

describe("generateTenantDbNames", () => {
  it("is t_<32 hex> and t_<32 hex>_u, unique, and well inside the 63-byte identifier limit", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { dbName, dbUser } = generateTenantDbNames();
      expect(dbName).toMatch(/^t_[0-9a-f]{32}$/);
      expect(dbUser).toBe(`${dbName}_u`);
      expect(Buffer.byteLength(dbUser)).toBeLessThanOrEqual(63);
      seen.add(dbName);
    }
    expect(seen.size).toBe(200);
  });
});

describe("two tenants whose slugs share a long base (F-P2)", () => {
  const factory = createCallerFactory(appRouter);
  const longName = "Maharashtra Trading Corporation Private Limited Pune";

  it("the old slug-derived name was identical for both, which is what failed the second sign-up", () => {
    // tenant.ts / auth.ts: slug = <base up to 40-48 chars>-<nanoid(6)>; name was tenant_<first 40 chars>.
    const base = longName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
    expect(legacyDbName(`${base}-Ab3xY9`)).toBe(legacyDbName(`${base}-Zq7Lm2`));
  });

  it("both organisations are created through tenant.create, with different databases, and the slug is unchanged", async () => {
    process.env.MULTI_TENANT = "true";
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");

    const userA = await createUser({ email: "long.a@example.in", name: longName });
    const userB = await createUser({ email: "long.b@example.in", name: longName });
    const call = (u: typeof userA) =>
      factory({
        user: { id: u.id, email: u.email, name: u.name },
        tenantId: null,
        businessId: null,
        req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers: new Headers() }),
        resHeaders: new Headers(),
        ipAddress: null,
      }).tenant.create();

    const [a, b] = await Promise.all([call(userA), call(userB)]);

    const db = getControlDb();
    const [rowA] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    const [rowB] = await db.select().from(tenants).where(eq(tenants.id, b.tenantId));
    track({ dbName: rowA!.dbName!, dbUser: rowA!.dbUser! });
    track({ dbName: rowB!.dbName!, dbUser: rowB!.dbUser! });

    expect(rowA!.dbName).toMatch(/^t_[0-9a-f]{32}$/);
    expect(rowB!.dbName).toMatch(/^t_[0-9a-f]{32}$/);
    expect(rowA!.dbName).not.toBe(rowB!.dbName);
    expect(rowA!.dbUser).toBe(`${rowA!.dbName}_u`);
    // slugs are still <readable base>-<suffix> and share their long base
    expect(rowA!.slug).toMatch(/^maharashtra-trading-corporation-private-limited-/);
    expect(rowA!.slug.slice(0, 40)).toBe(rowB!.slug.slice(0, 40));
    expect(rowA!.slug).not.toBe(rowB!.slug);

    // both databases exist and were migrated
    for (const row of [rowA!, rowB!]) {
      const asApp = postgres(urlAs(row.dbUser!, decryptDbPassword(row.dbPassword!), row.dbName!), { max: 1, onnotice: () => {} });
      try {
        const [t] = await asApp`select to_regclass('public.businesses') is not null as ok`;
        expect(t!.ok).toBe(true);
      } finally {
        await asApp.end({ timeout: 2 });
      }
    }
  }, 60_000);
});

describe("tenant database access (F-P3)", () => {
  let a: TenantDbConfig;
  let b: TenantDbConfig;

  beforeAll(async () => {
    a = track(await provisionTenantDatabase());
    b = track(await provisionTenantDatabase());
  }, 60_000);

  it("a freshly provisioned database is closed to PUBLIC in the catalog", async () => {
    const rows = await admin`
      SELECT d.datname, a.privilege_type
      FROM pg_database d, aclexplode(d.datacl) a
      WHERE d.datname IN ${admin([a.dbName, b.dbName])} AND a.grantee = 0`;
    expect(rows).toEqual([]);
  });

  it("a tenant's role can connect to its own database but not to another tenant's", async () => {
    expect(await as(a, a.dbName)).toBe("ok");
    expect(await as(b, b.dbName)).toBe("ok");
    expect(await as(a, b.dbName)).toBe("denied");
    expect(await as(b, a.dbName)).toBe("denied");
  });

  it("the migrator / control role keeps access (provisioning migrated the new schema after the revoke)", async () => {
    expect(await asMigrator(a.dbName)).toBe("ok");
    expect(await asMigrator(b.dbName)).toBe("ok");
    const tenantDb = postgres(Object.assign(new URL(controlUrl), { pathname: `/${a.dbName}` }).toString(), { max: 1, onnotice: () => {} });
    try {
      const [t] = await tenantDb`select count(*)::int as n from drizzle."__drizzle_tenant_migrations"`;
      expect(t!.n).toBeGreaterThan(0);
    } finally {
      await tenantDb.end({ timeout: 2 });
    }
  });

  describe("one-time pass over databases provisioned before 0.10.1", () => {
    // pre-0.10.1 layout: tenant_<slug> names, CONNECT/TEMPORARY still granted to PUBLIC
    const legacy = { dbName: `tenant_isoleg_${randomBytes(4).toString("hex")}`, dbUser: "", password: randomBytes(16).toString("hex") };
    legacy.dbUser = `${legacy.dbName}_user`;
    const missingDb = `tenant_isomissing_${randomBytes(4).toString("hex")}`;

    beforeAll(async () => {
      // only the rows below may carry a database (the organisations created above are gone)
      await truncateAllTables();
      await admin.unsafe(`CREATE DATABASE "${legacy.dbName}"`);
      await admin.unsafe(`CREATE USER "${legacy.dbUser}" WITH PASSWORD '${legacy.password}'`);
      await admin.unsafe(`GRANT ALL PRIVILEGES ON DATABASE "${legacy.dbName}" TO "${legacy.dbUser}"`);
      created.push({ dbName: legacy.dbName, dbUser: legacy.dbUser });

      // reopen the new databases to model the old provisioning
      for (const d of [a.dbName, b.dbName]) await admin.unsafe(`GRANT CONNECT, TEMPORARY ON DATABASE "${d}" TO PUBLIC`);

      const base = { dbHost: control.hostname, dbPort: control.port || "5432" };
      await createTenant({ slug: "iso-a", dbName: a.dbName, dbUser: a.dbUser, dbPassword: a.dbPassword, ...base });
      // another address for the same server: exercises the one-connection-per-server grouping
      await createTenant({ slug: "iso-b", dbName: b.dbName, dbUser: b.dbUser, dbPassword: b.dbPassword, ...base, dbHost: "127.0.0.1" });
      await createTenant({ slug: "iso-legacy", dbName: legacy.dbName, dbUser: legacy.dbUser, dbPassword: legacy.password, ...base });
      await createTenant({ slug: "iso-gone", dbName: missingDb, dbUser: "tenant_nobody_user", dbPassword: "x", ...base });
      await createTenant({ slug: "iso-nouser", dbName: "tenant_nouser", dbUser: null, ...base });
      // self-hosted-style row without a database is not counted
      await createTenant({ slug: "iso-shared" });
    }, 60_000);

    const legacyCfg = () => ({ dbName: legacy.dbName, dbUser: legacy.dbUser, dbPassword: legacy.password, dbHost: "", dbPort: "" }) as TenantDbConfig;

    it("before the pass, any tenant role can connect to any other tenant's database", async () => {
      expect(await as(a, b.dbName)).toBe("ok");
      expect(await as(b, a.dbName)).toBe("ok");
      expect(await as(a, legacy.dbName)).toBe("ok");
      expect(await as(legacyCfg(), a.dbName)).toBe("ok");
    });

    it("closes every listed database to PUBLIC, keeps each tenant's own access and the migrator's, and reports counts", async () => {
      const logs: string[] = [];
      const report = await restrictExistingTenantDatabases({ controlUrl, logger: (_l, msg) => logs.push(msg) });

      expect(report).toMatchObject({ total: 5, restricted: 3, missing: 1, skipped: 1, failed: 0 });
      expect(logs.some((m) => /does not exist/.test(m))).toBe(true);

      expect(await as(a, a.dbName)).toBe("ok");
      expect(await as(b, b.dbName)).toBe("ok");
      expect(await as(legacyCfg(), legacy.dbName)).toBe("ok");
      expect(await as(a, b.dbName)).toBe("denied");
      expect(await as(b, a.dbName)).toBe("denied");
      expect(await as(a, legacy.dbName)).toBe("denied");
      expect(await as(legacyCfg(), a.dbName)).toBe("denied");
      for (const d of [a.dbName, b.dbName, legacy.dbName]) expect(await asMigrator(d)).toBe("ok");
    });

    it("is idempotent and safe to run concurrently (several replicas booting together)", async () => {
      const runs = await Promise.all([1, 2, 3].map(() => restrictExistingTenantDatabases({ controlUrl })));
      for (const r of runs) expect(r).toMatchObject({ total: 5, restricted: 3, missing: 1, skipped: 1, failed: 0 });
      expect(await as(a, b.dbName)).toBe("denied");
      expect(await as(a, a.dbName)).toBe("ok");
    });

    it("an explicit GRANT CONNECT to another role (backup, BI) survives later passes", async () => {
      const bi = `bi_reader_${randomBytes(4).toString("hex")}`;
      await admin.unsafe(`CREATE USER "${bi}" WITH PASSWORD 'bi-secret'`);
      try {
        expect(await connectOutcome(urlAs(bi, "bi-secret", a.dbName))).toBe("denied");
        await admin.unsafe(`GRANT CONNECT ON DATABASE "${a.dbName}" TO "${bi}"`);
        await restrictExistingTenantDatabases({ controlUrl });
        expect(await connectOutcome(urlAs(bi, "bi-secret", a.dbName))).toBe("ok");
        expect(await connectOutcome(urlAs(bi, "bi-secret", b.dbName))).toBe("denied");
      } finally {
        await admin.unsafe(`DROP OWNED BY "${bi}"`).catch(() => {});
        await admin.unsafe(`DROP USER IF EXISTS "${bi}"`);
      }
    });
  });
});

/**
 * store-slug-registry.test.ts — control-DB storefront slug registry (P4).
 *
 * The harness runs MULTI_TENANT=false with one shared physical tenant DB; the
 * registry gate is read at call time, so tests stub MULTI_TENANT=true. Because
 * both "tenants" share one tenant DB, tests that must exercise the REGISTRY
 * (not the tenant-local unique index) clear the slug from the tenant row of the
 * first business to simulate separate tenant databases.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { businesses, controlDb, STORE_SLUG_MARKER_KEY } from "@hisaabo/db";
import { createTestWorld, createBusiness, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";
import { resolveSlug, checkAvailability, claimSlug, releaseSlug, setEnabled, applyStoreChange } from "../../lib/store-slug-registry.js";
import { resolveStoreSlug, _resetStoreSlugCacheState } from "../../lib/store-slug-cache.js";
import { registerImportedStoreSlugs } from "../../lib/importEngine.js";
import { serveBusinessLogo } from "../../lib/logo-response.js";

let world: TestWorld;

const callerA = () => createTestCaller({
  userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name,
  tenantId: world.tenant1.id, businessId: world.business1.id,
});
const callerB = () => createTestCaller({
  userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name,
  tenantId: world.tenant2.id, businessId: world.business2.id,
});

async function rows(slug: string) {
  return controlDb.execute<{ tenant_id: string; business_id: string; store_enabled: boolean; released_at: Date | null }>(
    sql`SELECT tenant_id, business_id, store_enabled, released_at FROM store_slugs WHERE slug = ${slug}`);
}
/** Simulate separate tenant DBs: drop the slug from a business row. */
async function hideFromTenantDb(businessId: string) {
  await getTenantTestDb().update(businesses).set({ storeSlug: null, storeEnabled: false }).where(eq(businesses.id, businessId));
}
const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any;

beforeAll(async () => {
  world = await createTestWorld();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await truncateAllTables();
  await closeTestDb();
});
beforeEach(async () => {
  vi.stubEnv("MULTI_TENANT", "true");
  await controlDb.execute(sql`DELETE FROM store_slugs`);
  await controlDb.execute(sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`);
  await getTenantTestDb().update(businesses).set({ storeSlug: null, storeEnabled: false });
  _resetStoreSlugCacheState();
  // marker present by default: no legacy scan
  await controlDb.execute(sql`INSERT INTO system_config (key, value) VALUES (${STORE_SLUG_MARKER_KEY}, '{}'::jsonb)`);
});

describe("registry resolve + write path", () => {
  it("claims on updateSettings and resolves to tenant+business", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    expect(await resolveSlug("alpha-shop")).toEqual({
      tenantId: world.tenant1.id, businessId: world.business1.id, storeEnabled: true,
    });
    expect(await resolveStoreSlug("alpha-shop")).toEqual({ tenantId: world.tenant1.id, businessId: world.business1.id });
  });

  it("idempotent re-save of the same slug", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeTagline: "x", storeEnabled: true });
    expect((await rows("alpha-shop")).length).toBe(1);
  });

  it("global CONFLICT across tenants (registry, not tenant-local index)", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    await hideFromTenantDb(world.business1.id);
    await expect(callerB().store.updateSettings({ storeSlug: "alpha-shop" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "This store URL is already taken. Please choose a different one." });
    // still owned by tenant1, and tenant2's tenant row untouched
    expect((await rows("alpha-shop"))[0]!.tenant_id).toBe(world.tenant1.id);
    const [b2] = await getTenantTestDb().select().from(businesses).where(eq(businesses.id, world.business2.id));
    expect(b2!.storeSlug).toBeNull();
  });

  it("checkSlug reports global availability", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    await hideFromTenantDb(world.business1.id);
    expect(await callerB().store.checkSlug({ slug: "alpha-shop" })).toEqual({ available: false });
    expect(await callerB().store.checkSlug({ slug: "free-name" })).toEqual({ available: true });
  });

  it("rename releases the old slug (30-day hold) and invalidates the cache", async () => {
    await callerA().store.updateSettings({ storeSlug: "old-name", storeEnabled: true });
    expect(await resolveStoreSlug("old-name")).not.toBeNull(); // warm positive cache
    expect(await resolveStoreSlug("new-name")).toBeNull(); // warm negative cache
    await callerA().store.updateSettings({ storeSlug: "new-name" });
    expect(await resolveStoreSlug("old-name")).toBeNull();
    expect(await resolveStoreSlug("new-name")).toEqual({ tenantId: world.tenant1.id, businessId: world.business1.id });
    const old = (await rows("old-name"))[0]!;
    expect(old.released_at).not.toBeNull();
    expect(old.tenant_id).toBe(world.tenant1.id);
  });

  it("released slug: other tenant blocked < 30 days, same tenant may reclaim, other tenant after 30 days", async () => {
    await callerA().store.updateSettings({ storeSlug: "old-name", storeEnabled: true });
    await callerA().store.updateSettings({ storeSlug: "new-name" });
    await hideFromTenantDb(world.business1.id);

    await expect(callerB().store.updateSettings({ storeSlug: "old-name" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await callerB().store.checkSlug({ slug: "old-name" })).toEqual({ available: false });
    expect(await checkAvailability("old-name", world.tenant1.id, world.business1.id)).toBe(true);

    // same tenant reclaims at any time
    await callerA().store.updateSettings({ storeSlug: "old-name" });
    expect((await rows("old-name"))[0]!.released_at).toBeNull();
    await callerA().store.updateSettings({ storeSlug: "new-name" }); // release again
    await hideFromTenantDb(world.business1.id);

    // simulate 31 days
    await controlDb.execute(sql`UPDATE store_slugs SET released_at = now() - interval '31 days' WHERE slug = 'old-name'`);
    expect(await callerB().store.checkSlug({ slug: "old-name" })).toEqual({ available: true });
    await callerB().store.updateSettings({ storeSlug: "old-name", storeEnabled: true });
    const r = (await rows("old-name"))[0]!;
    expect(r.tenant_id).toBe(world.tenant2.id);
    expect(r.business_id).toBe(world.business2.id);
    expect(r.released_at).toBeNull();
  });

  it("clearing the slug releases it", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    await callerA().store.updateSettings({ storeSlug: null });
    expect(await resolveSlug("alpha-shop")).toBeNull();
    expect((await rows("alpha-shop"))[0]!.released_at).not.toBeNull();
  });

  it("disabling the store makes the storefront resolve to null immediately", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    expect(await resolveStoreSlug("alpha-shop")).not.toBeNull();
    await callerA().store.updateSettings({ storeEnabled: false });
    expect(await resolveStoreSlug("alpha-shop")).toBeNull();
    expect((await rows("alpha-shop"))[0]!.store_enabled).toBe(false);
    await callerA().store.updateSettings({ storeEnabled: true });
    expect(await resolveStoreSlug("alpha-shop")).not.toBeNull();
  });

  it("suspended tenant does not resolve", async () => {
    await callerA().store.updateSettings({ storeSlug: "alpha-shop", storeEnabled: true });
    await controlDb.execute(sql`UPDATE tenants SET status = 'suspended' WHERE id = ${world.tenant1.id}`);
    try {
      expect(await resolveSlug("alpha-shop")).toBeNull();
    } finally {
      await controlDb.execute(sql`UPDATE tenants SET status = 'active' WHERE id = ${world.tenant1.id}`);
    }
  });

  it("tenant-write failure rolls back the control change", async () => {
    await callerA().store.updateSettings({ storeSlug: "stay-put", storeEnabled: true });
    // Another business in the same tenant DB already holds 'dup-name' → tenant UNIQUE violation
    const other = await createBusiness(getTenantTestDb(), world.ramesh.id, { storeSlug: "dup-name" });
    try {
      // bypass the tenant pre-check by racing: call the registry path with a slug the pre-check
      // cannot see is impossible, so assert via the unique-violation mapping instead
      await expect(callerA().store.updateSettings({ storeSlug: "dup-name" })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await getTenantTestDb().delete(businesses).where(eq(businesses.id, other.id));
    }
    const live = await controlDb.execute(sql`SELECT slug FROM store_slugs WHERE business_id = ${world.business1.id} AND released_at IS NULL`);
    expect(live.map((r) => r.slug)).toEqual(["stay-put"]);
    expect((await rows("dup-name")).length).toBe(0);
  });

  it("applyStoreChange: a failing tenant write rolls back release+claim in the control DB", async () => {
    await callerA().store.updateSettings({ storeSlug: "keep-me", storeEnabled: true });
    await expect(applyStoreChange({
      tenantId: world.tenant1.id, businessId: world.business1.id,
      oldSlug: "keep-me", newSlug: "never-lands", newEnabled: true,
      runTenantUpdate: async () => { throw new Error("tenant boom"); },
    })).rejects.toThrow("tenant boom");
    expect((await rows("keep-me"))[0]!.released_at).toBeNull();
    expect((await rows("never-lands")).length).toBe(0);
    expect(await resolveStoreSlug("keep-me")).not.toBeNull();
  });

  it("applyStoreChange: control commit failure after tenant write reverts the tenant row", async () => {
    const revert = vi.fn(async () => {});
    // runTenantUpdate succeeds, then the tx callback returns; force COMMIT-time
    // failure with a deferred-constraint-free trick: make the callback end by
    // terminating the transaction connection.
    await expect(applyStoreChange({
      tenantId: world.tenant1.id, businessId: world.business1.id,
      oldSlug: null, newSlug: "commit-fail", newEnabled: true,
      runTenantUpdate: async () => {
        await controlDb.execute(sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'idle in transaction'`);
        return 1;
      },
      revertTenant: revert,
    })).rejects.toThrow();
    expect(revert).toHaveBeenCalledTimes(1);
    expect((await rows("commit-fail")).length).toBe(0);
  });

  it("concurrent claims by two tenants: exactly one wins", async () => {
    const a = callerA().store.updateSettings({ storeSlug: "race-name", storeEnabled: true });
    const b = callerB().store.updateSettings({ storeSlug: "race-name", storeEnabled: true });
    const res = await Promise.allSettled([a, b]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await rows("race-name")).length).toBe(1);
  });

  it("self-hosted mode never touches the registry", async () => {
    vi.stubEnv("MULTI_TENANT", "false");
    await callerA().store.updateSettings({ storeSlug: "solo-shop", storeEnabled: true });
    const [{ n }] = await controlDb.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM store_slugs`);
    expect(n).toBe(0);
    expect(await resolveStoreSlug("solo-shop")).toEqual({ tenantId: "single", businessId: world.business1.id });
    // cache invalidated when settings change in self-hosted mode too
    await callerA().store.updateSettings({ storeEnabled: false });
    expect(await resolveStoreSlug("solo-shop")).toBeNull();
  });
});

describe("cross-tenant attacks", () => {
  beforeEach(async () => {
    await callerA().store.updateSettings({ storeSlug: "victim-shop", storeEnabled: true });
    await hideFromTenantDb(world.business1.id);
  });

  it("tenant B cannot overwrite / hijack a live slug via claimSlug (even forging the business id)", async () => {
    await expect(controlDb.transaction((tx) =>
      claimSlug(tx, { tenantId: world.tenant2.id, businessId: world.business1.id, slug: "victim-shop", storeEnabled: true }),
    )).rejects.toThrow();
    const r = (await rows("victim-shop"))[0]!;
    expect(r).toMatchObject({ tenant_id: world.tenant1.id, business_id: world.business1.id, released_at: null });
  });

  it("tenant B cannot release or disable tenant A's slug (even forging A's business id)", async () => {
    const rel = await controlDb.transaction((tx) => releaseSlug(tx, { tenantId: world.tenant2.id, businessId: world.business1.id }));
    const en = await controlDb.transaction((tx) => setEnabled(tx, { tenantId: world.tenant2.id, businessId: world.business1.id, storeEnabled: false }));
    expect(rel).toEqual([]);
    expect(en).toEqual([]);
    expect((await rows("victim-shop"))[0]).toMatchObject({ released_at: null, store_enabled: true });
  });

  it("tenant B's API calls never alter A's row (updateSettings with other slug / disable)", async () => {
    await callerB().store.updateSettings({ storeSlug: "b-shop", storeEnabled: false });
    await callerB().store.updateSettings({ storeSlug: null });
    await callerB().store.updateSettings({ storeEnabled: false });
    expect((await rows("victim-shop"))[0]).toMatchObject({ tenant_id: world.tenant1.id, released_at: null, store_enabled: true });
  });

  it("crafted self-import cannot take, release or disable another tenant's slug", async () => {
    // Backup claims A's slug AND A's business id, imported into tenant B.
    const warnings: any[] = [];
    const db = getTenantTestDb();
    await db.update(businesses).set({ storeSlug: "victim-shop", storeEnabled: true }).where(eq(businesses.id, world.business2.id));
    await registerImportedStoreSlugs(db as any, world.tenant2.id, warnings, logger);
    expect((await rows("victim-shop"))[0]).toMatchObject({
      tenant_id: world.tenant1.id, business_id: world.business1.id, released_at: null, store_enabled: true,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toContain("victim-shop");
    // conflict path: tenant DB cleaned
    const [b2] = await db.select().from(businesses).where(eq(businesses.id, world.business2.id));
    expect(b2).toMatchObject({ storeSlug: null, storeEnabled: false });
  });
});

describe("self-import registration", () => {
  it("registers non-conflicting slugs, warns and clears conflicting ones, never throws", async () => {
    await callerA().store.updateSettings({ storeSlug: "taken-slug", storeEnabled: true });
    await hideFromTenantDb(world.business1.id);
    const db = getTenantTestDb();
    const extra = await createBusiness(db, world.kiran.id, { storeSlug: "fresh-slug", storeEnabled: true });
    await db.update(businesses).set({ storeSlug: "taken-slug", storeEnabled: true }).where(eq(businesses.id, world.business2.id));
    const warnings: any[] = [];
    await registerImportedStoreSlugs(db as any, world.tenant2.id, warnings, logger);
    try {
      expect((await rows("fresh-slug"))[0]).toMatchObject({ tenant_id: world.tenant2.id, business_id: extra.id, store_enabled: true });
      expect(await resolveStoreSlug("fresh-slug")).toEqual({ tenantId: world.tenant2.id, businessId: extra.id });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ table: "businesses", context: { businessId: world.business2.id } });
      const [b2] = await db.select().from(businesses).where(eq(businesses.id, world.business2.id));
      expect(b2).toMatchObject({ storeSlug: null, storeEnabled: false });
      expect((await rows("taken-slug"))[0]!.tenant_id).toBe(world.tenant1.id);
    } finally {
      await db.delete(businesses).where(eq(businesses.id, extra.id));
    }
  });
});

describe("legacy tenant-scan fallback", () => {
  it("runs only while the backfill marker is absent", async () => {
    // slug exists only in tenant DB (not in registry)
    await getTenantTestDb().update(businesses).set({ storeSlug: "legacy-shop", storeEnabled: true }).where(eq(businesses.id, world.business1.id));

    // marker present (beforeEach) → registry is authoritative, no scan
    expect(await resolveStoreSlug("legacy-shop")).toBeNull();

    // marker absent → scan finds it
    await controlDb.execute(sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`);
    _resetStoreSlugCacheState();
    const hit = await resolveStoreSlug("legacy-shop");
    expect(hit?.businessId).toBe(world.business1.id);
  });
});

describe("logo ETag before bytes", () => {
  it("304 path never selects logo_data; 200 path does", async () => {
    const db = getTenantTestDb();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
    const at = new Date("2026-01-02T03:04:05.000Z");
    await db.update(businesses).set({ logoData: png, logoMimeType: "image/png", logoUpdatedAt: at }).where(eq(businesses.id, world.business1.id));
    const etag = `"${at.getTime()}"`;
    const where = eq(businesses.id, world.business1.id);

    const seen: string[] = [];
    const spy = new Proxy(db, {
      get(t, p, r) {
        if (p === "select") {
          return (cols: Record<string, unknown>) => {
            seen.push(Object.keys(cols).join(","));
            return (t as any).select(cols);
          };
        }
        return Reflect.get(t, p, r);
      },
    });

    const r304 = await serveBusinessLogo(spy as any, where, etag, "public");
    expect(r304.status).toBe(304);
    expect(r304.headers.get("etag")).toBe(etag);
    expect(r304.headers.get("x-content-type-options")).toBe("nosniff");
    expect(seen).toEqual(["hasLogo,logoMimeType,logoUpdatedAt"]); // no logoData query

    seen.length = 0;
    const r200 = await serveBusinessLogo(spy as any, where, '"stale"', "public");
    expect(r200.status).toBe(200);
    expect(r200.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(Buffer.from(await r200.arrayBuffer()).equals(png)).toBe(true);
    expect(seen).toEqual(["hasLogo,logoMimeType,logoUpdatedAt", "logoData"]);

    await db.update(businesses).set({ logoData: null, logoMimeType: null }).where(where);
    const empty = await serveBusinessLogo(spy as any, where, etag, "private");
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("private, max-age=60");
  });
});

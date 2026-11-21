/**
 * store-reserved-slug.test.ts — reserved platform store slugs (login, support,
 * hisaabo, ...), against real Postgres.
 *
 * INVARIANTS:
 *   1. A reserved slug can be neither first chosen nor changed to (the clear
 *      "This store address is reserved" error), in both self-hosted and
 *      multi-tenant mode, and nothing is written when it is rejected.
 *   2. GRANDFATHERING: a business that already holds a reserved slug keeps it.
 *      Saving other settings (including re-sending the same slug, as the web
 *      form does on every save) still succeeds, and the store still resolves.
 *   3. checkSlug reports a reserved slug as unavailable-and-reserved, except to
 *      the business that already holds it.
 *   4. Self-import (multi-tenant) cannot be used to claim a reserved slug, but
 *      does not rename a tenant that already holds one.
 *
 * The harness runs MULTI_TENANT=false with one shared physical tenant DB; the
 * registry gate is read at call time, so the multi-tenant tests stub it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { businesses, controlDb, STORE_SLUG_MARKER_KEY } from "@hisaabo/db";
import { RESERVED_STORE_SLUGS, STORE_SLUG_RESERVED_MESSAGE } from "@hisaabo/shared";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";
import { claimSlug, registerImportedSlugs, resolveSlug } from "../../lib/store-slug-registry.js";
import { registerImportedStoreSlugs } from "../../lib/importEngine.js";
import { resolveStoreSlug, _resetStoreSlugCacheState } from "../../lib/store-slug-cache.js";

let world: TestWorld;

const callerA = () => createTestCaller({
  userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name,
  tenantId: world.tenant1.id, businessId: world.business1.id,
});
const callerB = () => createTestCaller({
  userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name,
  tenantId: world.tenant2.id, businessId: world.business2.id,
});

const db = () => getTenantTestDb();
const biz = (id: string) => db().select().from(businesses).where(eq(businesses.id, id)).then((r) => r[0]!);
/** Insert a store slug straight into the tenant row, bypassing the router (what a pre-existing store looks like). */
const setSlugDirect = (id: string, storeSlug: string | null, extra: Partial<typeof businesses.$inferInsert> = {}) =>
  db().update(businesses).set({ storeSlug, storeEnabled: !!storeSlug, storeSlugAutoAssigned: false, ...extra }).where(eq(businesses.id, id));
const registryRows = (slug: string) =>
  controlDb.execute<{ tenant_id: string; business_id: string; released_at: Date | null }>(
    sql`SELECT tenant_id, business_id, released_at FROM store_slugs WHERE slug = ${slug}`);
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
  vi.stubEnv("MULTI_TENANT", "false");
  await setSlugDirect(world.business1.id, null, { storeTagline: null });
  await setSlugDirect(world.business2.id, null, { storeTagline: null });
  await controlDb.execute(sql`DELETE FROM store_slugs`);
  _resetStoreSlugCacheState();
});

describe("reserved slug: first choice and change are rejected", () => {
  it("rejects a reserved slug on first set with the clear message, and writes nothing", async () => {
    await expect(callerA().store.updateSettings({ storeSlug: "login", storeEnabled: true, storeTagline: "should not persist" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: STORE_SLUG_RESERVED_MESSAGE });
    expect(STORE_SLUG_RESERVED_MESSAGE).toContain("This store address is reserved");
    const b = await biz(world.business1.id);
    expect(b.storeSlug).toBeNull();
    expect(b.storeEnabled).toBe(false);
    expect(b.storeTagline).toBeNull();
  });

  it.each(["hisaabo", "support", "admin", "checkout", "privacy", "assets"])("rejects %s", async (slug) => {
    await expect(callerA().store.updateSettings({ storeSlug: slug }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: STORE_SLUG_RESERVED_MESSAGE });
  });

  it("every reserved slug is rejected by the API (list and validator agree)", async () => {
    for (const slug of RESERVED_STORE_SLUGS) {
      await expect(callerA().store.updateSettings({ storeSlug: slug }), slug)
        .rejects.toMatchObject({ message: STORE_SLUG_RESERVED_MESSAGE });
    }
    expect((await biz(world.business1.id)).storeSlug).toBeNull();
  });

  it("rejects changing an auto-assigned slug to a reserved one and keeps the old slug and its one change", async () => {
    await setSlugDirect(world.business1.id, "ab12-acme", { storeSlugAutoAssigned: true });
    await expect(callerA().store.updateSettings({ storeSlug: "support" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: STORE_SLUG_RESERVED_MESSAGE });
    const b = await biz(world.business1.id);
    expect(b.storeSlug).toBe("ab12-acme");
    expect(b.storeSlugAutoAssigned).toBe(true);
    // the single allowed change is still available for a legitimate slug
    await callerA().store.updateSettings({ storeSlug: "acme-traders" });
    expect((await biz(world.business1.id)).storeSlug).toBe("acme-traders");
  });

  it("still accepts ordinary and look-alike slugs", async () => {
    await callerA().store.updateSettings({ storeSlug: "hisaab-kitaab-traders", storeEnabled: true });
    expect((await biz(world.business1.id)).storeSlug).toBe("hisaab-kitaab-traders");
  });
});

describe("reserved slug: grandfathered stores keep working", () => {
  beforeEach(async () => {
    await setSlugDirect(world.business1.id, "shop");
  });

  it("can save other settings with the slug omitted", async () => {
    const out = await callerA().store.updateSettings({ storeTagline: "Fresh daily" });
    expect(out!.storeTagline).toBe("Fresh daily");
    expect(out!.storeSlug).toBe("shop");
  });

  it("can save other settings while re-sending the same reserved slug (what the web form does)", async () => {
    const out = await callerA().store.updateSettings({ storeEnabled: true, storeSlug: "shop", storeTagline: "Open late" });
    expect(out).toMatchObject({ storeSlug: "shop", storeEnabled: true, storeTagline: "Open late" });
  });

  it("the store still resolves", async () => {
    expect(await resolveStoreSlug("shop")).toEqual({ tenantId: "single", businessId: world.business1.id });
  });

  it("the set-once rule is unchanged: it cannot move to another reserved slug", async () => {
    await expect(callerA().store.updateSettings({ storeSlug: "store" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "Your store link can only be set once." });
    expect((await biz(world.business1.id)).storeSlug).toBe("shop");
  });
});

describe("checkSlug", () => {
  it("reports a reserved slug as unavailable and reserved", async () => {
    expect(await callerA().store.checkSlug({ slug: "support" })).toEqual({ available: false, reserved: true });
  });

  it("keeps the existing shapes for ordinary slugs", async () => {
    expect(await callerA().store.checkSlug({ slug: "free-name-here" })).toEqual({ available: true });
  });

  it("does not flag the reserved slug the caller's own business already holds", async () => {
    await setSlugDirect(world.business1.id, "shop");
    expect(await callerA().store.checkSlug({ slug: "shop" })).toEqual({ available: true });
    // another business still sees it as reserved
    expect(await callerB().store.checkSlug({ slug: "shop" })).toEqual({ available: false, reserved: true });
  });
});

describe("reserved slug (multi-tenant registry)", () => {
  beforeEach(async () => {
    vi.stubEnv("MULTI_TENANT", "true");
    await controlDb.execute(sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`);
    await controlDb.execute(sql`INSERT INTO system_config (key, value) VALUES (${STORE_SLUG_MARKER_KEY}, '{}'::jsonb)`);
    _resetStoreSlugCacheState();
  });

  it("rejects a reserved slug before touching the registry or the tenant row", async () => {
    await expect(callerA().store.updateSettings({ storeSlug: "login", storeEnabled: true }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: STORE_SLUG_RESERVED_MESSAGE });
    expect((await registryRows("login")).length).toBe(0);
    expect((await biz(world.business1.id)).storeSlug).toBeNull();
    expect(await resolveSlug("login")).toBeNull();
  });

  it("a grandfathered tenant keeps saving settings and its store keeps resolving", async () => {
    // A pre-existing store: tenant row + live registry row, created before the rule.
    await setSlugDirect(world.business1.id, "shop");
    await controlDb.transaction((tx) =>
      claimSlug(tx, { tenantId: world.tenant1.id, businessId: world.business1.id, slug: "shop", storeEnabled: true }));
    expect(await resolveStoreSlug("shop")).toEqual({ tenantId: world.tenant1.id, businessId: world.business1.id });

    const out = await callerA().store.updateSettings({ storeSlug: "shop", storeEnabled: true, storeTagline: "Still here" });
    expect(out).toMatchObject({ storeSlug: "shop", storeEnabled: true, storeTagline: "Still here" });
    await callerA().store.updateSettings({ storeTagline: "Slug omitted" });

    const rows = await registryRows("shop");
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ tenant_id: world.tenant1.id, business_id: world.business1.id, released_at: null });
    _resetStoreSlugCacheState();
    expect(await resolveStoreSlug("shop")).toEqual({ tenantId: world.tenant1.id, businessId: world.business1.id });
  });

  it("another tenant cannot take that reserved slug, and checkSlug reports it as reserved", async () => {
    await expect(callerB().store.updateSettings({ storeSlug: "shop" }))
      .rejects.toMatchObject({ message: STORE_SLUG_RESERVED_MESSAGE });
    expect(await callerB().store.checkSlug({ slug: "shop" })).toEqual({ available: false, reserved: true });
  });
});

describe("reserved slug: self-import (multi-tenant)", () => {
  beforeEach(async () => {
    vi.stubEnv("MULTI_TENANT", "true");
    await controlDb.execute(sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`);
    await controlDb.execute(sql`INSERT INTO system_config (key, value) VALUES (${STORE_SLUG_MARKER_KEY}, '{}'::jsonb)`);
    _resetStoreSlugCacheState();
  });

  it("a backup cannot register a reserved slug for a tenant that does not already hold it", async () => {
    const out = await registerImportedSlugs(world.tenant2.id, [
      { id: world.business2.id, storeSlug: "support", storeEnabled: true },
    ]);
    expect(out).toEqual([{ businessId: world.business2.id, slug: "support", status: "conflict", reserved: true }]);
    expect((await registryRows("support")).length).toBe(0);
  });

  it("restoring a tenant's own backup does not rename a reserved slug it already holds", async () => {
    await controlDb.transaction((tx) =>
      claimSlug(tx, { tenantId: world.tenant2.id, businessId: world.business2.id, slug: "shop", storeEnabled: true }));
    const out = await registerImportedSlugs(world.tenant2.id, [
      { id: world.business2.id, storeSlug: "shop", storeEnabled: true },
    ]);
    expect(out).toEqual([{ businessId: world.business2.id, slug: "shop", status: "registered" }]);
  });

  it("end to end: the imported store is renamed to a unique slug (still enabled) with a reserved-slug warning", async () => {
    await setSlugDirect(world.business2.id, "login");
    const warnings: any[] = [];
    await registerImportedStoreSlugs(db() as any, world.tenant2.id, warnings, logger);

    const b2 = await biz(world.business2.id);
    expect(b2.storeSlug).toMatch(/^[a-z0-9]{4}-login$/);
    expect(b2).toMatchObject({ storeEnabled: true, storeSlugAutoAssigned: true });
    expect((await registryRows("login")).length).toBe(0);
    expect((await registryRows(b2.storeSlug!))[0]).toMatchObject({ tenant_id: world.tenant2.id, business_id: world.business2.id });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("reserved");
    expect(warnings[0].message).not.toContain("already used by another account");
    expect(warnings[0].context).toMatchObject({ businessId: world.business2.id, oldSlug: "login", newSlug: b2.storeSlug });
  });
});

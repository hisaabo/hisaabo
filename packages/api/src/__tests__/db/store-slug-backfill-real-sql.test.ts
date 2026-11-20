/**
 * Backfill rename against REAL SQL on both sides (no injected renamer).
 *
 * Control DB: a scratch database built from the committed drizzle-control
 * migrations. Tenant DB: the shared test database (schema pushed from
 * tenant-schema, i.e. it has businesses.store_slug_auto_assigned). The default
 * renamer connects through `buildTenantUrl`, exactly like production. Only the
 * tenant READER (rows are per-"tenant" views over the one shared DB) and,
 * where noted, the candidate generator (`generateSlug`) are test seams.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { businesses, backfillStoreSlugRegistry, fallbackSlug, STORE_SLUG_MARKER_KEY, type BusinessSlugRow, type TenantReader } from "@hisaabo/db";
import { createScratchControlDb, type Scratch } from "./scratch-control-db";
import { createUser, createBusiness } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

const TENANT_DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://test:test@localhost:5433/hisaabo_test";
const quiet = () => {};
let scratch: Scratch;
let userId: string;
const db = () => getTenantTestDb();
const day = (n: number) => new Date(Date.UTC(2025, 0, n));

beforeAll(async () => {
  await truncateAllTables();
  scratch = await createScratchControlDb(6);
  userId = (await createUser()).id;
});
afterAll(async () => {
  await scratch.drop();
  await truncateAllTables();
  await closeTestDb();
});
beforeEach(async () => {
  await scratch.sql`DELETE FROM store_slugs`;
  await scratch.sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`;
  await scratch.sql`DELETE FROM tenants`;
  await db().delete(businesses);
});

async function mkTenant(createdAt: Date) {
  const id = randomUUID();
  const slug = `real-${id.slice(0, 8)}`;
  await scratch.sql`INSERT INTO tenants (id, name, slug, db_name, status, created_at)
    VALUES (${id}, ${slug}, ${slug}, ${"db_" + slug.replace(/-/g, "_")}, 'active', ${createdAt})`;
  return { id, slug };
}

interface Setup {
  winnerTenant: string;
  loserTenant: string;
  winnerBiz: string;
  loserBiz: string;
  reader: TenantReader;
}

/** Winner: virtual business (its tenant DB is not materialised). Loser: a real businesses row. */
async function dupSetup(opts: { loserEnabled?: boolean } = {}): Promise<Setup> {
  const w = await mkTenant(day(1));
  const l = await mkTenant(day(2));
  const winnerBiz = randomUUID();
  const loser = await createBusiness(db(), userId, {
    storeSlug: "dup-shop", storeEnabled: opts.loserEnabled ?? true, createdAt: day(5),
  });
  const reader: TenantReader = async (t) => {
    if (t.id === w.id) return [{ id: winnerBiz, store_slug: "dup-shop", store_enabled: true, created_at: day(1) }];
    const rows = await db().select().from(businesses).where(eq(businesses.id, loser.id));
    return rows.filter((r) => r.storeSlug).map<BusinessSlugRow>((r) => ({
      id: r.id, store_slug: r.storeSlug, store_enabled: r.storeEnabled, created_at: r.createdAt,
    }));
  };
  return { winnerTenant: w.id, loserTenant: l.id, winnerBiz, loserBiz: loser.id, reader };
}

const run = (reader: TenantReader, extra: Record<string, unknown> = {}) =>
  backfillStoreSlugRegistry({
    controlUrl: scratch.url, readTenant: reader, buildTenantUrl: async () => TENANT_DB_URL, logger: quiet, ...extra,
  });
const registry = () => scratch.sql<{ slug: string; tenant_id: string; business_id: string; store_enabled: boolean; released_at: Date | null }[]>`
  SELECT slug, tenant_id, business_id, store_enabled, released_at FROM store_slugs ORDER BY slug`;
const bizRow = async (id: string) => (await db().select().from(businesses).where(eq(businesses.id, id)))[0]!;
const marker = async () => (await scratch.sql`SELECT value FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`)[0]?.value;

describe("backfill rename with the real tenant SQL", () => {
  it.each([true, false])("renames the loser in store_slugs and businesses, mirrors store_enabled=%s", async (enabled) => {
    const s = await dupSetup({ loserEnabled: enabled });
    const before = await bizRow(s.loserBiz);
    const r = await run(s.reader);
    expect(r.status).toBe("complete");
    expect(r.renames).toHaveLength(1);
    const to = r.renames[0].to;
    expect(to).toMatch(/^[a-z0-9]{4}-dup-shop$/);

    const row = await bizRow(s.loserBiz);
    expect(row).toMatchObject({ storeSlug: to, storeSlugAutoAssigned: true, storeEnabled: enabled });
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    const reg = await registry();
    expect(reg.map((x) => x.slug).sort()).toEqual(["dup-shop", to].sort());
    expect(reg.find((x) => x.slug === "dup-shop")).toMatchObject({ tenant_id: s.winnerTenant, business_id: s.winnerBiz });
    expect(reg.find((x) => x.slug === to)).toMatchObject({
      tenant_id: s.loserTenant, business_id: s.loserBiz, store_enabled: enabled, released_at: null,
    });
    expect(await marker()).toBeDefined();

    // idempotent: forced re-run changes nothing
    const again = await run(s.reader, { force: true });
    expect(again.renames).toHaveLength(0);
    expect((await bizRow(s.loserBiz)).storeSlug).toBe(to);
    expect(await registry()).toHaveLength(2);
  });

  it("0-row guard: slug changed concurrently => control rolled back, loser unresolved, no marker, tenant row untouched", async () => {
    const s = await dupSetup();
    // The reader saw 'dup-shop'; before the write phase the user changed it.
    const stale: TenantReader = async (t) => {
      const rows = await s.reader(t);
      if (t.id === s.loserTenant) {
        await db().update(businesses).set({ storeSlug: "user-picked" }).where(eq(businesses.id, s.loserBiz));
      }
      return rows;
    };
    const r = await run(stale);
    expect(r.status).toBe("incomplete");
    expect(r.renames).toHaveLength(0);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0]).toMatchObject({ slug: "dup-shop", tenantId: s.loserTenant, businessId: s.loserBiz });
    expect(r.unresolved[0].reason).toMatch(/0 rows/);
    expect((await registry()).map((x) => x.slug)).toEqual(["dup-shop"]); // no candidate row left behind
    expect(await marker()).toBeUndefined();
    expect(await bizRow(s.loserBiz)).toMatchObject({ storeSlug: "user-picked", storeSlugAutoAssigned: false });
  });

  it("tenant unique violation on the candidate => savepoint rolled back, retried with a fresh prefix", async () => {
    const s = await dupSetup();
    // Another business in the loser's tenant DB already holds the first candidate.
    await createBusiness(db(), userId, { storeSlug: "aaaa-dup-shop" });
    const seen: string[] = [];
    let n = 0;
    const generateSlug = (orig: string) => {
      const c = n++ === 0 ? "aaaa-dup-shop" : fallbackSlug(orig);
      seen.push(c);
      return c;
    };
    const r = await run(s.reader, { generateSlug });
    expect(r.status).toBe("complete");
    expect(seen[0]).toBe("aaaa-dup-shop");
    expect(seen.length).toBe(2);
    const to = r.renames[0].to;
    expect(to).not.toBe("aaaa-dup-shop");
    expect(await bizRow(s.loserBiz)).toMatchObject({ storeSlug: to, storeSlugAutoAssigned: true });
    const reg = await registry();
    expect(reg.map((x) => x.slug).sort()).toEqual(["dup-shop", to].sort());
    expect(reg.some((x) => x.slug === "aaaa-dup-shop")).toBe(false); // the failed attempt left no row
    // the loser still has exactly one live registry row (partial unique index would otherwise have fired)
    expect(reg.filter((x) => x.business_id === s.loserBiz && x.released_at === null)).toHaveLength(1);
  });

  it("unique violation on every attempt => unresolved, nothing left behind, tenant untouched", async () => {
    const s = await dupSetup();
    await createBusiness(db(), userId, { storeSlug: "aaaa-dup-shop" });
    let calls = 0;
    const r = await run(s.reader, { generateSlug: () => { calls++; return "aaaa-dup-shop"; } });
    expect(calls).toBe(10);
    expect(r.status).toBe("incomplete");
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].reason).toMatch(/no unique replacement/);
    expect((await registry()).map((x) => x.slug)).toEqual(["dup-shop"]);
    expect(await marker()).toBeUndefined();
    expect(await bizRow(s.loserBiz)).toMatchObject({ storeSlug: "dup-shop", storeSlugAutoAssigned: false });

    // next run (candidate freed up) succeeds
    await db().delete(businesses).where(eq(businesses.storeSlug, "aaaa-dup-shop"));
    const r2 = await run(s.reader);
    expect(r2.status).toBe("complete");
    expect(r2.renames).toHaveLength(1);
  });

  it("registry conflict on the candidate is retried (no tenant write for the conflicting attempt)", async () => {
    const s = await dupSetup();
    const other = await mkTenant(day(3));
    await scratch.sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('aaaa-dup-shop', ${other.id}, ${randomUUID()}, true)`;
    let n = 0;
    const reader: TenantReader = async (t) => (t.id === other.id ? [] : s.reader(t));
    const r = await run(reader, { generateSlug: (o: string) => (n++ === 0 ? "aaaa-dup-shop" : fallbackSlug(o)) });
    expect(r.status).toBe("complete");
    expect(n).toBe(2);
    expect((await registry()).find((x) => x.slug === "aaaa-dup-shop")!.tenant_id).toBe(other.id);
    expect(r.renames[0].to).not.toBe("aaaa-dup-shop");
  });
});

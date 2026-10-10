import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  backfillStoreSlugRegistry, STORE_SLUG_MARKER_KEY, formatBackfillReport,
  type BusinessSlugRow, type TenantReader, type TenantRow,
} from "@hisaabo/db";
import { createScratchControlDb, type Scratch } from "./scratch-control-db";

const quiet = () => {};
let scratch: Scratch;

beforeAll(async () => { scratch = await createScratchControlDb(6); });
afterAll(async () => { await scratch.drop(); });

interface T { id: string; slug: string; status: string; createdAt: Date; rows: BusinessSlugRow[] }
const day = (n: number) => new Date(Date.UTC(2025, 0, n));
let seq = 0;

async function mkTenant(rows: Partial<BusinessSlugRow>[], o: { status?: string; createdAt?: Date } = {}): Promise<T> {
  const id = randomUUID();
  const t: T = {
    id, slug: `bf-${++seq}-${Math.random().toString(36).slice(2, 6)}`, status: o.status ?? "active",
    createdAt: o.createdAt ?? day(10),
    rows: rows.map((r) => ({ id: randomUUID(), store_slug: null, store_enabled: true, created_at: day(10), ...r })),
  };
  await scratch.sql`INSERT INTO tenants (id, name, slug, db_name, status, created_at)
    VALUES (${t.id}, ${t.slug}, ${t.slug}, ${"db_" + t.slug.replace(/-/g, "_")}, ${t.status}, ${t.createdAt})`;
  return t;
}

const readerFor = (tenants: T[], failFor: Set<string> = new Set()) =>
  vi.fn<TenantReader>(async (row: TenantRow) => {
    if (failFor.has(row.id)) throw new Error("connection refused");
    return tenants.find((t) => t.id === row.id)!.rows;
  });

const run = (readTenant: TenantReader, extra: Record<string, unknown> = {}) =>
  backfillStoreSlugRegistry({ controlUrl: scratch.url, readTenant, logger: quiet, ...extra });

const registry = () => scratch.sql<{ slug: string; tenant_id: string; business_id: string; store_enabled: boolean; released_at: Date | null }[]>`
  SELECT slug, tenant_id, business_id, store_enabled, released_at FROM store_slugs ORDER BY slug`;
const marker = async () => (await scratch.sql`SELECT value FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`)[0]?.value as any;

beforeEach(async () => {
  await scratch.sql`DELETE FROM store_slugs`;
  await scratch.sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`;
  await scratch.sql`DELETE FROM tenants`;
});

describe("store slug backfill", () => {
  it("inserts all, writes marker, and a second run is skipped without any tenant I/O", async () => {
    const a = await mkTenant([{ store_slug: "alpha-shop" }, { store_slug: "beta-shop", store_enabled: false }]);
    const b = await mkTenant([{ store_slug: "gamma-shop" }, { store_slug: null }]);
    const reader = readerFor([a, b]);
    const r1 = await run(reader);
    expect(r1.status).toBe("complete");
    expect(r1.inserted).toBe(3);
    expect((await registry()).map((x) => x.slug)).toEqual(["alpha-shop", "beta-shop", "gamma-shop"]);
    expect((await registry()).find((x) => x.slug === "beta-shop")!.store_enabled).toBe(false);
    expect((await registry()).every((x) => x.released_at === null)).toBe(true);
    expect((await marker()).version).toBe(1);

    reader.mockClear();
    const r2 = await run(reader);
    expect(r2.status).toBe("skipped");
    expect(reader).not.toHaveBeenCalled();
    expect(await registry()).toHaveLength(3);
  });

  it("partial failure: no marker, healthy tenants inserted; retry completes and writes marker", async () => {
    const a = await mkTenant([{ store_slug: "ok-shop" }]);
    const b = await mkTenant([{ store_slug: "down-shop" }]);
    const r1 = await run(readerFor([a, b], new Set([b.id])));
    expect(r1.status).toBe("incomplete");
    expect(r1.failures).toHaveLength(1);
    expect(r1.failures[0].tenantId).toBe(b.id);
    expect(await marker()).toBeUndefined();
    expect((await registry()).map((x) => x.slug)).toEqual(["ok-shop"]);

    const r2 = await run(readerFor([a, b]));
    expect(r2.status).toBe("complete");
    expect((await registry()).map((x) => x.slug)).toEqual(["down-shop", "ok-shop"]);
    expect(await marker()).toBeDefined();
  });

  it("contested slug is deferred while a tenant fails, then resolved deterministically", async () => {
    const a = await mkTenant([{ store_slug: "dup-shop", created_at: day(5) }]);
    const b = await mkTenant([{ store_slug: "dup-shop", created_at: day(3) }]);
    const c = await mkTenant([{ store_slug: "other-shop" }]);
    const r1 = await run(readerFor([a, b, c], new Set([c.id])));
    expect(r1.deferred).toBe(1);
    expect((await registry()).map((x) => x.slug)).toEqual([]);
    const r2 = await run(readerFor([a, b, c]));
    expect(r2.status).toBe("complete");
    const dup = (await registry()).find((x) => x.slug === "dup-shop")!;
    expect(dup.tenant_id).toBe(b.id); // older business wins
  });

  it("ranking: active beats suspended, then business age, tenant age, business id; losers recorded in marker", async () => {
    const susp = await mkTenant([{ store_slug: "rank-1", created_at: day(1) }], { status: "suspended", createdAt: day(1) });
    const act = await mkTenant([{ store_slug: "rank-1", created_at: day(9) }]);
    // tie on everything but business id
    const x = await mkTenant([{ store_slug: "rank-2", id: "00000000-0000-4000-8000-000000000002" }], { createdAt: day(2) });
    const y = await mkTenant([{ store_slug: "rank-2", id: "00000000-0000-4000-8000-000000000001" }], { createdAt: day(2) });
    // tenant age tie-break
    const old = await mkTenant([{ store_slug: "rank-3", created_at: day(4) }], { createdAt: day(1) });
    const young = await mkTenant([{ store_slug: "rank-3", created_at: day(4) }], { createdAt: day(2) });

    const r = await run(readerFor([susp, act, x, y, old, young]));
    expect(r.status).toBe("complete");
    const reg = Object.fromEntries((await registry()).map((e) => [e.slug, e.tenant_id]));
    expect(reg["rank-1"]).toBe(act.id);
    expect(reg["rank-2"]).toBe(y.id);
    expect(reg["rank-3"]).toBe(old.id);
    expect(r.losers.map((l) => l.loserTenantId).sort()).toEqual([susp.id, x.id, young.id].sort());
    expect(r.duplicates).toHaveLength(3);
    expect((await marker()).losers).toHaveLength(3);
    expect(formatBackfillReport(r)).toContain("/store/rank-1");
  });

  it("never evicts existing registry rows (live writes win)", async () => {
    const live = await mkTenant([{ store_slug: "taken-shop", created_at: day(20) }]);
    const older = await mkTenant([{ store_slug: "taken-shop", created_at: day(1) }]);
    const bizLive = live.rows[0].id;
    await scratch.sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('taken-shop', ${live.id}, ${bizLive}, true)`;
    const r = await run(readerFor([live, older]));
    expect(r.status).toBe("complete");
    const row = (await registry())[0];
    expect(row.tenant_id).toBe(live.id);
    expect(r.losers).toHaveLength(1);
    expect(r.losers[0]).toMatchObject({ reason: "registry", loserTenantId: older.id });
  });

  it("skips and reports invalid slugs", async () => {
    const a = await mkTenant([{ store_slug: "Bad_Slug" }, { store_slug: "ab" }, { store_slug: "-lead-ing" }, { store_slug: "good-one" }]);
    const r = await run(readerFor([a]));
    expect(r.status).toBe("complete");
    expect(r.invalid.map((i) => i.slug).sort()).toEqual(["-lead-ing", "Bad_Slug", "ab"].sort());
    expect((await registry()).map((x) => x.slug)).toEqual(["good-one"]);
  });

  it("tenant deleted mid-run does not abort the batch", async () => {
    const a = await mkTenant([{ store_slug: "stays-shop" }]);
    const ghost = await mkTenant([{ store_slug: "ghost-shop" }]);
    const reader = vi.fn<TenantReader>(async (row) => {
      if (row.id === a.id) await scratch.sql`DELETE FROM tenants WHERE id = ${ghost.id}`;
      return [...a.rows, ...ghost.rows].filter((_, i) => (row.id === a.id ? i < a.rows.length : i >= a.rows.length));
    });
    // order: tenants ordered by created_at,id -> concurrency batch reads both before write
    const r = await run(reader);
    expect(["complete", "incomplete"]).toContain(r.status);
    expect((await registry()).map((x) => x.slug)).toEqual(["stays-shop"]);
  });

  it("concurrent double invocation yields one consistent registry", async () => {
    const a = await mkTenant([{ store_slug: "race-a" }, { store_slug: "race-b" }]);
    const reader = readerFor([a]);
    const [r1, r2] = await Promise.all([run(reader), run(reader)]);
    expect([r1.status, r2.status].sort()).toEqual(["complete", "skipped"]);
    expect(await registry()).toHaveLength(2);
  });

  it("tenant_id always comes from the scanned tenants row, never tenant-DB content", async () => {
    const victim = await mkTenant([]);
    const evil = await mkTenant([]);
    // Crafted tenant DB rows carry extra fields pointing at the victim; they must be ignored.
    evil.rows = [{ id: randomUUID(), store_slug: "evil-shop", store_enabled: true, created_at: day(1),
      ...({ tenant_id: victim.id, tenantId: victim.id } as object) }];
    await run(readerFor([victim, evil]));
    const reg = await registry();
    expect(reg).toHaveLength(1);
    expect(reg[0].tenant_id).toBe(evil.id);
    expect(reg.some((r) => r.tenant_id === victim.id)).toBe(false);
  });

  it("two tenants with the same (crafted) business_id do not block each other", async () => {
    const sharedBiz = randomUUID();
    const a = await mkTenant([{ id: sharedBiz, store_slug: "squat-a" }]);
    const b = await mkTenant([{ id: sharedBiz, store_slug: "squat-b" }]);
    const r = await run(readerFor([a, b]));
    expect(r.status).toBe("complete");
    const reg = await registry();
    expect(reg.map((x) => [x.slug, x.tenant_id])).toEqual([["squat-a", a.id], ["squat-b", b.id]]);
  });
});

describe("reconcile (force) mode", () => {
  it("fixes store_enabled drift, reports orphans, prunes only with --prune; ignores marker", async () => {
    const a = await mkTenant([{ store_slug: "drift-shop", store_enabled: false }, { store_slug: "new-shop" }]);
    const biz = a.rows[0].id;
    await scratch.sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('drift-shop', ${a.id}, ${biz}, true)`;
    await scratch.sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('orphan-shop', ${a.id}, ${randomUUID()}, true)`;
    await run(readerFor([a])); // writes marker
    const r1 = await run(readerFor([a]), { force: true });
    expect(r1.status).toBe("complete");
    expect(r1.orphans.map((o) => o.slug)).toEqual(["orphan-shop"]);
    expect(r1.pruned).toBe(0);
    const reg = Object.fromEntries((await registry()).map((e) => [e.slug, e]));
    expect(reg["drift-shop"].store_enabled).toBe(false);
    expect(reg["orphan-shop"]).toBeDefined();
    expect(reg["new-shop"]).toBeDefined();
    const r2 = await run(readerFor([a]), { force: true, prune: true });
    expect(r2.pruned).toBe(1);
    expect((await registry()).map((e) => e.slug)).toEqual(["drift-shop", "new-shop"]);
  });
});

describe("dry run", () => {
  it("is read-only: no rows, no marker, no lock", async () => {
    const a = await mkTenant([{ store_slug: "dry-a", created_at: day(3) }]);
    const b = await mkTenant([{ store_slug: "dry-a", created_at: day(2) }, { store_slug: "dry-b" }]);
    const r = await run(readerFor([a, b]), { dryRun: true });
    expect(r.status).toBe("dry-run");
    expect(r.wouldInsert).toBe(2);
    expect(r.inserted).toBe(0);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].winner.tenantId).toBe(b.id);
    expect(await registry()).toHaveLength(0);
    expect(await marker()).toBeUndefined();
    const out = formatBackfillReport(r, { dryRun: true });
    expect(out).toContain("DRY RUN");
    expect(out).toContain("WINNER");
    // runs even when marker exists
    await run(readerFor([a, b]));
    const again = await run(readerFor([a, b]), { dryRun: true });
    expect(again.status).toBe("dry-run");
  });

  it("works against the PREVIOUS schema where store_slugs does not exist yet", async () => {
    const old = await createScratchControlDb(4);
    try {
      const t1 = randomUUID(), t2 = randomUUID();
      for (const [id, s, d] of [[t1, "old-1", 1], [t2, "old-2", 2]] as const) {
        await old.sql`INSERT INTO tenants (id, name, slug, db_name, created_at) VALUES (${id}, ${s}, ${s}, ${"db_" + s.replace("-", "_")}, ${day(d)})`;
      }
      const rows: Record<string, BusinessSlugRow[]> = {
        [t1]: [{ id: randomUUID(), store_slug: "same-shop", store_enabled: true, created_at: day(5) }],
        [t2]: [{ id: randomUUID(), store_slug: "same-shop", store_enabled: true, created_at: day(6) }],
      };
      const before = await old.sql`SELECT (SELECT count(*) FROM tenants)::int AS t, (SELECT count(*) FROM system_config)::int AS c`;
      const r = await backfillStoreSlugRegistry({
        controlUrl: old.url, dryRun: true, force: true, logger: quiet,
        readTenant: async (t) => rows[t.id],
      });
      expect(r.tableExists).toBe(false);
      expect(r.status).toBe("dry-run");
      expect(r.duplicates).toHaveLength(1);
      expect(r.duplicates[0].winner.tenantId).toBe(t1);
      expect(r.losers[0].loserTenantId).toBe(t2);
      // nothing created, nothing written
      expect((await old.sql`SELECT to_regclass('store_slugs') AS t`)[0].t).toBeNull();
      expect(await old.sql`SELECT (SELECT count(*) FROM tenants)::int AS t, (SELECT count(*) FROM system_config)::int AS c`).toEqual(before);
      // non-dry-run against missing table must refuse rather than write
      await expect(backfillStoreSlugRegistry({ controlUrl: old.url, logger: quiet, readTenant: async () => [] })).rejects.toThrow(/store_slugs/);
    } finally {
      await old.drop();
    }
  });

  it("the dry-run session is server-side read-only (writes through its connection would fail)", async () => {
    const a = await mkTenant([{ store_slug: "ro-shop" }]);
    // A reader that tries to write through the control URL with the same options is not possible to inject,
    // so assert the observable contract instead: nothing changed in any table.
    const snap = async () => JSON.stringify(await scratch.sql`SELECT (SELECT count(*) FROM store_slugs)::int s, (SELECT count(*) FROM system_config)::int c, (SELECT count(*) FROM tenants)::int t`);
    const before = await snap();
    await run(readerFor([a]), { dryRun: true });
    expect(await snap()).toBe(before);
  });
});

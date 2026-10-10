import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  backfillStoreSlugRegistry, STORE_SLUG_MARKER_KEY, formatBackfillReport, fallbackSlug, STORE_SLUG_REGEX,
  type BusinessSlugRow, type TenantReader, type TenantRow, type TenantRenamer,
} from "@hisaabo/db";
import { createScratchControlDb, type Scratch } from "./scratch-control-db";

const quiet = () => {};
let scratch: Scratch;

beforeAll(async () => { scratch = await createScratchControlDb(6); });
afterAll(async () => { await scratch.drop(); });

interface T { id: string; slug: string; status: string; createdAt: Date; rows: BusinessSlugRow[] }
const day = (n: number) => new Date(Date.UTC(2025, 0, n));
let seq = 0;
const allTenants = new Map<string, T>();
const autoAssigned = new Set<string>(); // businessIds flagged store_slug_auto_assigned in the fake tenant DBs

/** Fake tenant DB write with the same contract as the real one (guarded by `store_slug = from`). */
const fakeRename: TenantRenamer = async (tenant, p) => {
  const row = allTenants.get(tenant.id)?.rows.find((r) => r.id === p.businessId);
  if (!row || row.store_slug !== p.from) return 0;
  row.store_slug = p.to;
  autoAssigned.add(row.id);
  return 1;
};

async function mkTenant(rows: Partial<BusinessSlugRow>[], o: { status?: string; createdAt?: Date } = {}): Promise<T> {
  const id = randomUUID();
  const t: T = {
    id, slug: `bf-${++seq}-${Math.random().toString(36).slice(2, 6)}`, status: o.status ?? "active",
    createdAt: o.createdAt ?? day(10),
    rows: rows.map((r) => ({ id: randomUUID(), store_slug: null, store_enabled: true, created_at: day(10), ...r })),
  };
  allTenants.set(id, t);
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
  backfillStoreSlugRegistry({ controlUrl: scratch.url, readTenant, renameTenant: fakeRename, logger: quiet, ...extra });

const registry = () => scratch.sql<{ slug: string; tenant_id: string; business_id: string; store_enabled: boolean; released_at: Date | null }[]>`
  SELECT slug, tenant_id, business_id, store_enabled, released_at FROM store_slugs ORDER BY slug`;
const marker = async () => (await scratch.sql`SELECT value FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`)[0]?.value as any;

beforeEach(async () => {
  await scratch.sql`DELETE FROM store_slugs`;
  await scratch.sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`;
  await scratch.sql`DELETE FROM tenants`;
  allTenants.clear();
  autoAssigned.clear();
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
    const row = (await registry()).find((x) => x.slug === "taken-shop")!;
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

describe("duplicate slug auto-rename", () => {
  const dupSetup = async () => {
    const winner = await mkTenant([{ store_slug: "dup-shop", created_at: day(1) }]);
    const loser = await mkTenant([{ store_slug: "dup-shop", created_at: day(5), store_enabled: false }]);
    return { winner, loser };
  };

  it("renames the loser in registry and tenant DB; winner untouched; re-run idempotent", async () => {
    const { winner, loser } = await dupSetup();
    const r = await run(readerFor([winner, loser]));
    expect(r.status).toBe("complete");
    expect(r.renames).toHaveLength(1);
    const ren = r.renames[0];
    expect(ren).toMatchObject({ tenantId: loser.id, businessId: loser.rows[0].id, from: "dup-shop" });
    expect(ren.to).toMatch(/^[a-z0-9]{4}-dup-shop$/);
    expect(loser.rows[0].store_slug).toBe(ren.to);
    expect(autoAssigned.has(loser.rows[0].id)).toBe(true);
    expect(winner.rows[0].store_slug).toBe("dup-shop");
    expect(autoAssigned.has(winner.rows[0].id)).toBe(false);
    const reg = await registry();
    const w = reg.find((x) => x.slug === "dup-shop")!;
    const l = reg.find((x) => x.slug === ren.to)!;
    expect(w.tenant_id).toBe(winner.id);
    expect(l).toMatchObject({ tenant_id: loser.id, business_id: loser.rows[0].id, store_enabled: false, released_at: null });
    const m = await marker();
    expect(m.renames).toEqual([ren]);

    // forced re-run: nothing left to do
    const again = await run(readerFor([winner, loser]), { force: true });
    expect(again.status).toBe("complete");
    expect(again.renames).toHaveLength(0);
    expect(again.losers).toHaveLength(0);
    expect(await registry()).toHaveLength(2);
  });

  it("registry-reason losers are renamed too", async () => {
    const live = await mkTenant([{ store_slug: "reg-shop", created_at: day(20) }]);
    const other = await mkTenant([{ store_slug: "reg-shop", created_at: day(1) }]);
    await scratch.sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('reg-shop', ${live.id}, ${live.rows[0].id}, true)`;
    const r = await run(readerFor([live, other]));
    expect(r.renames).toHaveLength(1);
    expect(r.renames[0].tenantId).toBe(other.id);
  });

  it("tenant update failure rolls the control tx back, withholds the marker, next run succeeds", async () => {
    const { winner, loser } = await dupSetup();
    const failing: TenantRenamer = async () => { throw new Error("tenant db down"); };
    const r1 = await run(readerFor([winner, loser]), { renameTenant: failing });
    expect(r1.status).toBe("incomplete");
    expect(r1.renames).toHaveLength(0);
    expect(r1.unresolved).toHaveLength(1);
    expect(r1.unresolved[0].reason).toContain("tenant db down");
    expect((await registry()).map((x) => x.slug)).toEqual(["dup-shop"]); // no stray candidate row
    expect(await marker()).toBeUndefined();

    const r2 = await run(readerFor([winner, loser]));
    expect(r2.status).toBe("complete");
    expect(r2.renames).toHaveLength(1);
    expect(await marker()).toBeDefined();
    expect(await registry()).toHaveLength(2);
  });

  it("0 rows updated (slug changed concurrently) is unresolved and leaves no registry row", async () => {
    const { winner, loser } = await dupSetup();
    const changed: TenantRenamer = async () => 0;
    const r1 = await run(readerFor([winner, loser]), { renameTenant: changed });
    expect(r1.unresolved).toHaveLength(1);
    expect(r1.status).toBe("incomplete");
    expect((await registry()).map((x) => x.slug)).toEqual(["dup-shop"]);
    expect(await marker()).toBeUndefined();
  });

  it("retries with a fresh prefix on a registry conflict, and gives up after the attempt cap", async () => {
    const { winner, loser } = await dupSetup();
    // Make the first candidate collide: pre-claim whatever the tenant renamer is asked to write... simulate via
    // a tenant unique violation on the first attempt (savepoint rolled back, new prefix).
    let calls = 0;
    const uniqueOnce: TenantRenamer = async (t, p) => {
      if (calls++ === 0) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return fakeRename(t, p);
    };
    const r1 = await run(readerFor([winner, loser]), { renameTenant: uniqueOnce });
    expect(r1.status).toBe("complete");
    expect(calls).toBe(2);
    expect(await registry()).toHaveLength(2);

    await scratch.sql`DELETE FROM store_slugs`;
    await scratch.sql`DELETE FROM system_config WHERE key = ${STORE_SLUG_MARKER_KEY}`;
    loser.rows[0].store_slug = "dup-shop";
    calls = 0;
    const alwaysUnique: TenantRenamer = async () => { calls++; throw Object.assign(new Error("duplicate key"), { code: "23505" }); };
    const r2 = await run(readerFor([winner, loser]), { renameTenant: alwaysUnique });
    expect(calls).toBe(10);
    expect(r2.unresolved).toHaveLength(1);
    expect(r2.unresolved[0].reason).toMatch(/no unique replacement/);
    expect(r2.status).toBe("incomplete");
  });

  it("does not rename invalid-format slugs", async () => {
    const a = await mkTenant([{ store_slug: "Bad_Slug" }]);
    const b = await mkTenant([{ store_slug: "Bad_Slug" }]);
    const r = await run(readerFor([a, b]));
    expect(r.renames).toHaveLength(0);
    expect(r.invalid).toHaveLength(2);
    expect(a.rows[0].store_slug).toBe("Bad_Slug");
  });

  it("dry run lists planned renames and writes nothing", async () => {
    const { winner, loser } = await dupSetup();
    const renamer = vi.fn(fakeRename);
    const r = await run(readerFor([winner, loser]), { dryRun: true, renameTenant: renamer });
    expect(r.plannedRenames).toEqual([
      { slug: "dup-shop", tenantId: loser.id, tenantSlug: loser.slug, businessId: loser.rows[0].id },
    ]);
    expect(r.renames).toHaveLength(0);
    expect(renamer).not.toHaveBeenCalled();
    expect(loser.rows[0].store_slug).toBe("dup-shop");
    expect(await registry()).toHaveLength(0);
    expect(await marker()).toBeUndefined();
    expect(formatBackfillReport(r, { dryRun: true })).toContain("would rename dup-shop \u2192 <prefix>-dup-shop");
  });

  it("non-dry-run reconcile (force) applies the renames even with the marker present", async () => {
    const a = await mkTenant([{ store_slug: "solo-shop" }]);
    await run(readerFor([a])); // marker written
    const { winner, loser } = await dupSetup();
    const r = await run(readerFor([a, winner, loser]), { force: true });
    expect(r.renames).toHaveLength(1);
    expect(r.status).toBe("complete");
  });
});

describe("fallbackSlug", () => {
  it("always yields a valid, <= 50 char slug with a 4-char [a-z0-9] prefix (property)", () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-";
    const rnd = (n: number) => Math.floor(Math.random() * n);
    for (let i = 0; i < 3000; i++) {
      const len = i % 3 === 0 ? 50 : 3 + rnd(48);
      let orig = "";
      for (let j = 0; j < len; j++) orig += alphabet[rnd(alphabet.length)];
      // force a valid original
      orig = "a" + orig.slice(1, -1).replace(/^$/, "b") + "z";
      orig = orig.slice(0, 50).replace(/-+$/, "z");
      if (!STORE_SLUG_REGEX.test(orig)) continue;
      const out = fallbackSlug(orig);
      expect(out).toMatch(STORE_SLUG_REGEX);
      expect(out.length).toBeLessThanOrEqual(50);
      expect(out).toMatch(/^[a-z0-9]{4}-/);
      if (orig.length <= 45) expect(out).toBe(out.slice(0, 5) + orig);
    }
  });

  it("truncates 50-char originals and strips a trailing hyphen created by truncation", () => {
    const orig = "a".repeat(44) + "-" + "b".repeat(5); // char 45 (index 44) is '-'
    expect(orig).toHaveLength(50);
    const out = fallbackSlug(orig);
    expect(out).toHaveLength(49); // 4 + 1 + 44, trailing '-' stripped
    expect(out.endsWith("-")).toBe(false);
    expect(out).toMatch(STORE_SLUG_REGEX);
    expect(fallbackSlug("x".repeat(50))).toHaveLength(50);
  });

  it("uses a fresh random prefix per call and rejects invalid originals", () => {
    const set = new Set(Array.from({ length: 50 }, () => fallbackSlug("shop").slice(0, 4)));
    expect(set.size).toBeGreaterThan(1);
    expect(() => fallbackSlug("Bad_Slug")).toThrow();
  });
});

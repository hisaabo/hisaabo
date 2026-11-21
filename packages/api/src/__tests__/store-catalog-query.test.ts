/**
 * store-catalog-query.test.ts — the `?ids=` filter on the public
 * `GET /store/:slug/catalog.json` route.
 *
 * The route in server.ts delegates its query parsing and WHERE conditions to
 * lib/store-catalog-query.ts (server.ts starts listening on import, so it
 * cannot be imported in tests). The route answers 400 when `parseCatalogIds`
 * returns `ok: false`, so those cases cover "non-UUID -> 400" and
 * ">50 ids -> 400"; the DB cases run the route's real conditions against
 * Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { items, type TenantDatabase } from "@hisaabo/db";
import { createTestWorld, createItem, type TestWorld } from "./helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import {
  MAX_CATALOG_IDS,
  MAX_SEARCH_LENGTH,
  capSearch,
  parseCatalogIds,
  storeCatalogConditions,
} from "../lib/store-catalog-query.js";

describe("parseCatalogIds", () => {
  it("returns no filter when the parameter is absent", () => {
    expect(parseCatalogIds(undefined)).toEqual({ ok: true, ids: null });
  });

  it("accepts a single id and a comma-separated list", () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(parseCatalogIds(a)).toEqual({ ok: true, ids: [a] });
    expect(parseCatalogIds(`${a},${b}`)).toEqual({ ok: true, ids: [a, b] });
  });

  it("lower-cases, trims and de-duplicates, keeping first-seen order", () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(parseCatalogIds(` ${a.toUpperCase()} , ${b},${a}`)).toEqual({ ok: true, ids: [a, b] });
  });

  it("accepts exactly the maximum number of ids", () => {
    const ids = Array.from({ length: MAX_CATALOG_IDS }, () => randomUUID());
    expect(parseCatalogIds(ids.join(","))).toEqual({ ok: true, ids });
  });

  it("rejects more than the maximum number of distinct ids", () => {
    const ids = Array.from({ length: MAX_CATALOG_IDS + 1 }, () => randomUUID());
    const res = parseCatalogIds(ids.join(","));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(String(MAX_CATALOG_IDS));
  });

  it("counts distinct ids, so repeated ids do not trip the limit", () => {
    const id = randomUUID();
    expect(parseCatalogIds(Array(MAX_CATALOG_IDS + 10).fill(id).join(","))).toEqual({ ok: true, ids: [id] });
  });

  it.each([
    ["a non-UUID", "not-a-uuid"],
    ["a UUID with a stray suffix", `${randomUUID()}x`],
    ["one bad id among good ones", `${randomUUID()},nope`],
    ["an empty value", ""],
    ["a blank entry", `${randomUUID()},,${randomUUID()}`],
    ["a trailing comma", `${randomUUID()},`],
    ["SQL metacharacters", "' OR 1=1 --"],
  ])("rejects %s", (_label, raw) => {
    const res = parseCatalogIds(raw);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/UUID/);
  });
});

describe("capSearch", () => {
  it("leaves terms up to the limit alone", () => {
    expect(capSearch("")).toBe("");
    expect(capSearch("rice")).toBe("rice");
    expect(capSearch("a".repeat(MAX_SEARCH_LENGTH))).toBe("a".repeat(MAX_SEARCH_LENGTH));
  });

  it("truncates longer terms to the limit", () => {
    expect(capSearch("a".repeat(MAX_SEARCH_LENGTH + 1))).toBe("a".repeat(MAX_SEARCH_LENGTH));
    expect(capSearch("a".repeat(100) + "b".repeat(100))).toBe("a".repeat(100));
  });

  it("does not leave half a surrogate pair at the cut", () => {
    const capped = capSearch("a".repeat(MAX_SEARCH_LENGTH - 1) + "\u{1F35A}" + "tail");
    expect(capped).toBe("a".repeat(MAX_SEARCH_LENGTH - 1));
    expect(capped).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe("storeCatalogConditions — ids filter against the database", () => {
  let world: TestWorld;
  const db = () => getTenantTestDb() as unknown as TenantDatabase;

  let enabledA: string;
  let enabledB: string;
  let disabled: string;
  let softDeleted: string;
  let otherBusiness: string;

  beforeAll(async () => {
    world = await createTestWorld();
    const tdb = getTenantTestDb();
    const bid = world.business1.id;
    enabledA = (await createItem(tdb, bid, { name: "Catalog Ids Alpha", storeEnabled: true })).id;
    enabledB = (await createItem(tdb, bid, { name: "Catalog Ids Beta", storeEnabled: true })).id;
    disabled = (await createItem(tdb, bid, { name: "Catalog Ids Hidden", storeEnabled: false })).id;
    softDeleted = (await createItem(tdb, bid, { name: "Catalog Ids Deleted", storeEnabled: true })).id;
    await db().update(items).set({ deletedAt: new Date() }).where(eq(items.id, softDeleted));
    otherBusiness = (await createItem(tdb, world.business2.id, { name: "Catalog Ids Elsewhere", storeEnabled: true })).id;
  });

  afterAll(async () => {
    await truncateAllTables();
    await closeTestDb();
  });

  async function select(filters: { category?: string; search?: string; ids?: string[] | null }) {
    const { conditions } = storeCatalogConditions(world.business1.id, filters);
    const rows = await db().select({ id: items.id }).from(items).where(and(...conditions));
    return rows.map((r) => r.id).sort();
  }

  it("without ids returns every published item of the business", async () => {
    expect(await select({})).toEqual([enabledA, enabledB].sort());
  });

  it("with ids returns only the named published items", async () => {
    expect(await select({ ids: [enabledA] })).toEqual([enabledA]);
    expect(await select({ ids: [enabledA, enabledB] })).toEqual([enabledA, enabledB].sort());
  });

  it("excludes items not enabled for the store, even when named", async () => {
    expect(await select({ ids: [enabledA, disabled] })).toEqual([enabledA]);
  });

  it("excludes soft-deleted items, even when named", async () => {
    expect(await select({ ids: [enabledB, softDeleted] })).toEqual([enabledB]);
  });

  it("excludes other businesses' items, even when named", async () => {
    expect(await select({ ids: [enabledA, otherBusiness] })).toEqual([enabledA]);
  });

  it("ignores unknown ids", async () => {
    expect(await select({ ids: [randomUUID()] })).toEqual([]);
    expect(await select({ ids: [enabledB, randomUUID()] })).toEqual([enabledB]);
  });

  it("combines with the search filter", async () => {
    expect(await select({ ids: [enabledA, enabledB], search: "beta" })).toEqual([enabledB]);
  });

  it("honours the first 100 characters of an over-long search", async () => {
    const name = `${"q".repeat(MAX_SEARCH_LENGTH)} long-named item`;
    const longNamed = (await createItem(getTenantTestDb(), world.business1.id, { name, storeEnabled: true })).id;
    // 200 characters: the first 100 match the item, the rest would match nothing.
    expect(await select({ search: "q".repeat(MAX_SEARCH_LENGTH) + "z".repeat(MAX_SEARCH_LENGTH) })).toEqual([longNamed]);
    // Still a plain substring match within the cap.
    expect(await select({ search: "Catalog Ids Alp" })).toEqual([enabledA]);
  });

  it("does not truncate category: a long category still matches whole", async () => {
    const category = "c".repeat(150);
    const inCategory = (
      await createItem(getTenantTestDb(), world.business1.id, { name: "Long Category Item", storeEnabled: true, storeCategory: category })
    ).id;
    expect(await select({ category })).toEqual([inCategory]);
    // A prefix is a different category, not a match.
    expect(await select({ category: category.slice(0, 100) })).toEqual([]);
  });

  it("keeps the category-chip base conditions free of the ids/search filters", () => {
    const { baseConditions, conditions } = storeCatalogConditions(world.business1.id, {
      ids: [enabledA],
      search: "x",
      category: "y",
    });
    expect(baseConditions).toHaveLength(3);
    expect(conditions).toHaveLength(6);
  });
});

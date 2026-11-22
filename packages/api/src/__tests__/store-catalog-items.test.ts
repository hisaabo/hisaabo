/**
 * store-catalog-items.test.ts — what the public store catalog says about stock.
 *
 * `lowStock` in `GET /store/:slug/catalog.json` is `allowNegativeStock && !inStock`
 * ("none on hand, orders accepted"), so a store that holds no inventory reports
 * it on every item. `runningLow` is the additive signal for a real "Low stock"
 * badge: tracked stock, some on hand, at or below the owner's alert level.
 *
 * The route in server.ts cannot be imported in tests (it starts listening), so
 * its row-to-JSON step lives in lib/store-catalog-items.ts and is exercised
 * here, first on in-memory rows, then on rows read back from Postgres (where
 * numeric columns arrive as strings like "10.000").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { items, itemVariants, type TenantDatabase } from "@hisaabo/db";
import { createTestWorld, createItem, type TestWorld } from "./helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { isRunningLow, variantsRunningLow, type StockRow } from "../lib/store-stock.js";
import {
  toPublicCatalogItems,
  type CatalogRow,
  type CatalogVariantRow,
} from "../lib/store-catalog-items.js";
import { storeCatalogConditions } from "../lib/store-catalog-query.js";

const stock = (over: Partial<StockRow>): StockRow => ({
  stockQuantity: "5.000",
  lowStockAlert: "10.000",
  itemType: "product",
  ...over,
});

describe("isRunningLow", () => {
  it("is true for tracked stock on hand at or below the alert level", () => {
    expect(isRunningLow(stock({ stockQuantity: "5.000", lowStockAlert: "10.000" }))).toBe(true);
    expect(isRunningLow(stock({ stockQuantity: "10.000", lowStockAlert: "10.000" }))).toBe(true);
    expect(isRunningLow(stock({ stockQuantity: "0.500", lowStockAlert: "1.000" }))).toBe(true);
    expect(isRunningLow(stock({ stockQuantity: "0.001", lowStockAlert: "0.001" }))).toBe(true);
  });

  it("is false above the alert level", () => {
    expect(isRunningLow(stock({ stockQuantity: "10.001", lowStockAlert: "10.000" }))).toBe(false);
    expect(isRunningLow(stock({ stockQuantity: "250.000", lowStockAlert: "10.000" }))).toBe(false);
  });

  it("is false with nothing on hand: that is sold out, or orderable with none, never 'low'", () => {
    expect(isRunningLow(stock({ stockQuantity: "0.000" }))).toBe(false);
    expect(isRunningLow(stock({ stockQuantity: "-3.000" }))).toBe(false);
    expect(isRunningLow(stock({ stockQuantity: "0.000", lowStockAlert: "0.000" }))).toBe(false);
  });

  it("is false when the owner set no alert level", () => {
    expect(isRunningLow(stock({ lowStockAlert: null }))).toBe(false);
    expect(isRunningLow(stock({ lowStockAlert: "" }))).toBe(false);
  });

  it("is false for a service: services do not track stock", () => {
    expect(isRunningLow(stock({ itemType: "service" }))).toBe(false);
  });

  it("is false for values that are not numbers", () => {
    expect(isRunningLow(stock({ stockQuantity: "abc" }))).toBe(false);
    expect(isRunningLow(stock({ lowStockAlert: "abc" }))).toBe(false);
  });
});

describe("variantsRunningLow", () => {
  it("is true only when everything still buyable is running low", () => {
    expect(variantsRunningLow([{ inStock: true, runningLow: true }, { inStock: true, runningLow: true }])).toBe(true);
    // A sold-out variant does not count either way.
    expect(variantsRunningLow([{ inStock: true, runningLow: true }, { inStock: false, runningLow: false }])).toBe(true);
  });

  it("is false when any buyable variant has plenty", () => {
    expect(variantsRunningLow([{ inStock: true, runningLow: true }, { inStock: true, runningLow: false }])).toBe(false);
  });

  it("is false when nothing can be bought, or there are no variants", () => {
    expect(variantsRunningLow([{ inStock: false, runningLow: false }])).toBe(false);
    expect(variantsRunningLow([])).toBe(false);
  });
});

// ── The public item shape ───────────────────────────────────────────────────

const row = (over: Partial<CatalogRow> & { id: string }): CatalogRow & Record<string, unknown> => ({
  name: "Item",
  description: null,
  price: "100.00",
  unit: "kg",
  category: null,
  taxPercent: "0.00",
  taxInclusive: false,
  sortOrder: 0,
  itemMode: "simple",
  inStock: true,
  stockQty: "50.000",
  lowStockAlert: null,
  itemType: "product",
  unitVariants: null,
  variantAttributes: null,
  ...over,
});

const variant = (over: Partial<CatalogVariantRow> & { id: string; itemId: string }): CatalogVariantRow => ({
  attributeValues: { Size: "M" },
  salePrice: "100.00",
  storePrice: null,
  stockQuantity: "50.000",
  lowStockAlert: null,
  ...over,
});

function build(rows: Array<CatalogRow & Record<string, unknown>>, variants: CatalogVariantRow[] = [], allowNegativeStock = false) {
  const variantsByItem = new Map<string, CatalogVariantRow[]>();
  for (const v of variants) variantsByItem.set(v.itemId, [...(variantsByItem.get(v.itemId) ?? []), v]);
  return toPublicCatalogItems(rows, { allowNegativeStock, variantsByItem, imagesByItem: new Map() });
}

describe("toPublicCatalogItems — runningLow", () => {
  it("is true only for a tracked item on hand at or below its alert level", () => {
    const [low, plenty, untracked, soldOut] = build([
      row({ id: "low", stockQty: "4.000", lowStockAlert: "5.000" }),
      row({ id: "plenty", stockQty: "40.000", lowStockAlert: "5.000" }),
      row({ id: "untracked", stockQty: "4.000", lowStockAlert: null }),
      row({ id: "out", stockQty: "0.000", lowStockAlert: "5.000", inStock: false }),
    ]);
    expect(low.runningLow).toBe(true);
    expect(plenty.runningLow).toBe(false);
    expect(untracked.runningLow).toBe(false);
    expect(soldOut.runningLow).toBe(false);
  });

  it("leaves lowStock exactly as it was: orderable with none on hand, whatever runningLow says", () => {
    // A store that keeps no inventory and takes orders anyway: every item has
    // stock 0, so every item is inStock + lowStock, and none is running low.
    const stockless = build(
      [row({ id: "a", stockQty: "0.000", inStock: false }), row({ id: "b", stockQty: "0.000", inStock: false, lowStockAlert: "5.000" })],
      [],
      true,
    );
    for (const item of stockless) {
      expect(item.inStock).toBe(true);
      expect(item.lowStock).toBe(true);
      expect(item.runningLow).toBe(false);
    }
    // Without negative stock the same items are plainly sold out.
    const strict = build([row({ id: "a", stockQty: "0.000", inStock: false })]);
    expect(strict[0]).toMatchObject({ inStock: false, lowStock: false, runningLow: false });
  });

  it("can be low and in stock at the same time on a store that takes orders without stock", () => {
    const [item] = build([row({ id: "a", stockQty: "2.000", lowStockAlert: "5.000" })], [], true);
    expect(item).toMatchObject({ inStock: true, lowStock: false, runningLow: true });
  });

  it("is false for a service even with stock and an alert level set", () => {
    const [item] = build([row({ id: "svc", itemType: "service", stockQty: "1.000", lowStockAlert: "5.000" })]);
    expect(item.runningLow).toBe(false);
  });

  it("is always a boolean, so clients never see it missing", () => {
    for (const item of build([row({ id: "a" }), row({ id: "b", stockQty: "1.000", lowStockAlert: "5.000" })])) {
      expect(typeof item.runningLow).toBe("boolean");
    }
  });
});

describe("toPublicCatalogItems — variants", () => {
  const parent = row({ id: "p", itemMode: "variants", variantAttributes: ["Size"], inStock: false, stockQty: "0.000" });

  it("flags each variant on its own stock and alert level", () => {
    const [item] = build([parent], [
      variant({ id: "s", itemId: "p", attributeValues: { Size: "S" }, stockQuantity: "2.000", lowStockAlert: "5.000" }),
      variant({ id: "m", itemId: "p", attributeValues: { Size: "M" }, stockQuantity: "30.000", lowStockAlert: "5.000" }),
      variant({ id: "l", itemId: "p", attributeValues: { Size: "L" }, stockQuantity: "2.000", lowStockAlert: null }),
    ]);
    const byId = Object.fromEntries((item as unknown as { variants: Array<{ id: string; runningLow: boolean }> }).variants.map((v) => [v.id, v.runningLow]));
    expect(byId).toEqual({ s: true, m: false, l: false });
  });

  it("flags the item only when everything still buyable is low", () => {
    const allLow = build([parent], [
      variant({ id: "s", itemId: "p", stockQuantity: "2.000", lowStockAlert: "5.000" }),
      variant({ id: "m", itemId: "p", stockQuantity: "3.000", lowStockAlert: "5.000" }),
      variant({ id: "xl", itemId: "p", stockQuantity: "0.000", lowStockAlert: "5.000" }), // sold out: ignored
    ]);
    expect(allLow[0].runningLow).toBe(true);

    const mixed = build([parent], [
      variant({ id: "s", itemId: "p", stockQuantity: "2.000", lowStockAlert: "5.000" }),
      variant({ id: "m", itemId: "p", stockQuantity: "30.000", lowStockAlert: "5.000" }),
    ]);
    expect(mixed[0].runningLow).toBe(false);
  });

  it("does not call a merely orderable variant low on a store that takes orders without stock", () => {
    const [item] = build([parent], [
      variant({ id: "s", itemId: "p", stockQuantity: "0.000", lowStockAlert: "5.000" }),
    ], true);
    expect(item.inStock).toBe(true);
    expect(item.runningLow).toBe(false);
    expect((item as unknown as { variants: Array<{ runningLow: boolean }> }).variants[0].runningLow).toBe(false);
  });
});

describe("toPublicCatalogItems — nothing internal leaks", () => {
  it("drops quantities, alert levels and the item type from items and variants", () => {
    const out = build(
      [
        row({ id: "simple", stockQty: "4.000", lowStockAlert: "5.000" }),
        row({ id: "p", itemMode: "variants", variantAttributes: ["Size"], stockQty: "0.000", inStock: false }),
      ],
      [variant({ id: "v", itemId: "p", stockQuantity: "2.000", lowStockAlert: "5.000" })],
    );
    const json = JSON.stringify(out);
    for (const key of ["stockQty", "stockQuantity", "lowStockAlert", "itemType"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    // The numbers themselves are not in the output either.
    expect(json).not.toContain("4.000");
    expect(json).not.toContain("2.000");
  });
});

// ── Against Postgres ────────────────────────────────────────────────────────

describe("toPublicCatalogItems — rows read back from the database", () => {
  let world: TestWorld;
  const db = () => getTenantTestDb() as unknown as TenantDatabase;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    world = await createTestWorld();
    const tdb = getTenantTestDb();
    const make = async (key: string, over: Parameters<typeof createItem>[2]) => {
      ids[key] = (await createItem(tdb, world.business1.id, { storeEnabled: true, name: `Stock ${key}`, ...over })).id;
    };
    await make("low", { stockQuantity: "4.000", lowStockAlert: "5.000" });
    await make("edge", { stockQuantity: "5.000", lowStockAlert: "5.000" });
    await make("plenty", { stockQuantity: "400.000", lowStockAlert: "5.000" });
    await make("noAlert", { stockQuantity: "4.000" });
    await make("empty", { stockQuantity: "0.000", lowStockAlert: "5.000" });
    await make("service", { itemType: "service", stockQuantity: "1.000", lowStockAlert: "5.000" });
    await make("fractional", { stockQuantity: "0.250", lowStockAlert: "0.500", unit: "kg" });
    await make("variants", { itemMode: "variants", variantAttributes: ["Size"], stockQuantity: "0.000" });

    await db().insert(itemVariants).values([
      { itemId: ids.variants, attributeValues: { Size: "S" }, salePrice: "10.00", stockQuantity: "2.000", lowStockAlert: "5.000", storeEnabled: true },
      { itemId: ids.variants, attributeValues: { Size: "M" }, salePrice: "10.00", stockQuantity: "3.000", lowStockAlert: "5.000", storeEnabled: true },
    ]);
  });

  afterAll(async () => {
    await truncateAllTables();
    await closeTestDb();
  });

  /** The same columns the catalog route reads, for the same published rows. */
  async function publicCatalog(allowNegativeStock = false) {
    const { conditions } = storeCatalogConditions(world.business1.id, {});
    const rows = await db()
      .select({
        id: items.id,
        name: items.name,
        price: items.salePrice,
        inStock: items.stockQuantity,
        stockQty: items.stockQuantity,
        lowStockAlert: items.lowStockAlert,
        itemType: items.itemType,
        itemMode: items.itemMode,
        unitVariants: items.unitVariants,
        variantAttributes: items.variantAttributes,
      })
      .from(items)
      .where(and(...conditions));
    const variantRows = await db()
      .select({
        id: itemVariants.id,
        itemId: itemVariants.itemId,
        attributeValues: itemVariants.attributeValues,
        salePrice: itemVariants.salePrice,
        storePrice: itemVariants.storePrice,
        stockQuantity: itemVariants.stockQuantity,
        lowStockAlert: itemVariants.lowStockAlert,
      })
      .from(itemVariants)
      .where(and(inArray(itemVariants.itemId, [ids.variants]), eq(itemVariants.storeEnabled, true)));
    const variantsByItem = new Map<string, CatalogVariantRow[]>([[ids.variants, variantRows]]);
    const publicItems = toPublicCatalogItems(
      rows.map((r) => ({ ...r, inStock: parseFloat(r.inStock) > 0 })),
      { allowNegativeStock, variantsByItem, imagesByItem: new Map() },
    );
    return Object.fromEntries(
      publicItems.map((i) => [Object.entries(ids).find(([, id]) => id === i.id)![0], i]),
    );
  }

  it("marks exactly the tracked items that are on hand and at or below their alert level", async () => {
    const catalog = await publicCatalog();
    expect(Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.runningLow]))).toEqual({
      low: true,
      edge: true,
      plenty: false,
      noAlert: false,
      empty: false,
      service: false,
      fractional: true,
      // S and M are both buyable and both low.
      variants: true,
    });
  });

  it("keeps lowStock meaning 'none on hand, orders accepted' beside it", async () => {
    const catalog = await publicCatalog(true);
    expect(catalog.empty).toMatchObject({ inStock: true, lowStock: true, runningLow: false });
    expect(catalog.low).toMatchObject({ inStock: true, lowStock: false, runningLow: true });
    expect(catalog.plenty).toMatchObject({ inStock: true, lowStock: false, runningLow: false });
  });

  it("never sends the quantity or the alert level", async () => {
    const json = JSON.stringify(await publicCatalog());
    for (const key of ["stockQty", "stockQuantity", "lowStockAlert", "itemType"]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });
});

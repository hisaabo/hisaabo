/**
 * POS catalog tile-expansion unit tests.
 *
 * `expandItemsToTiles` is the heart of `pos.catalog` — it turns database
 * rows into the flat list of sellable tiles the cashier sees on the
 * register grid. One item can fan out into many tiles (variants,
 * alt-units) and the fan-out rules encode a number of subtle business
 * decisions that a future change could break without obvious symptoms:
 *
 *   - alt_units stock is stored in the BASE unit in the DB but displayed
 *     PER unit on the tile (otherwise a 1kg bag shown as "1000 g" would
 *     read "1 g" to the cashier — a 1000× mispricing hazard)
 *   - variants use their own row's price/stock when set, and inherit
 *     from the parent item when null (this is how variant pricing is
 *     intended to work but the null-fallback is easy to drop in a refactor)
 *   - each tile MUST carry its own conversionFactor so the stock-
 *     decrement SQL (`stock = stock - qty*factor`) works against the
 *     base-unit column — "1" for simples/variants, decimal for alt_units
 *   - a corrupt or empty alt_units.unitVariants array must not produce
 *     zero tiles (the cashier would see the item disappear from the grid)
 *
 * Each case below names the rule being protected so a future reader can
 * tell what behaviour would regress if the test started failing.
 */

import { describe, it, expect } from "vitest";
import {
  expandItemsToTiles,
  type POSCatalogTile,
  type POSItemRow,
  type POSVariantRow,
} from "../routers/pos.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers — keep each test focused on the invariant it covers
// instead of repeating the full row shape.
// ─────────────────────────────────────────────────────────────────────────

function simpleItem(overrides: Partial<POSItemRow> = {}): POSItemRow {
  return {
    id: "item-1",
    name: "Tata Salt 1kg",
    unit: "pcs",
    itemMode: "simple",
    salePrice: "25.00",
    stockQuantity: "42",
    taxPercent: "5.00",
    sku: "TS-1KG",
    unitVariants: null,
    ...overrides,
  };
}

function variantItem(overrides: Partial<POSItemRow> = {}): POSItemRow {
  return simpleItem({
    id: "item-variants",
    name: "Cotton T-Shirt",
    itemMode: "variants",
    salePrice: "499.00",
    stockQuantity: "0", // ignored — variants carry their own stock
    sku: "TSHIRT",
    ...overrides,
  });
}

function altUnitsItem(overrides: Partial<POSItemRow> = {}): POSItemRow {
  return simpleItem({
    id: "item-rice",
    name: "Basmati Rice",
    unit: "kg",
    itemMode: "alt_units",
    salePrice: "80.00",
    stockQuantity: "50",  // 50 kg total on hand, in the BASE unit
    sku: "RICE-B",
    unitVariants: [
      { unit: "kg", conversionFactor: 1, salePrice: "80.00" },
      { unit: "g", conversionFactor: 0.001, salePrice: "0.09" },
    ],
    ...overrides,
  });
}

function variantRow(overrides: Partial<POSVariantRow> = {}): POSVariantRow {
  return {
    id: "var-1",
    itemId: "item-variants",
    sku: "TSHIRT-RED-L",
    salePrice: "549.00",
    stockQuantity: "12",
    attributeValues: { color: "Red", size: "L" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Simple items — one item → exactly one tile
// ─────────────────────────────────────────────────────────────────────────
describe("expandItemsToTiles — simple items", () => {
  it("produces exactly one tile per simple item with stable tileKey prefix `i:`", () => {
    const tiles = expandItemsToTiles([simpleItem()], new Map());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.tileKey).toBe("i:item-1");
    expect(tiles[0]!.itemId).toBe("item-1");
    expect(tiles[0]!.variantId).toBeNull();
    expect(tiles[0]!.itemMode).toBe("simple");
  });

  it("carries conversionFactor '1' — stock-decrement SQL multiplies qty by this factor, so anything other than '1' would corrupt the base-unit column", () => {
    const tiles = expandItemsToTiles([simpleItem()], new Map());
    expect(tiles[0]!.conversionFactor).toBe("1");
  });

  it("returns price / stock / tax verbatim without touching number precision — these round-trip as NUMERIC strings to the DB", () => {
    const tiles = expandItemsToTiles(
      [simpleItem({ salePrice: "123.45", stockQuantity: "7.500", taxPercent: "18.00" })],
      new Map(),
    );
    expect(tiles[0]!.unitPrice).toBe("123.45");
    expect(tiles[0]!.stockQuantity).toBe("7.500");
    expect(tiles[0]!.taxPercent).toBe("18.00");
  });

  it("falls back to '0' strings when price / stock / tax are null — a brand-new item without pricing must still appear on the grid so the cashier can edit-in a price", () => {
    const tiles = expandItemsToTiles(
      [simpleItem({ salePrice: null, stockQuantity: null, taxPercent: null })],
      new Map(),
    );
    expect(tiles[0]!.unitPrice).toBe("0");
    expect(tiles[0]!.stockQuantity).toBe("0");
    expect(tiles[0]!.taxPercent).toBe("0");
  });

  it("uses the item's unit directly — 'pcs', 'kg', etc. — never translated", () => {
    const tiles = expandItemsToTiles([simpleItem({ unit: "box" })], new Map());
    expect(tiles[0]!.unit).toBe("box");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Variant items — one item → N tiles (one per variant)
// ─────────────────────────────────────────────────────────────────────────
describe("expandItemsToTiles — variants", () => {
  it("produces one tile per variant row and no tile for the parent item itself", () => {
    const parent = variantItem({ id: "p" });
    const variants = new Map<string, POSVariantRow[]>([
      ["p", [
        variantRow({ id: "v-red", itemId: "p", attributeValues: { color: "Red" } }),
        variantRow({ id: "v-blue", itemId: "p", attributeValues: { color: "Blue" } }),
      ]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => t.itemMode === "variants")).toBe(true);
    expect(tiles.every((t) => t.variantId !== null)).toBe(true);
  });

  it("uses tileKey prefix `v:` with the variantId — identities must not collide with `i:` or `u:` tiles", () => {
    const parent = variantItem({ id: "p" });
    const variants = new Map([
      ["p", [variantRow({ id: "var-42", itemId: "p" })]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.tileKey).toBe("v:var-42");
  });

  it("joins attributeValues into the display name with ' / ' separator — matches the cart-line label format cashiers already recognise", () => {
    const parent = variantItem({ id: "p", name: "Cotton Shirt" });
    const variants = new Map([
      ["p", [variantRow({
        itemId: "p",
        attributeValues: { color: "Red", size: "L" },
      })]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.displayName).toBe("Cotton Shirt — Red / L");
  });

  it("falls back to the plain item name when attributeValues is empty or all-falsy — an un-configured variant should still render a tile", () => {
    const parent = variantItem({ id: "p", name: "Generic Widget" });
    const variants = new Map([
      ["p", [
        variantRow({ id: "v-empty", itemId: "p", attributeValues: {} }),
        variantRow({ id: "v-nulls", itemId: "p", attributeValues: { color: null, size: undefined } }),
        variantRow({ id: "v-null-obj", itemId: "p", attributeValues: null }),
      ]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles.map((t) => t.displayName)).toEqual([
      "Generic Widget",
      "Generic Widget",
      "Generic Widget",
    ]);
  });

  it("prefers the variant's own price when set, and falls back to the parent item's salePrice when the variant price is null", () => {
    const parent = variantItem({ id: "p", salePrice: "499.00" });
    const variants = new Map([
      ["p", [
        variantRow({ id: "v-own", itemId: "p", salePrice: "599.00" }),
        variantRow({ id: "v-inherit", itemId: "p", salePrice: null }),
      ]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.unitPrice).toBe("599.00");
    expect(tiles[1]!.unitPrice).toBe("499.00");
  });

  it("prefers the variant's own SKU and falls back to the parent SKU when the variant SKU is null — barcode scans hit whichever is set", () => {
    const parent = variantItem({ id: "p", sku: "PARENT-SKU" });
    const variants = new Map([
      ["p", [
        variantRow({ id: "v1", itemId: "p", sku: "VAR-SKU-A" }),
        variantRow({ id: "v2", itemId: "p", sku: null }),
      ]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.sku).toBe("VAR-SKU-A");
    expect(tiles[1]!.sku).toBe("PARENT-SKU");
  });

  it("uses the VARIANT's own stock, never the parent's — parent.stockQuantity is not meaningful on variant items", () => {
    const parent = variantItem({ id: "p", stockQuantity: "999" });
    const variants = new Map([
      ["p", [variantRow({ id: "v", itemId: "p", stockQuantity: "3" })]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.stockQuantity).toBe("3");
  });

  it("falls back to '0' stock when a variant row has stockQuantity: null — a zero-stock tile is preferable to an empty string breaking the cart math", () => {
    const parent = variantItem({ id: "p" });
    const variants = new Map([
      ["p", [variantRow({ id: "v", itemId: "p", stockQuantity: null })]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.stockQuantity).toBe("0");
  });

  it("always emits conversionFactor '1' for variant tiles — variants carry their own stock, the server decrements variant stock directly without converting", () => {
    const parent = variantItem({ id: "p" });
    const variants = new Map([
      ["p", [variantRow({ id: "v", itemId: "p" })]],
    ]);
    const tiles = expandItemsToTiles([parent], variants);
    expect(tiles[0]!.conversionFactor).toBe("1");
  });

  it("produces zero tiles for a variant item that has no variant rows in the provided map — mirrors the DB state rather than emitting a fake parent tile", () => {
    const parent = variantItem({ id: "p" });
    // Empty map — simulates a variant item with every variant soft-deleted
    // or still unpopulated.
    const tiles = expandItemsToTiles([parent], new Map());
    expect(tiles).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Alt-units items — one item → N tiles, one per configured unit
// ─────────────────────────────────────────────────────────────────────────
describe("expandItemsToTiles — alt_units", () => {
  it("emits one tile per entry in unitVariants with tileKey prefix `u:<itemId>:<unit>` — deterministic, scan-resumable", () => {
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => t.tileKey)).toEqual([
      "u:item-rice:kg",
      "u:item-rice:g",
    ]);
  });

  it("names the tile `<name> (<unit>)` so two tiles of the same item are visually distinct on the grid", () => {
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    expect(tiles[0]!.displayName).toBe("Basmati Rice (kg)");
    expect(tiles[1]!.displayName).toBe("Basmati Rice (g)");
  });

  it("converts base-unit stock to the alt unit using conversionFactor — 50 kg with factor 0.001 (g) shows as 50000.000 g on the tile", () => {
    // 50kg base, factor 0.001 (1g = 0.001kg) → 50 / 0.001 = 50000 g
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    const gTile = tiles.find((t) => t.unit === "g")!;
    expect(gTile.stockQuantity).toBe("50000.000");
  });

  it("uses toFixed(3) — alt-unit stock display is always 3 decimal places, never scientific notation", () => {
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    for (const t of tiles) {
      expect(t.stockQuantity).toMatch(/^\d+\.\d{3}$/);
    }
  });

  it("clamps stock to '0' when conversionFactor is zero — guards against a divide-by-zero in the display math", () => {
    const item = altUnitsItem({
      unitVariants: [{ unit: "broken", conversionFactor: 0, salePrice: "1.00" }],
    });
    const tiles = expandItemsToTiles([item], new Map());
    expect(tiles[0]!.stockQuantity).toBe("0");
  });

  it("passes conversionFactor through as a string — the server uses it verbatim in UPDATE items SET stock = stock - qty * factor", () => {
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    expect(tiles[0]!.conversionFactor).toBe("1"); // kg
    expect(tiles[1]!.conversionFactor).toBe("0.001"); // g
  });

  it("prefers the alt-unit's own salePrice, falling back to the parent salePrice when null", () => {
    const item = altUnitsItem({
      salePrice: "80.00",
      unitVariants: [
        { unit: "kg", conversionFactor: 1, salePrice: "85.00" },
        { unit: "g", conversionFactor: 0.001, salePrice: null },
      ],
    });
    const tiles = expandItemsToTiles([item], new Map());
    expect(tiles[0]!.unitPrice).toBe("85.00");
    expect(tiles[1]!.unitPrice).toBe("80.00");
  });

  it("emits ONE simple-style tile when unitVariants is empty — otherwise the alt_units item would vanish from the register grid", () => {
    const item = altUnitsItem({ unitVariants: [] });
    const tiles = expandItemsToTiles([item], new Map());
    expect(tiles).toHaveLength(1);
    // Falls back to simpleTile(), so the tile carries the item's base unit
    // and its own conversionFactor is "1" — not alt-units semantics.
    expect(tiles[0]!.tileKey).toBe("i:item-rice");
    expect(tiles[0]!.conversionFactor).toBe("1");
    expect(tiles[0]!.unit).toBe("kg"); // base unit, not any alt unit
  });

  it("also defends against unitVariants being null (legacy rows) — same empty-array fallback", () => {
    const item = altUnitsItem({ unitVariants: null });
    const tiles = expandItemsToTiles([item], new Map());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.tileKey).toBe("i:item-rice");
  });

  it("carries itemMode: 'alt_units' on every alt-unit tile — the UI uses this to render a small badge and must not mistake them for simple tiles", () => {
    const tiles = expandItemsToTiles([altUnitsItem()], new Map());
    expect(tiles.every((t) => t.itemMode === "alt_units")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mixed catalog — interaction between item types in a single call
// ─────────────────────────────────────────────────────────────────────────
describe("expandItemsToTiles — mixed catalog", () => {
  it("preserves input row order so the grid reflects the SQL ORDER BY updatedAt", () => {
    const rows: POSItemRow[] = [
      simpleItem({ id: "A", name: "A-item" }),
      altUnitsItem({ id: "B", name: "B-item", unitVariants: [{ unit: "kg", conversionFactor: 1, salePrice: "10" }] }),
      simpleItem({ id: "C", name: "C-item" }),
    ];
    const tiles = expandItemsToTiles(rows, new Map());
    expect(tiles.map((t) => t.itemId)).toEqual(["A", "B", "C"]);
  });

  it("only consumes variants for items whose itemMode is 'variants' — stray entries for simple items in the variants map must be ignored", () => {
    const simple = simpleItem({ id: "simple-1" });
    const variants = new Map([
      ["simple-1", [variantRow({ itemId: "simple-1" })]], // stray — should NOT produce a variant tile
    ]);
    const tiles = expandItemsToTiles([simple], variants);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.itemMode).toBe("simple");
    expect(tiles[0]!.variantId).toBeNull();
  });

  it("returns an empty list when given no items — defensive for a tenant with an empty catalog", () => {
    const tiles: POSCatalogTile[] = expandItemsToTiles([], new Map());
    expect(tiles).toEqual([]);
  });
});

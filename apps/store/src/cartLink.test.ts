import { describe, it, expect } from "vitest";
import {
  parseCartLink,
  parseItemParam,
  resolveCartLink,
  mergeCartLink,
  describeCartLinkResult,
  countExistingLines,
  cartLinkAppliesInView,
  MAX_FRAGMENT_LENGTH,
  MAX_LINES,
  MAX_QTY,
  type CartLinkLine,
} from "./cartLink";
import { cartItemKey, type CartItem, type StoreItem } from "./types";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";
const VAR_S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VAR_M = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GONE = "99999999-9999-4999-8999-999999999999";

/** What a website would put in the fragment. */
function link(payload: unknown): string {
  return `#cart=${encodeURIComponent(JSON.stringify(payload))}`;
}
function linkOf(items: unknown[]): string {
  return link({ v: 1, items });
}
function parsedLines(hash: string): CartLinkLine[] {
  const res = parseCartLink(hash);
  if (res.status !== "ok") throw new Error(`expected ok, got ${res.status}`);
  return res.lines;
}

function simpleItem(over: Partial<StoreItem> = {}): StoreItem {
  return {
    id: ID_A,
    name: "Basmati Rice",
    price: "120.00",
    unit: "kg",
    inStock: true,
    sortOrder: 0,
    itemMode: "simple",
    ...over,
  };
}
const altItem = (over: Partial<StoreItem> = {}): StoreItem =>
  simpleItem({
    id: ID_B,
    name: "Toor Dal",
    price: "100.00",
    itemMode: "alt_units",
    unitVariants: [
      { unit: "packet", conversionFactor: 0.5, price: "55.00" },
      { unit: "sack", conversionFactor: 25, price: "2400.00" },
    ],
    ...over,
  });
const variantItem = (over: Partial<StoreItem> = {}): StoreItem =>
  simpleItem({
    id: ID_C,
    name: "Cotton Kurta",
    price: "499.00",
    unit: "pcs",
    itemMode: "variants",
    variantAttributes: ["Size"],
    variants: [
      { id: VAR_S, attributes: { Size: "S" }, price: "499.00", inStock: true },
      { id: VAR_M, attributes: { Size: "M" }, price: "549.00", inStock: false },
    ],
    ...over,
  });

describe("parseCartLink", () => {
  it("reports no cart when the fragment is empty or unrelated", () => {
    expect(parseCartLink("")).toEqual({ status: "none" });
    expect(parseCartLink("#")).toEqual({ status: "none" });
    expect(parseCartLink("#section-2")).toEqual({ status: "none" });
    expect(parseCartLink("#/route?cart=1")).toEqual({ status: "none" });
  });

  it("parses a valid link with every field", () => {
    const hash = linkOf([
      { id: ID_A, qty: 2 },
      { id: ID_B, qty: 3, unit: "packet" },
      { id: ID_C, qty: 1, variantId: VAR_S },
    ]);
    expect(parseCartLink(hash)).toEqual({
      status: "ok",
      lines: [
        { id: ID_A, qty: 2 },
        { id: ID_B, qty: 3, unit: "packet" },
        { id: ID_C, qty: 1, variantId: VAR_S },
      ],
    });
  });

  it("accepts the fragment with or without the leading #, and extra fragment params", () => {
    const payload = encodeURIComponent(JSON.stringify({ v: 1, items: [{ id: ID_A, qty: 1 }] }));
    expect(parseCartLink(`#cart=${payload}`).status).toBe("ok");
    expect(parseCartLink(`cart=${payload}`).status).toBe("ok");
    expect(parseCartLink(`#utm=x&cart=${payload}`).status).toBe("ok");
    expect(parseCartLink(`#cart=${payload}&utm=x`).status).toBe("ok");
  });

  it("lower-cases ids and ignores null optional fields and unknown fields", () => {
    const lines = parsedLines(
      linkOf([{ id: ID_A.toUpperCase(), qty: 1, variantId: null, unit: null, price: "0.01", name: "hacked" }]),
    );
    expect(lines).toEqual([{ id: ID_A, qty: 1 }]);
  });

  it("clamps quantities above the maximum", () => {
    expect(parsedLines(linkOf([{ id: ID_A, qty: 1_000_000 }]))[0]!.qty).toBe(MAX_QTY);
    expect(parsedLines(linkOf([{ id: ID_A, qty: MAX_QTY }]))[0]!.qty).toBe(MAX_QTY);
    expect(parsedLines(linkOf([{ id: ID_A, qty: 1e300 }]))[0]!.qty).toBe(MAX_QTY);
  });

  it("sums lines that name the same item, variant and unit", () => {
    const lines = parsedLines(
      linkOf([
        { id: ID_A, qty: 2 },
        { id: ID_B, qty: 1, unit: "packet" },
        { id: ID_A, qty: 3 },
        { id: ID_B, qty: 1, unit: "sack" },
        { id: ID_B, qty: 4, unit: "packet" },
      ]),
    );
    expect(lines).toEqual([
      { id: ID_A, qty: 5 },
      { id: ID_B, qty: 5, unit: "packet" },
      { id: ID_B, qty: 1, unit: "sack" },
    ]);
    const capped = parsedLines(linkOf([{ id: ID_A, qty: 9000 }, { id: ID_A, qty: 9000 }]));
    expect(capped).toEqual([{ id: ID_A, qty: MAX_QTY }]);
  });

  it("accepts exactly MAX_LINES lines and rejects one more", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        qty: 1,
      }));
    expect(parsedLines(linkOf(make(MAX_LINES)))).toHaveLength(MAX_LINES);
    expect(parseCartLink(linkOf(make(MAX_LINES + 1)))).toEqual({ status: "invalid" });
  });

  it("rejects a fragment longer than 8 KB", () => {
    const hash = linkOf([{ id: ID_A, qty: 1, unit: "x".repeat(MAX_FRAGMENT_LENGTH) }]);
    expect(hash.length).toBeGreaterThan(MAX_FRAGMENT_LENGTH);
    expect(parseCartLink(hash)).toEqual({ status: "invalid" });
    expect(parseCartLink(`#cart=${"a".repeat(MAX_FRAGMENT_LENGTH)}`)).toEqual({ status: "invalid" });
  });

  it.each([
    ["no payload", "#cart="],
    ["not JSON", "#cart=%7Bnope"],
    ["not percent-decodable JSON", "#cart=%E0%A4%A"],
    ["JSON null", `#cart=${encodeURIComponent("null")}`],
    ["a JSON array", `#cart=${encodeURIComponent("[]")}`],
    ["a JSON string", `#cart=${encodeURIComponent('"hi"')}`],
  ])("rejects %s", (_label, hash) => {
    expect(parseCartLink(hash)).toEqual({ status: "invalid" });
  });

  it.each([
    ["a missing version", { items: [{ id: ID_A, qty: 1 }] }],
    ["another version", { v: 2, items: [{ id: ID_A, qty: 1 }] }],
    ["a string version", { v: "1", items: [{ id: ID_A, qty: 1 }] }],
    ["no items", { v: 1 }],
    ["items that is not an array", { v: 1, items: { id: ID_A, qty: 1 } }],
    ["an empty items array", { v: 1, items: [] }],
  ])("rejects %s", (_label, payload) => {
    expect(parseCartLink(link(payload))).toEqual({ status: "invalid" });
  });

  it.each([
    ["a line that is not an object", ["x"]],
    ["a null line", [null]],
    ["a missing id", [{ qty: 1 }]],
    ["a non-UUID id", [{ id: "item-1", qty: 1 }]],
    ["a numeric id", [{ id: 1, qty: 1 }]],
    ["an id with a path-ish suffix", [{ id: `${ID_A}/../x`, qty: 1 }]],
    ["a missing qty", [{ id: ID_A }]],
    ["a zero qty", [{ id: ID_A, qty: 0 }]],
    ["a negative qty", [{ id: ID_A, qty: -1 }]],
    ["a fractional qty", [{ id: ID_A, qty: 1.5 }]],
    ["a string qty", [{ id: ID_A, qty: "2" }]],
    ["a null qty", [{ id: ID_A, qty: null }]],
    ["a non-UUID variantId", [{ id: ID_C, qty: 1, variantId: "M" }]],
    ["a numeric unit", [{ id: ID_B, qty: 1, unit: 5 }]],
    ["an empty unit", [{ id: ID_B, qty: 1, unit: "" }]],
    ["an over-long unit", [{ id: ID_B, qty: 1, unit: "x".repeat(65) }]],
    ["one bad line among good ones", [{ id: ID_A, qty: 1 }, { id: "nope", qty: 1 }]],
  ])("rejects the whole link for %s", (_label, items) => {
    expect(parseCartLink(linkOf(items as unknown[]))).toEqual({ status: "invalid" });
  });

  it("never throws, whatever the input", () => {
    const nasty = [
      "#cart=%",
      "#cart=%00",
      "#cart=%ff%fe",
      "#cart=" + encodeURIComponent("{".repeat(5000)),
      "#cart=" + encodeURIComponent("[".repeat(5000)),
      "#cart=" + encodeURIComponent('{"v":1,"items":[{"id":"' + "a".repeat(5000) + '","qty":1}]}'),
      "#cart=" + encodeURIComponent('{"__proto__":{"v":1},"v":1,"items":[{"id":"' + ID_A + '","qty":1}]}'),
      "#&&&&cart=&&",
      undefined as unknown as string,
      null as unknown as string,
      42 as unknown as string,
    ];
    for (const hash of nasty) {
      expect(() => parseCartLink(hash)).not.toThrow();
    }
  });

  it("ignores prototype tricks in the payload", () => {
    const hash = `#cart=${encodeURIComponent(
      `{"v":1,"items":[{"id":"${ID_A}","qty":2,"__proto__":{"qty":99},"constructor":{"x":1}}]}`,
    )}`;
    expect(parsedLines(hash)).toEqual([{ id: ID_A, qty: 2 }]);
    expect(({} as Record<string, unknown>).qty).toBeUndefined();
  });
});

describe("parseItemParam", () => {
  it("returns a valid id, lower-cased", () => {
    expect(parseItemParam(`?item=${ID_A}`)).toBe(ID_A);
    expect(parseItemParam(`?foo=1&item=${ID_A.toUpperCase()}`)).toBe(ID_A);
  });
  it("returns null when absent or not a UUID", () => {
    expect(parseItemParam("")).toBeNull();
    expect(parseItemParam("?item=")).toBeNull();
    expect(parseItemParam("?item=rice")).toBeNull();
    expect(parseItemParam("?item=1;DROP TABLE items")).toBeNull();
  });
});

describe("resolveCartLink", () => {
  it("builds a simple line from the live catalog, with the link's quantity", () => {
    const { entries, dropped } = resolveCartLink([{ id: ID_A, qty: 4 }], [simpleItem()]);
    expect(dropped).toEqual([]);
    expect(entries).toEqual([{ item: simpleItem(), quantity: 4, effectivePrice: "120.00" }]);
  });

  it("takes price, unit conversion and name from the catalog, never the link", () => {
    const line = { id: ID_B, qty: 2, unit: "packet", price: "0.01", conversionFactor: 9999 } as CartLinkLine;
    const { entries } = resolveCartLink([line], [altItem()]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      quantity: 2,
      selectedUnit: "packet",
      conversionFactor: 0.5,
      effectivePrice: "55.00",
    });
    expect(entries[0]!.item.name).toBe("Toor Dal");
  });

  it("treats an alt-unit item with no unit, or its own base unit, as the base unit", () => {
    const item = altItem({ unit: "kg" });
    for (const line of [{ id: ID_B, qty: 1 }, { id: ID_B, qty: 1, unit: "kg" }]) {
      const { entries } = resolveCartLink([line], [item]);
      expect(entries).toEqual([{ item, quantity: 1, effectivePrice: "100.00" }]);
      expect(entries[0]!.selectedUnit).toBeUndefined();
      expect(cartItemKey(entries[0]!)).toBe(ID_B);
    }
  });

  it("resolves a variant line with the variant's own price", () => {
    const { entries, dropped } = resolveCartLink([{ id: ID_C, qty: 2, variantId: VAR_S }], [variantItem()]);
    expect(dropped).toEqual([]);
    expect(entries).toEqual([
      { item: variantItem(), quantity: 2, selectedVariantId: VAR_S, effectivePrice: "499.00" },
    ]);
    expect(cartItemKey(entries[0]!)).toBe(`${ID_C}::v::${VAR_S}`);
  });

  it("drops items that are not in the store", () => {
    const { entries, dropped } = resolveCartLink([{ id: GONE, qty: 1 }, { id: ID_A, qty: 1 }], [simpleItem()]);
    expect(entries).toHaveLength(1);
    expect(dropped).toEqual([{ line: { id: GONE, qty: 1 }, reason: "not_found" }]);
  });

  it("drops out-of-stock items but keeps sold-out ones the store still accepts orders for", () => {
    const soldOut = simpleItem({ inStock: false });
    expect(resolveCartLink([{ id: ID_A, qty: 1 }], [soldOut]).dropped).toEqual([
      { line: { id: ID_A, qty: 1 }, name: "Basmati Rice", reason: "out_of_stock" },
    ]);
    // allow-negative-stock stores report lowStock for sold-out items
    const lowStock = simpleItem({ inStock: true, lowStock: true });
    expect(resolveCartLink([{ id: ID_A, qty: 1 }], [lowStock]).entries).toHaveLength(1);
    const oddly = simpleItem({ inStock: false, lowStock: true });
    expect(resolveCartLink([{ id: ID_A, qty: 1 }], [oddly]).entries).toHaveLength(1);
  });

  it("drops an out-of-stock alt-unit line", () => {
    const { entries, dropped } = resolveCartLink(
      [{ id: ID_B, qty: 1, unit: "packet" }],
      [altItem({ inStock: false })],
    );
    expect(entries).toEqual([]);
    expect(dropped[0]).toMatchObject({ reason: "out_of_stock", name: "Toor Dal" });
  });

  it("drops an out-of-stock variant and names it", () => {
    const { entries, dropped } = resolveCartLink([{ id: ID_C, qty: 1, variantId: VAR_M }], [variantItem()]);
    expect(entries).toEqual([]);
    expect(dropped[0]).toMatchObject({ reason: "out_of_stock", name: "Cotton Kurta (M)" });
  });

  it("drops lines naming a variant or unit the item does not offer", () => {
    const cases: Array<[CartLinkLine, StoreItem, string]> = [
      [{ id: ID_C, qty: 1, variantId: GONE }, variantItem(), "unavailable_option"],
      [{ id: ID_C, qty: 1, variantId: VAR_S, unit: "box" }, variantItem(), "unavailable_option"],
      [{ id: ID_B, qty: 1, unit: "tonne" }, altItem(), "unavailable_option"],
      [{ id: ID_A, qty: 1, unit: "packet" }, simpleItem(), "unavailable_option"],
      [{ id: ID_A, qty: 1, variantId: VAR_S }, simpleItem(), "unavailable_option"],
      [{ id: ID_B, qty: 1, variantId: VAR_S }, altItem(), "unavailable_option"],
    ];
    for (const [line, item, reason] of cases) {
      const res = resolveCartLink([line], [item]);
      expect(res.entries).toEqual([]);
      expect(res.dropped).toHaveLength(1);
      expect(res.dropped[0]!.reason).toBe(reason);
    }
  });

  it("drops a variants-mode item named without a variant", () => {
    const { entries, dropped } = resolveCartLink([{ id: ID_C, qty: 1 }], [variantItem()]);
    expect(entries).toEqual([]);
    expect(dropped[0]).toMatchObject({ reason: "needs_option", name: "Cotton Kurta" });
  });

  it("matches unit names exactly", () => {
    expect(resolveCartLink([{ id: ID_B, qty: 1, unit: "Packet" }], [altItem()]).entries).toEqual([]);
  });

  it("keeps the good lines when others are dropped, in link order", () => {
    const items = [simpleItem(), altItem(), variantItem(), simpleItem({ id: ID_D, name: "Gone Soon", inStock: false })];
    const { entries, dropped } = resolveCartLink(
      [
        { id: ID_A, qty: 1 },
        { id: ID_D, qty: 1 },
        { id: GONE, qty: 1 },
        { id: ID_B, qty: 2, unit: "sack" },
        { id: ID_C, qty: 3, variantId: VAR_S },
      ],
      items,
    );
    expect(entries.map((e) => [e.item.id, e.quantity])).toEqual([
      [ID_A, 1],
      [ID_B, 2],
      [ID_C, 3],
    ]);
    expect(dropped.map((d) => d.reason)).toEqual(["out_of_stock", "not_found"]);
  });

  it("returns nothing for an empty catalog response", () => {
    const res = resolveCartLink([{ id: ID_A, qty: 1 }], []);
    expect(res.entries).toEqual([]);
    expect(res.dropped).toHaveLength(1);
  });
});

describe("mergeCartLink", () => {
  const existing = (over: Partial<CartItem> = {}): CartItem => ({
    item: simpleItem({ price: "100.00" }),
    quantity: 5,
    effectivePrice: "100.00",
    ...over,
  });

  it("appends lines that are not in the cart", () => {
    const entry: CartItem = { item: altItem(), quantity: 2, effectivePrice: "100.00" };
    const merged = mergeCartLink([existing()], [entry]);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toBe(entry);
  });

  it("sets (does not add) the quantity for the same item, and refreshes the snapshot and price", () => {
    const entry: CartItem = { item: simpleItem(), quantity: 2, effectivePrice: "120.00" };
    const merged = mergeCartLink([existing()], [entry]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quantity).toBe(2);
    expect(merged[0]!.effectivePrice).toBe("120.00");
    expect(merged[0]!.item.price).toBe("120.00");
  });

  it("keeps the position of a replaced line and leaves unmentioned lines alone", () => {
    const other: CartItem = { item: altItem(), quantity: 7, effectivePrice: "100.00" };
    const merged = mergeCartLink([existing(), other], [{ item: simpleItem(), quantity: 1, effectivePrice: "120.00" }]);
    expect(merged.map((c) => [c.item.id, c.quantity])).toEqual([
      [ID_A, 1],
      [ID_B, 7],
    ]);
  });

  it("distinguishes variants and units of one item", () => {
    const base: CartItem = { item: altItem(), quantity: 1, effectivePrice: "100.00" };
    const packet: CartItem = {
      item: altItem(),
      quantity: 2,
      selectedUnit: "packet",
      conversionFactor: 0.5,
      effectivePrice: "55.00",
    };
    const merged = mergeCartLink([base], [packet]);
    expect(merged).toHaveLength(2);
    const again = mergeCartLink(merged, [{ ...packet, quantity: 6 }]);
    expect(again).toHaveLength(2);
    expect(again.map((c) => c.quantity)).toEqual([1, 6]);

    const vS: CartItem = { item: variantItem(), quantity: 1, selectedVariantId: VAR_S, effectivePrice: "499.00" };
    const vM: CartItem = { item: variantItem(), quantity: 1, selectedVariantId: VAR_M, effectivePrice: "549.00" };
    expect(mergeCartLink([vS], [vM])).toHaveLength(2);
  });

  it("is idempotent: applying the same link twice gives the same cart", () => {
    const entries: CartItem[] = [
      { item: simpleItem(), quantity: 2, effectivePrice: "120.00" },
      { item: variantItem(), quantity: 1, selectedVariantId: VAR_S, effectivePrice: "499.00" },
    ];
    const start = [existing(), { item: altItem(), quantity: 3, effectivePrice: "100.00" }];
    const once = mergeCartLink(start, entries);
    const twice = mergeCartLink(once, entries);
    expect(twice).toEqual(once);
  });

  it("does not mutate its inputs", () => {
    const cart = [existing()];
    const snapshot = JSON.stringify(cart);
    mergeCartLink(cart, [{ item: simpleItem(), quantity: 9, effectivePrice: "120.00" }]);
    expect(JSON.stringify(cart)).toBe(snapshot);
  });

  it("returns the cart unchanged for no entries", () => {
    const cart = [existing()];
    expect(mergeCartLink(cart, [])).toEqual(cart);
  });
});

describe("describeCartLinkResult", () => {
  it("reports a clean add", () => {
    expect(describeCartLinkResult(3, [])).toEqual({ kind: "success", message: "3 items added from a link", details: [] });
    expect(describeCartLinkResult(1, []).message).toBe("1 item added from a link");
  });

  it("lists what was dropped alongside what was added", () => {
    const notice = describeCartLinkResult(2, [
      { line: { id: GONE, qty: 1 }, reason: "not_found" },
      { line: { id: ID_A, qty: 1 }, name: "Basmati Rice", reason: "out_of_stock" },
    ]);
    expect(notice.kind).toBe("warning");
    expect(notice.message).toBe("2 items added from a link");
    expect(notice.details).toEqual([
      "An item: no longer available",
      "Basmati Rice: out of stock",
    ]);
  });

  it("admits when the link overwrote quantities of lines already in the cart", () => {
    expect(describeCartLinkResult(3, [], 1)).toEqual({
      kind: "success",
      message: "3 items added or updated from a link",
      details: [],
    });
    expect(describeCartLinkResult(1, [], 1).message).toBe("1 item added or updated from a link");
    expect(describeCartLinkResult(2, [], 0).message).toBe("2 items added from a link");
  });

  it("says so when nothing could be added", () => {
    const notice = describeCartLinkResult(0, [{ line: { id: GONE, qty: 1 }, reason: "not_found" }]);
    expect(notice.kind).toBe("warning");
    expect(notice.message).toBe("None of the items in this link are available.");
    expect(notice.details).toHaveLength(1);
  });
});

describe("countExistingLines", () => {
  const inCart = (): CartItem[] => [
    { item: simpleItem(), quantity: 5, effectivePrice: "120.00" },
    { item: altItem(), quantity: 1, selectedUnit: "packet", conversionFactor: 0.5, effectivePrice: "55.00" },
  ];

  it("counts entries that already have a line (same item, variant and unit)", () => {
    const entries: CartItem[] = [
      { item: simpleItem(), quantity: 2, effectivePrice: "120.00" },
      { item: altItem(), quantity: 3, selectedUnit: "packet", conversionFactor: 0.5, effectivePrice: "55.00" },
      { item: altItem(), quantity: 1, selectedUnit: "sack", conversionFactor: 25, effectivePrice: "2400.00" },
      { item: variantItem(), quantity: 1, selectedVariantId: VAR_S, effectivePrice: "499.00" },
    ];
    expect(countExistingLines(inCart(), entries)).toBe(2);
  });

  it("is zero for an empty cart or no entries", () => {
    expect(countExistingLines([], [{ item: simpleItem(), quantity: 1, effectivePrice: "120.00" }])).toBe(0);
    expect(countExistingLines(inCart(), [])).toBe(0);
  });
});

describe("cartLinkAppliesInView", () => {
  it("applies only while browsing or looking at the cart", () => {
    expect(cartLinkAppliesInView("browse")).toBe(true);
    expect(cartLinkAppliesInView("cart")).toBe(true);
  });

  it("is ignored during checkout and on the confirmation page", () => {
    expect(cartLinkAppliesInView("phone-verify")).toBe(false);
    expect(cartLinkAppliesInView("checkout")).toBe(false);
    expect(cartLinkAppliesInView("confirmed")).toBe(false);
  });
});

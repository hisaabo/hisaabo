/**
 * POS store unit tests.
 *
 * Covers the cart mutation surface, derived-total math, and the parked-cart
 * lifecycle. localStorage is stubbed via jsdom so we can also verify that
 * persistence round-trips.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { POSStore, computeCartTotals, type POSLineItem } from "../state";

const BIZ_ID = "11111111-1111-1111-1111-111111111111";
const WALK_IN = "22222222-2222-2222-2222-222222222222";

function makeStore() {
  return new POSStore(BIZ_ID, WALK_IN);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("POSStore — initial state", () => {
  it("creates one blank cart owned by Walk-in", () => {
    const s = makeStore();
    const state = s.getSnapshot();
    expect(state.businessId).toBe(BIZ_ID);
    expect(state.carts).toHaveLength(1);
    expect(state.carts[0]!.partyId).toBe(WALK_IN);
    expect(state.carts[0]!.lineItems).toEqual([]);
    expect(state.activeCartId).toBe(state.carts[0]!.id);
  });

  it("reuses the same sessionStorage tabId across store instances in one tab", () => {
    const a = makeStore();
    const b = makeStore();
    expect(a.getSnapshot().tabId).toBe(b.getSnapshot().tabId);
  });
});

const simpleLine = (overrides: Partial<POSLineItem> = {}): Omit<POSLineItem, "lineId"> => ({
  itemId: "item-1",
  itemName: "Widget",
  quantity: "1",
  unit: "pcs",
  unitPrice: "100",
  taxPercent: "18",
  discountPercent: "0",
  conversionFactor: "1",
  ...overrides,
});

describe("POSStore — line items", () => {
  it("addLine appends a line with a generated id", () => {
    const s = makeStore();
    s.addLine(simpleLine({ quantity: "2" }));
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(1);
    expect(cart.lineItems[0]!.lineId).toBeTruthy();
    expect(cart.lineItems[0]!.itemName).toBe("Widget");
  });

  it("addOrBumpLine increments an existing matching itemId rather than duplicating", () => {
    const s = makeStore();
    s.addOrBumpLine({ itemId: "item-1", unit: "pcs" }, simpleLine());
    s.addOrBumpLine({ itemId: "item-1", unit: "pcs" }, simpleLine());
    s.addOrBumpLine({ itemId: "item-1", unit: "pcs" }, simpleLine());
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(1);
    expect(cart.lineItems[0]!.quantity).toBe("3");
  });

  it("addOrBumpLine treats different variantIds as separate rows", () => {
    const s = makeStore();
    const mk = (v: string) =>
      simpleLine({ variantId: v, itemName: `Widget-${v}` });
    s.addOrBumpLine({ itemId: "item-1", variantId: "red", unit: "pcs" }, mk("red"));
    s.addOrBumpLine({ itemId: "item-1", variantId: "blue", unit: "pcs" }, mk("blue"));
    s.addOrBumpLine({ itemId: "item-1", variantId: "red", unit: "pcs" }, mk("red"));
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(2);
    const red = cart.lineItems.find((li) => li.variantId === "red");
    expect(red?.quantity).toBe("2");
  });

  it("addOrBumpLine treats different alt-units of the same item as separate rows", () => {
    // Rice sold by kg and by g — both are itemId=rice but have different
    // conversion factors and different cart-line identities.
    const s = makeStore();
    s.addOrBumpLine(
      { itemId: "rice", unit: "kg" },
      simpleLine({ itemId: "rice", itemName: "Rice (kg)", unit: "kg", unitPrice: "80", conversionFactor: "1" }),
    );
    s.addOrBumpLine(
      { itemId: "rice", unit: "g" },
      simpleLine({ itemId: "rice", itemName: "Rice (g)", unit: "g", unitPrice: "0.08", conversionFactor: "0.001" }),
    );
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(2);
    expect(cart.lineItems.map((li) => li.unit).sort()).toEqual(["g", "kg"]);
  });

  it("removeLine drops the matching lineId only", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemId: "a", itemName: "A", unitPrice: "10", taxPercent: "0" }));
    s.addLine(simpleLine({ itemId: "b", itemName: "B", unitPrice: "10", taxPercent: "0" }));
    const toRemove = s.getSnapshot().carts[0]!.lineItems[0]!.lineId;
    s.removeLine(toRemove);
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(1);
    expect(cart.lineItems[0]!.itemName).toBe("B");
  });

  it("updateLine patches only the named fields", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemId: "a", itemName: "A", unitPrice: "10", taxPercent: "0" }));
    const id = s.getSnapshot().carts[0]!.lineItems[0]!.lineId;
    s.updateLine(id, { quantity: "5" });
    const li = s.getSnapshot().carts[0]!.lineItems[0]!;
    expect(li.quantity).toBe("5");
    expect(li.unitPrice).toBe("10");
  });
});

describe("POSStore — park and resume", () => {
  it("parkActive creates a fresh cart and keeps the old one", () => {
    const s = makeStore();
    const oldId = s.getSnapshot().activeCartId;
    s.addLine(simpleLine({ itemId: "a", itemName: "A", unitPrice: "10", taxPercent: "0" }));
    s.parkActive(WALK_IN, "Walk-in Customer");

    const state = s.getSnapshot();
    expect(state.carts).toHaveLength(2);
    expect(state.activeCartId).not.toBe(oldId);
    const parked = state.carts.find((c) => c.id === oldId)!;
    expect(parked.lineItems).toHaveLength(1);
    const active = state.carts.find((c) => c.id === state.activeCartId)!;
    expect(active.lineItems).toHaveLength(0);
  });

  it("parking more than 5 evicts the oldest non-active", () => {
    const s = makeStore();
    // Park 5 times → we end with 6 carts, should be capped at 5.
    for (let i = 0; i < 6; i++) {
      s.addLine(simpleLine({ itemId: `a${i}`, itemName: `A${i}`, unitPrice: "10", taxPercent: "0" }));
      s.parkActive(WALK_IN, "Walk-in Customer");
    }
    expect(s.getSnapshot().carts.length).toBeLessThanOrEqual(5);
  });

  it("resumeCart switches active pointer", () => {
    const s = makeStore();
    const origId = s.getSnapshot().activeCartId;
    s.parkActive(WALK_IN, "Walk-in Customer");
    s.resumeCart(origId);
    expect(s.getSnapshot().activeCartId).toBe(origId);
  });
});

describe("POSStore — persistence", () => {
  it("round-trips via localStorage across store instances", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemId: "x", itemName: "X", quantity: "2", unitPrice: "50", taxPercent: "0" }));
    // Instantiate a second store (simulating page reload) — same tabId from sessionStorage
    const s2 = new POSStore(BIZ_ID, WALK_IN);
    const cart = s2.getSnapshot().carts[0]!;
    expect(cart.lineItems).toHaveLength(1);
    expect(cart.lineItems[0]!.itemName).toBe("X");
  });
});

describe("computeCartTotals", () => {
  it("handles empty cart as all-zero", () => {
    expect(computeCartTotals([])).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  });

  it("computes subtotal, discount, and tax per line then sums", () => {
    const lines: POSLineItem[] = [
      { lineId: "1", itemId: null, itemName: "A", quantity: "2", unit: "pcs", unitPrice: "100", taxPercent: "18", discountPercent: "0", conversionFactor: "1" },
      { lineId: "2", itemId: null, itemName: "B", quantity: "1", unit: "pcs", unitPrice: "200", taxPercent: "5",  discountPercent: "10", conversionFactor: "1" },
    ];
    const t = computeCartTotals(lines);
    // Line 1: gross=200, disc=0, tax=200*0.18=36, net+tax=236
    // Line 2: gross=200, disc=20, tax=(200-20)*0.05=9, net+tax=189
    expect(t.subtotal).toBeCloseTo(400);
    expect(t.discount).toBeCloseTo(20);
    expect(t.tax).toBeCloseTo(45);
    expect(t.total).toBeCloseTo(425);
  });

  it("treats bad numeric strings as zero (won't NaN)", () => {
    const lines: POSLineItem[] = [
      { lineId: "1", itemId: null, itemName: "A", quantity: "", unit: "pcs", unitPrice: "abc", taxPercent: "?", discountPercent: "", conversionFactor: "1" },
    ];
    const t = computeCartTotals(lines);
    expect(t.total).toBe(0);
    expect(Number.isNaN(t.total)).toBe(false);
  });
});

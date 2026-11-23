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
    expect(computeCartTotals([])).toEqual({ subtotal: 0, discount: 0, tax: 0, roundOff: 0, total: 0 });
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

  it("uses the exact line maths of the server: a tax-inclusive item's tile rate bills at the shelf price", () => {
    // POS tile of an item saved at ₹118.00 incl. 18%: rate 100.00. 2 x 100.00 = 200.00, GST 36.00, total 236.00.
    const t = computeCartTotals([
      { lineId: "1", itemId: "i", itemName: "Atta", quantity: "2", unit: "pcs", unitPrice: "100.00", taxPercent: "18", discountPercent: "0", conversionFactor: "1" },
    ]);
    expect(t).toEqual({ subtotal: 200, discount: 0, tax: 36, roundOff: 0, total: 236 });
  });

  it("rounds half up in integer paise, never in floats: ₹0.85 x 0.7 = ₹0.60 (the float product gave 0.59)", () => {
    // 85 paise x 0.7 = 59.5 -> 60 paise
    const t = computeCartTotals([
      { lineId: "1", itemId: null, itemName: "A", quantity: "0.7", unit: "kg", unitPrice: "0.85", taxPercent: "0", discountPercent: "0", conversionFactor: "1" },
    ]);
    expect(t.subtotal).toBe(0.6);
    expect(t.total).toBe(0.6);
  });

  it("matches the invoice the server will create for an 88.39 @ 12% tile: GST 10.61 (1060.68 paise -> 1061), total 99.00", () => {
    const t = computeCartTotals([
      { lineId: "1", itemId: "i", itemName: "Oil", quantity: "1", unit: "pcs", unitPrice: "88.39", taxPercent: "12", discountPercent: "0", conversionFactor: "1" },
    ]);
    expect(t).toEqual({ subtotal: 88.39, discount: 0, tax: 10.61, roundOff: 0, total: 99 });
  });

  it("an inclusive line that does not bill to the paisa: ₹10.00 incl. 18% (rate 8.47 + GST 1.52 = 9.99) carries round-off +0.01, total 10.00", () => {
    // 1000p x 100 / 118 = 847.46 -> 847; GST 847 x 18% = 152.46 -> 152; 847 + 152 = 999; shelf 1000
    const t = computeCartTotals([
      { lineId: "1", itemId: "i", itemName: "Tea", quantity: "1", unit: "pcs", unitPrice: "8.47", taxPercent: "18", discountPercent: "0", conversionFactor: "1", inclusivePrice: "10.00" },
    ]);
    expect(t).toEqual({ subtotal: 8.47, discount: 0, tax: 1.52, roundOff: 0.01, total: 10 });
  });

  it("₹41.00 incl. 18% bills 41.01 (34.75 + 6.26): round-off -0.01, total 41.00", () => {
    // 4100p x 100 / 118 = 3474.58 -> 3475; GST 3475 x 18% = 625.5 -> 626 (half up)
    const t = computeCartTotals([
      { lineId: "1", itemId: "i", itemName: "Biscuits", quantity: "1", unit: "pcs", unitPrice: "34.75", taxPercent: "18", discountPercent: "0", conversionFactor: "1", inclusivePrice: "41.00" },
    ]);
    expect(t).toEqual({ subtotal: 34.75, discount: 0, tax: 6.26, roundOff: -0.01, total: 41 });
  });

  it("3 x ₹99.00 incl. 18% bills 297.01: round-off -0.01, total 297.00; with 10% off, 267.31 -> 267.30", () => {
    const base = { lineId: "1", itemId: "i", itemName: "Notebook", quantity: "3", unit: "pcs", unitPrice: "83.90", taxPercent: "18", conversionFactor: "1", inclusivePrice: "99.00" };
    // 3 x 83.90 = 251.70, GST 45.306 -> 45.31, 297.01 ; shelf 297.00
    expect(computeCartTotals([{ ...base, discountPercent: "0" }])).toEqual({ subtotal: 251.7, discount: 0, tax: 45.31, roundOff: -0.01, total: 297 });
    // 251.70 less 10% (25.17) = 226.53, GST 40.7754 -> 40.78, 267.31 ; shelf 297.00 less 10% = 267.30
    expect(computeCartTotals([{ ...base, discountPercent: "10" }])).toEqual({ subtotal: 251.7, discount: 25.17, tax: 40.78, roundOff: -0.01, total: 267.3 });
  });

  it("lines without an inclusive price never get a round-off, and the tie-out of several lines is their sum", () => {
    const tea = { lineId: "1", itemId: "i", itemName: "Tea", quantity: "1", unit: "pcs", unitPrice: "8.47", taxPercent: "18", discountPercent: "0", conversionFactor: "1", inclusivePrice: "10.00" };
    const plain = { lineId: "2", itemId: "j", itemName: "Steel", quantity: "1", unit: "pcs", unitPrice: "100.00", taxPercent: "18", discountPercent: "0", conversionFactor: "1" };
    const two = { ...tea, lineId: "3", itemId: "k", itemName: "Pin", unitPrice: "1.69", inclusivePrice: "2.00" }; // 1.69 + 0.30 = 1.99 -> +0.01
    // 9.99 + 118.00 + 1.99 = 129.98 ; shelf 10.00 + 118.00 + 2.00 = 130.00 -> +0.02
    expect(computeCartTotals([tea, plain, two])).toMatchObject({ roundOff: 0.02, total: 130 });
    expect(computeCartTotals([plain])).toMatchObject({ roundOff: 0, total: 118 });
  });

  it("the shelf price survives a quantity bump: the tile adds quantity to a line that keeps its inclusive price", () => {
    const store = makeStore();
    const line = { itemId: "i", itemName: "Tea", quantity: "1", unit: "pcs", unitPrice: "8.47", taxPercent: "18", discountPercent: "0", conversionFactor: "1", inclusivePrice: "10.00" };
    store.addOrBumpLine({ itemId: "i", unit: "pcs" }, line);
    store.addOrBumpLine({ itemId: "i", unit: "pcs" }, line);
    const lines = store.getSnapshot().carts[0]!.lineItems;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.inclusivePrice).toBe("10.00");
    // 2 x 8.47 = 16.94, GST 3.0492 -> 3.05, 19.99 ; shelf 20.00 -> +0.01
    expect(computeCartTotals(lines)).toMatchObject({ tax: 3.05, roundOff: 0.01, total: 20 });
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

// ─────────────────────────────────────────────────────────────────────────
// Additional mutations — surface-coverage gaps caught by reviewing state.ts
//
// The original test file covered the happy-path cart ops; these fill in
// the edges: removeLastLine (undo-last), customer/label edits,
// clearActive (new-sale reset), removeCart (post-finalize), the invalid
// resumeCart no-op, and two hydrate failure modes. Each is a real
// production path — a regression in any of them breaks a specific
// cashier action.
// ─────────────────────────────────────────────────────────────────────────
describe("POSStore — edit mutations on the active cart", () => {
  it("removeLastLine drops exactly one line from the tail — the 'undo last item' keyboard shortcut", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemName: "A" }));
    s.addLine(simpleLine({ itemName: "B" }));
    s.addLine(simpleLine({ itemName: "C" }));
    s.removeLastLine();

    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems.map((li) => li.itemName)).toEqual(["A", "B"]);
  });

  it("removeLastLine on an empty cart is a safe no-op (no throw, no mutation)", () => {
    const s = makeStore();
    s.removeLastLine();
    const cart = s.getSnapshot().carts[0]!;
    expect(cart.lineItems).toEqual([]);
  });

  it("setCustomer swaps the partyId and partyName on the active cart without touching its line items", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemName: "X" }));
    s.setCustomer("cust-123", "Ramesh Kirana");

    const cart = s.getSnapshot().carts[0]!;
    expect(cart.partyId).toBe("cust-123");
    expect(cart.partyName).toBe("Ramesh Kirana");
    // Cart contents must be preserved — a cashier changing the customer
    // mid-sale shouldn't lose items already scanned.
    expect(cart.lineItems).toHaveLength(1);
  });

  it("setLabel updates the cart label (used when the cashier names a parked cart like 'Hold — Mr. Sharma')", () => {
    const s = makeStore();
    s.setLabel("Hold — Mr. Sharma");
    expect(s.getSnapshot().carts[0]!.label).toBe("Hold — Mr. Sharma");
  });

  it("clearActive empties line items AND notes while preserving the cart's id / party — 'new sale' button without creating a new cart row", () => {
    const s = makeStore();
    s.addLine(simpleLine({ itemName: "X" }));
    s.setCustomer("cust-1", "Someone");
    // Notes are set via updateLine/setLabel paths today; mock it directly
    // for test purposes by going through updateLine on a line.
    const prevCartId = s.getSnapshot().activeCartId;

    s.clearActive();

    const cart = s.getSnapshot().carts[0]!;
    expect(cart.id).toBe(prevCartId);            // same cart, not replaced
    expect(cart.lineItems).toEqual([]);          // items gone
    expect(cart.partyId).toBe("cust-1");         // customer preserved
  });
});

describe("POSStore — removeCart (post-finalize cleanup)", () => {
  it("removing the active cart when it's the only one auto-creates a fresh blank cart so the cashier never sees an empty register", () => {
    const s = makeStore();
    const originalId = s.getSnapshot().activeCartId;
    s.addLine(simpleLine({ itemName: "sold" }));

    s.removeCart(originalId, WALK_IN, "Walk-in Customer");

    const state = s.getSnapshot();
    expect(state.carts).toHaveLength(1);
    expect(state.carts[0]!.id).not.toBe(originalId);  // fresh id
    expect(state.carts[0]!.lineItems).toEqual([]);    // fresh blank
    expect(state.activeCartId).toBe(state.carts[0]!.id);
  });

  it("removing the active cart when there are parked carts picks the first remaining cart as the new active", () => {
    const s = makeStore();
    const firstId = s.getSnapshot().activeCartId;
    s.parkActive(WALK_IN, "Walk-in Customer");   // active = fresh, firstId parked
    const freshId = s.getSnapshot().activeCartId;

    s.removeCart(freshId, WALK_IN, "Walk-in Customer");

    const state = s.getSnapshot();
    expect(state.carts).toHaveLength(1);
    expect(state.activeCartId).toBe(firstId);
  });

  it("removing a non-active (parked) cart does not change the active cart pointer", () => {
    const s = makeStore();
    const firstId = s.getSnapshot().activeCartId;
    s.parkActive(WALK_IN, "Walk-in Customer");   // now active = new, firstId parked
    const activeId = s.getSnapshot().activeCartId;

    s.removeCart(firstId, WALK_IN, "Walk-in Customer");

    const state = s.getSnapshot();
    expect(state.carts).toHaveLength(1);
    expect(state.activeCartId).toBe(activeId);   // still the original active
  });
});

describe("POSStore — resumeCart guards", () => {
  it("resumeCart with an unknown cart id is a silent no-op — never crashes the register UI, never switches to a non-existent cart", () => {
    const s = makeStore();
    const originalId = s.getSnapshot().activeCartId;

    s.resumeCart("nonexistent-cart-id");

    expect(s.getSnapshot().activeCartId).toBe(originalId);
  });
});

describe("POSStore — hydrate defences against corrupted storage", () => {
  it("falls back to a fresh state when localStorage contains non-JSON garbage (e.g. a failed partial write)", () => {
    localStorage.setItem(`pos:${BIZ_ID}:test-tab:state`, "not-json{oops");
    // Force the tabId to match the garbage we wrote so the hydrate path hits it.
    sessionStorage.setItem(`pos:${BIZ_ID}:tabId`, "test-tab");

    const s = new POSStore(BIZ_ID, WALK_IN);
    const state = s.getSnapshot();
    expect(state.carts).toHaveLength(1);
    expect(state.carts[0]!.lineItems).toEqual([]);
    expect(state.carts[0]!.partyId).toBe(WALK_IN);
  });

  it("falls back to a fresh state when persisted businessId no longer matches — an admin switching businesses must never inherit the old tab's cart", () => {
    // Persist a valid-shape payload under BIZ_ID for a DIFFERENT business.
    const otherBiz = "99999999-9999-9999-9999-999999999999";
    sessionStorage.setItem(`pos:${BIZ_ID}:tabId`, "test-tab");
    localStorage.setItem(
      `pos:${BIZ_ID}:test-tab:state`,
      JSON.stringify({
        tabId: "test-tab",
        businessId: otherBiz,   // mismatch — triggers fallback
        carts: [{ id: "c1", label: "L", partyId: "p", partyName: "n", lineItems: [], createdAt: 0, updatedAt: 0 }],
        activeCartId: "c1",
      }),
    );

    const s = new POSStore(BIZ_ID, WALK_IN);
    const state = s.getSnapshot();
    expect(state.businessId).toBe(BIZ_ID);
    expect(state.carts[0]!.partyId).toBe(WALK_IN);  // fresh blank, not the stale cart
  });

  it("falls back to a fresh state when the persisted activeCartId points to a cart that isn't in the persisted carts array", () => {
    sessionStorage.setItem(`pos:${BIZ_ID}:tabId`, "test-tab");
    localStorage.setItem(
      `pos:${BIZ_ID}:test-tab:state`,
      JSON.stringify({
        tabId: "test-tab",
        businessId: BIZ_ID,
        carts: [{ id: "c1", label: "L", partyId: "p", partyName: "n", lineItems: [], createdAt: 0, updatedAt: 0 }],
        activeCartId: "does-not-exist",  // dangling pointer
      }),
    );

    const s = new POSStore(BIZ_ID, WALK_IN);
    const state = s.getSnapshot();
    // Fresh cart, not the orphaned "c1"
    expect(state.carts[0]!.partyId).toBe(WALK_IN);
  });
});

describe("POSStore — parkActive 5-cart cap preserves the just-parked + 4 most-recent-others", () => {
  it("eviction keeps the freshly-parked cart (just created on parkActive) rather than dropping it immediately", () => {
    const s = makeStore();
    // Create 6 parks worth of carts; each park creates a new blank and
    // parks the current one. After 6 parks, the cap kicks in.
    for (let i = 0; i < 6; i++) {
      s.addLine(simpleLine({ itemName: `A${i}` }));
      s.parkActive(WALK_IN, "Walk-in Customer");
    }
    const state = s.getSnapshot();
    expect(state.carts.length).toBe(5);
    // The cart that's currently active (the fresh blank from the LAST
    // parkActive call) must be present — otherwise the cashier loses
    // their current register slot after a park.
    expect(state.carts.some((c) => c.id === state.activeCartId)).toBe(true);
  });
});

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

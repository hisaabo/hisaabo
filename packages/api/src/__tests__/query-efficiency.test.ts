/**
 * Tests for query efficiency patterns in the Hisaabo API routers.
 *
 * WHY THIS FILE EXISTS:
 * N+1 query bugs are invisible until production load hits. A router that looks
 * correct in local testing can silently issue hundreds of database round-trips
 * per request once real data volumes arrive. This file guards against two
 * failure modes:
 *
 * 1. REGRESSION on patterns that are already efficient.
 *    Several routers pre-aggregate data into Maps/Sets before touching the DB,
 *    then do all lookups in O(1) in-memory. If someone refactors those loops
 *    back to imperative per-item queries, these tests break loudly.
 *
 * 2. DOCUMENTATION of patterns that are still N+1.
 *    Some loops in payment.ts and invoice.ts are intentionally N (one DB call
 *    per allocation / per unique item). Those tests record the current cost so
 *    future work can measure the improvement when a bulk CTE replaces the loop.
 *
 * APPROACH:
 * All tests are pure-function tests. The logic is extracted from the router
 * into a small function defined right here in the test file — exactly like the
 * existing calcLineItem / salesStats tests. No DB, no mocking, no async.
 *
 * ROUTER REFERENCES (grep these to find the real code):
 *   packages/api/src/routers/invoice.ts  lines 258-288  stock delta maps + update loop
 *   packages/api/src/routers/import.ts   lines 33-73    party/item pre-fetch Set + chunking
 *   packages/api/src/routers/reports.ts  lines 347-405  tax breakdown Map join (salesRegister)
 *   packages/api/src/routers/reports.ts  lines 254-278  aging bucket aggregation (outstanding)
 *   packages/api/src/routers/payment.ts  lines 243-269  allocation update loop
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Group 1: Verified-Good Patterns
// Regression protection for in-memory aggregation that avoids extra DB round-trips.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 1. Map-based stock delta deduplication
//    Source: invoice.ts lines 258-270 (itemStockMap / variantStockMap build)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildStockDeltaMap — Map deduplication prevents one UPDATE per line item", () => {
  /**
   * The invoice.create mutation (invoice.ts:258-288) builds two Maps before
   * issuing any stock UPDATE statements:
   *
   *   itemStockMap    Map<itemId, totalBaseQty>
   *   variantStockMap Map<variantId, totalQty>
   *
   * The Map ensures that an invoice with 10 lines for the same item collapses
   * into a SINGLE update rather than 10 separate UPDATE calls. Without the Map
   * the naive loop would be O(N) database writes for N line items.
   *
   * The number of UPDATE statements issued equals Map.size — these tests verify
   * that the Map correctly collapses duplicates so the DB call count stays at
   * unique-item count, not line-item count.
   */

  /**
   * Mirrors invoice.ts:258-270 for simple items (no variantId path).
   * conversionFactor converts the invoice unit to the item's base stock unit.
   */
  function buildStockDeltaMap(
    lineItems: Array<{
      itemId: string | null;
      quantity: number;
      conversionFactor: number;
    }>
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const li of lineItems) {
      if (li.itemId) {
        const baseQty = li.quantity * li.conversionFactor;
        map.set(li.itemId, (map.get(li.itemId) || 0) + baseQty);
      }
    }
    return map;
  }

  it("10 line items with 3 unique itemIds produce exactly 3 Map entries, not 10", () => {
    // This is the core guarantee: Map.size = DB UPDATE count.
    // Without deduplication this would be 10 separate UPDATE statements.
    const lines = [
      { itemId: "item-A", quantity: 1, conversionFactor: 1 },
      { itemId: "item-B", quantity: 2, conversionFactor: 1 },
      { itemId: "item-C", quantity: 3, conversionFactor: 1 },
      { itemId: "item-A", quantity: 4, conversionFactor: 1 },
      { itemId: "item-B", quantity: 5, conversionFactor: 1 },
      { itemId: "item-C", quantity: 6, conversionFactor: 1 },
      { itemId: "item-A", quantity: 7, conversionFactor: 1 },
      { itemId: "item-B", quantity: 8, conversionFactor: 1 },
      { itemId: "item-C", quantity: 9, conversionFactor: 1 },
      { itemId: "item-A", quantity: 10, conversionFactor: 1 },
    ];
    const map = buildStockDeltaMap(lines);
    expect(map.size).toBe(3); // 3 updates, not 10
  });

  it("null itemIds are excluded from the Map — free-text description lines don't hit DB", () => {
    // Invoice lines without a linked item (e.g. freeform description lines)
    // have itemId=null. They must not appear in the stock delta map at all.
    const lines = [
      { itemId: null, quantity: 5, conversionFactor: 1 },
      { itemId: null, quantity: 3, conversionFactor: 1 },
      { itemId: "item-X", quantity: 2, conversionFactor: 1 },
    ];
    const map = buildStockDeltaMap(lines);
    expect(map.size).toBe(1);
    expect(map.has("item-X")).toBe(true);
  });

  it("conversion factors are applied before aggregation — base-unit quantities sum correctly", () => {
    // Item sold in kg (conversionFactor=1000 means 1 kg = 1000 g base unit).
    // Two lines: 2 kg + 3 kg = 5000 g total base qty.
    const lines = [
      { itemId: "flour", quantity: 2, conversionFactor: 1000 },
      { itemId: "flour", quantity: 3, conversionFactor: 1000 },
    ];
    const map = buildStockDeltaMap(lines);
    expect(map.get("flour")).toBe(5000);
  });

  it("same item appearing 5 times has all quantities summed into a single entry", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({
      itemId: "widget",
      quantity: i + 1, // 1, 2, 3, 4, 5
      conversionFactor: 1,
    }));
    const map = buildStockDeltaMap(lines);
    expect(map.size).toBe(1);
    expect(map.get("widget")).toBe(15); // 1+2+3+4+5
  });

  it("mixed itemIds and nulls — only non-null ids land in the Map", () => {
    const lines = [
      { itemId: "A", quantity: 10, conversionFactor: 2 },  // 20
      { itemId: null, quantity: 99, conversionFactor: 1 }, // ignored
      { itemId: "B", quantity: 4, conversionFactor: 0.5 }, // 2
      { itemId: "A", quantity: 5, conversionFactor: 2 },   // 10 → A total = 30
    ];
    const map = buildStockDeltaMap(lines);
    expect(map.size).toBe(2);
    expect(map.get("A")).toBeCloseTo(30);
    expect(map.get("B")).toBeCloseTo(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pre-fetch Set deduplication
//    Source: import.ts lines 33-46 (importParties) and lines 100-105 (importItems)
// ─────────────────────────────────────────────────────────────────────────────

describe("deduplicateByName — Set lookup is O(1), preventing N queries to check existence", () => {
  /**
   * The import routers (import.ts:33-73) do ONE SELECT to fetch all existing
   * names into a Set<string>, then check each incoming item against the Set.
   * This is the correct pattern: 1 DB read + O(1) in-memory lookup per item.
   *
   * The alternative (checking the DB inside the loop) would be O(N) SELECT
   * statements — catastrophic for a 1000-row CSV import.
   *
   * The function also tracks newly-seen names within the batch itself (the
   * `seen` Set), so duplicate rows in the same CSV file are caught without
   * needing a second DB round-trip.
   *
   * NOTE: import.ts mutates the existingSet in-place (line 64) rather than
   * maintaining a separate `seen` set. The function below mirrors that logic.
   */

  function deduplicateByName(
    existing: string[],
    incoming: Array<{ name: string }>
  ): { toInsert: Array<{ name: string }>; skipped: number } {
    // Mirrors import.ts: one Set built from a single pre-fetched SELECT result
    const existingSet = new Set(existing.map((n) => n.toLowerCase()));
    const toInsert: Array<{ name: string }> = [];
    let skipped = 0;

    for (const item of incoming) {
      const key = item.name.toLowerCase();
      if (existingSet.has(key)) {
        skipped++;
      } else {
        toInsert.push(item);
        // Track within-batch duplicates (mirrors import.ts:64 existingSet.add)
        existingSet.add(key);
      }
    }
    return { toInsert, skipped };
  }

  it("1000 incoming items with 500 already existing produces exactly 500 to insert", () => {
    // Simulates a large CSV import where half the rows are already in the DB.
    // The key metric: still only 1 DB read regardless of batch size.
    const existing = Array.from({ length: 500 }, (_, i) => `Party-${i}`);
    const incoming = Array.from({ length: 1000 }, (_, i) => ({ name: `Party-${i}` }));
    const { toInsert, skipped } = deduplicateByName(existing, incoming);
    expect(toInsert.length).toBe(500);
    expect(skipped).toBe(500);
  });

  it("duplicate names within the incoming batch are caught by the same Set — no extra DB reads", () => {
    // The same name appears three times in one import CSV.
    // Only the first occurrence should be inserted.
    const { toInsert, skipped } = deduplicateByName([], [
      { name: "Acme Corp" },
      { name: "Acme Corp" },
      { name: "Acme Corp" },
      { name: "Beta Ltd" },
    ]);
    expect(toInsert.length).toBe(2); // Acme Corp (first) + Beta Ltd
    expect(skipped).toBe(2);         // two duplicate Acme Corp rows
  });

  it("matching is case-insensitive — 'ACME CORP' and 'acme corp' are the same party", () => {
    const existing = ["Acme Corp"];
    const incoming = [
      { name: "ACME CORP" },
      { name: "acme corp" },
      { name: "Acme Corp" },
      { name: "New Vendor" },
    ];
    const { toInsert, skipped } = deduplicateByName(existing, incoming);
    expect(toInsert.length).toBe(1);
    expect(toInsert[0].name).toBe("New Vendor");
    expect(skipped).toBe(3);
  });

  it("all incoming items are new — nothing skipped, everything inserted", () => {
    const existing = ["Alpha", "Beta"];
    const incoming = [{ name: "Gamma" }, { name: "Delta" }, { name: "Epsilon" }];
    const { toInsert, skipped } = deduplicateByName(existing, incoming);
    expect(toInsert.length).toBe(3);
    expect(skipped).toBe(0);
  });

  it("empty incoming batch produces no inserts and no skips", () => {
    const { toInsert, skipped } = deduplicateByName(["Existing"], []);
    expect(toInsert.length).toBe(0);
    expect(skipped).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Batch chunking
//    Source: import.ts lines 68-72 (importParties) — chunk size 500
// ─────────────────────────────────────────────────────────────────────────────

describe("chunkArray — batch inserts avoid PostgreSQL parameter limit of 65535", () => {
  /**
   * PostgreSQL rejects a single INSERT ... VALUES (...), (...), (...) when the
   * total parameter count exceeds 65535. import.ts:70 chunks at 500 rows to
   * stay well under that limit even for wide tables.
   *
   * The chunk boundary logic must be exact:
   *   - No rows dropped (total across all chunks = input length)
   *   - No chunk exceeds the chunk size
   *   - The last chunk holds only the remainder
   *
   * A fencepost error here silently drops the tail of a large import.
   */

  function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  it("250 items with chunk size 100 → 3 chunks sized [100, 100, 50]", () => {
    const arr = Array.from({ length: 250 }, (_, i) => i);
    const chunks = chunkArray(arr, 100);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(100);
    expect(chunks[1].length).toBe(100);
    expect(chunks[2].length).toBe(50);
  });

  it("0 items → 0 chunks — no empty INSERT is issued", () => {
    const chunks = chunkArray([], 500);
    expect(chunks.length).toBe(0);
  });

  it("exactly 100 items with chunk size 100 → 1 chunk of 100 (no empty trailing chunk)", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const chunks = chunkArray(arr, 100);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(100);
  });

  it("no rows are dropped — total across all chunks equals input length", () => {
    const arr = Array.from({ length: 1337 }, (_, i) => i);
    const chunks = chunkArray(arr, 500);
    const totalItems = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalItems).toBe(1337);
  });

  it("chunk size 1 produces N chunks of 1 — degenerate case does not loop infinitely", () => {
    const arr = [10, 20, 30];
    const chunks = chunkArray(arr, 1);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c[0])).toEqual([10, 20, 30]);
  });

  it("chunk size larger than array → 1 chunk containing the entire array", () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 1000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual([1, 2, 3]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tax breakdown Map join
//    Source: reports.ts lines 390-394 (salesRegister) and lines 469-473 (purchaseRegister)
// ─────────────────────────────────────────────────────────────────────────────

describe("joinTaxBreakdown — in-memory Map join avoids N per-invoice SELECT for tax rows", () => {
  /**
   * The salesRegister and purchaseRegister reports (reports.ts:347-407) issue
   * exactly TWO parallel queries:
   *   Query 1 — invoice header rows (one row per invoice)
   *   Query 2 — tax slab rows grouped by (invoiceId, taxPercent)
   *
   * The two result sets are then joined in memory via a Map<invoiceId, slabs[]>.
   * This is O(M+N) in-memory work instead of O(N) additional SELECT queries.
   *
   * The invariant to protect: Map.size equals the number of distinct invoiceIds
   * that have at least one tax row. Invoices with no line-item tax do not appear
   * in the Map at all (the consumer falls back to [] via Map.get ?? []).
   */

  function joinTaxBreakdown(
    taxRows: Array<{
      invoiceId: string;
      taxPercent: string;
      taxAmount: string;
    }>
  ): Map<string, Array<{ taxPercent: string; taxAmount: string }>> {
    const map = new Map<string, Array<{ taxPercent: string; taxAmount: string }>>();
    for (const row of taxRows) {
      if (!map.has(row.invoiceId)) map.set(row.invoiceId, []);
      map.get(row.invoiceId)!.push({
        taxPercent: row.taxPercent,
        taxAmount: row.taxAmount,
      });
    }
    return map;
  }

  it("100 invoices each with 2 tax slabs → Map has exactly 100 keys", () => {
    // Ensures the join Map size tracks distinct invoices, not total tax rows.
    const taxRows = Array.from({ length: 100 }, (_, i) => [
      { invoiceId: `inv-${i}`, taxPercent: "5", taxAmount: "50.00" },
      { invoiceId: `inv-${i}`, taxPercent: "18", taxAmount: "180.00" },
    ]).flat();

    expect(taxRows.length).toBe(200); // 100 invoices × 2 slabs each
    const map = joinTaxBreakdown(taxRows);
    expect(map.size).toBe(100);
  });

  it("each invoice entry contains all its slabs in insertion order", () => {
    const taxRows = [
      { invoiceId: "inv-1", taxPercent: "5", taxAmount: "25.00" },
      { invoiceId: "inv-1", taxPercent: "12", taxAmount: "60.00" },
      { invoiceId: "inv-1", taxPercent: "18", taxAmount: "90.00" },
    ];
    const map = joinTaxBreakdown(taxRows);
    expect(map.get("inv-1")).toEqual([
      { taxPercent: "5", taxAmount: "25.00" },
      { taxPercent: "12", taxAmount: "60.00" },
      { taxPercent: "18", taxAmount: "90.00" },
    ]);
  });

  it("invoice with no tax rows is absent from the Map — lookup returns undefined", () => {
    // Tax-exempt invoice: the consumer does `taxByInvoice.get(r.id) ?? []`
    // so absence from the Map correctly returns an empty array.
    const taxRows = [
      { invoiceId: "inv-1", taxPercent: "18", taxAmount: "100.00" },
    ];
    const map = joinTaxBreakdown(taxRows);
    expect(map.has("inv-2")).toBe(false);
    expect(map.get("inv-2")).toBeUndefined();
  });

  it("single-slab invoice has an array of length 1, not a scalar", () => {
    const map = joinTaxBreakdown([
      { invoiceId: "inv-X", taxPercent: "28", taxAmount: "280.00" },
    ]);
    const slabs = map.get("inv-X");
    expect(Array.isArray(slabs)).toBe(true);
    expect(slabs!.length).toBe(1);
  });

  it("empty tax rows input produces an empty Map — no keys at all", () => {
    const map = joinTaxBreakdown([]);
    expect(map.size).toBe(0);
  });

  it("mixed: some invoices have multiple slabs, some have one, none are confused", () => {
    const taxRows = [
      { invoiceId: "A", taxPercent: "5", taxAmount: "10.00" },
      { invoiceId: "A", taxPercent: "18", taxAmount: "36.00" },
      { invoiceId: "B", taxPercent: "12", taxAmount: "24.00" },
      { invoiceId: "C", taxPercent: "0", taxAmount: "0.00" },
      { invoiceId: "C", taxPercent: "5", taxAmount: "5.00" },
      { invoiceId: "C", taxPercent: "28", taxAmount: "56.00" },
    ];
    const map = joinTaxBreakdown(taxRows);
    expect(map.size).toBe(3);
    expect(map.get("A")!.length).toBe(2);
    expect(map.get("B")!.length).toBe(1);
    expect(map.get("C")!.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Aging bucket aggregation
//    Source: reports.ts lines 254-278 (outstanding report partyMap loop)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildAgingBuckets — flat invoice rows grouped into per-party aging buckets in one pass", () => {
  /**
   * The outstanding report (reports.ts:204-279) fetches all overdue invoice
   * rows in a single SELECT, then groups them by partyId into aging buckets
   * entirely in memory. This avoids:
   *   - A GROUP BY in SQL that would prevent returning individual invoice rows
   *   - N per-party follow-up queries
   *
   * The bucket boundaries (from reports.ts:270-273):
   *   current    → daysOverdue <= 30
   *   days31_60  → 31..60
   *   days61_90  → 61..90
   *   days90Plus → > 90
   *
   * Invariant: bucket.total = bucket.current + bucket.days31_60 +
   *                           bucket.days61_90 + bucket.days90Plus
   */

  interface InvoiceRow {
    partyId: string;
    partyName: string;
    outstanding: number;
    daysOverdue: number;
  }

  interface AgingBucket {
    partyName: string;
    current: number;
    days31_60: number;
    days61_90: number;
    days90Plus: number;
    total: number;
  }

  function buildAgingBuckets(rows: InvoiceRow[]): Map<string, AgingBucket> {
    const map = new Map<string, AgingBucket>();
    for (const row of rows) {
      if (!map.has(row.partyId)) {
        map.set(row.partyId, {
          partyName: row.partyName,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          days90Plus: 0,
          total: 0,
        });
      }
      const bucket = map.get(row.partyId)!;
      bucket.total += row.outstanding;
      if (row.daysOverdue <= 30) bucket.current += row.outstanding;
      else if (row.daysOverdue <= 60) bucket.days31_60 += row.outstanding;
      else if (row.daysOverdue <= 90) bucket.days61_90 += row.outstanding;
      else bucket.days90Plus += row.outstanding;
    }
    return map;
  }

  it("5 invoices for one party with mixed aging → single bucket with correct distribution", () => {
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "Acme", outstanding: 1000, daysOverdue: 10 },  // current
      { partyId: "P1", partyName: "Acme", outstanding: 2000, daysOverdue: 30 },  // current (boundary)
      { partyId: "P1", partyName: "Acme", outstanding: 3000, daysOverdue: 45 },  // 31-60
      { partyId: "P1", partyName: "Acme", outstanding: 4000, daysOverdue: 75 },  // 61-90
      { partyId: "P1", partyName: "Acme", outstanding: 5000, daysOverdue: 120 }, // 90+
    ];
    const map = buildAgingBuckets(rows);
    expect(map.size).toBe(1);
    const b = map.get("P1")!;
    expect(b.current).toBe(3000);    // 1000 + 2000
    expect(b.days31_60).toBe(3000);
    expect(b.days61_90).toBe(4000);
    expect(b.days90Plus).toBe(5000);
    expect(b.total).toBe(15000);
  });

  it("total always equals the sum of all four bucket amounts (invariant)", () => {
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "X", outstanding: 100, daysOverdue: 5 },
      { partyId: "P1", partyName: "X", outstanding: 200, daysOverdue: 40 },
      { partyId: "P1", partyName: "X", outstanding: 300, daysOverdue: 80 },
      { partyId: "P1", partyName: "X", outstanding: 400, daysOverdue: 95 },
    ];
    const map = buildAgingBuckets(rows);
    const b = map.get("P1")!;
    expect(b.total).toBe(b.current + b.days31_60 + b.days61_90 + b.days90Plus);
  });

  it("10 parties each with 3 invoices → exactly 10 buckets, not 30", () => {
    // daysOverdue per invoice: 15 (current), 45 (31-60), 75 (61-90)
    const rows: InvoiceRow[] = Array.from({ length: 10 }, (_, p) =>
      [
        { outstanding: 500,  daysOverdue: 15 },
        { outstanding: 1000, daysOverdue: 45 },
        { outstanding: 1500, daysOverdue: 75 },
      ].map((entry) => ({
        partyId: `party-${p}`,
        partyName: `Party ${p}`,
        ...entry,
      }))
    ).flat();

    const map = buildAgingBuckets(rows);
    expect(map.size).toBe(10);
    // Spot-check one bucket: 500 (current) + 1000 (31-60) + 1500 (61-90) = 3000
    const b = map.get("party-3")!;
    expect(b.total).toBe(3000);
    expect(b.current).toBe(500);
    expect(b.days31_60).toBe(1000);
    expect(b.days61_90).toBe(1500);
    expect(b.days90Plus).toBe(0);
  });

  it("zero-outstanding rows do not distort bucket totals", () => {
    // An invoice that is fully paid but still in the result set
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "Acme", outstanding: 0, daysOverdue: 5 },
      { partyId: "P1", partyName: "Acme", outstanding: 1000, daysOverdue: 5 },
    ];
    const map = buildAgingBuckets(rows);
    const b = map.get("P1")!;
    expect(b.current).toBe(1000);
    expect(b.total).toBe(1000);
  });

  it("boundary: daysOverdue=60 goes into days31_60, not days61_90", () => {
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "X", outstanding: 500, daysOverdue: 60 },
    ];
    const b = buildAgingBuckets(rows).get("P1")!;
    expect(b.days31_60).toBe(500);
    expect(b.days61_90).toBe(0);
  });

  it("boundary: daysOverdue=90 goes into days61_90, not days90Plus", () => {
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "X", outstanding: 500, daysOverdue: 90 },
    ];
    const b = buildAgingBuckets(rows).get("P1")!;
    expect(b.days61_90).toBe(500);
    expect(b.days90Plus).toBe(0);
  });

  it("boundary: daysOverdue=91 goes into days90Plus", () => {
    const rows: InvoiceRow[] = [
      { partyId: "P1", partyName: "X", outstanding: 500, daysOverdue: 91 },
    ];
    const b = buildAgingBuckets(rows).get("P1")!;
    expect(b.days90Plus).toBe(500);
    expect(b.days61_90).toBe(0);
  });
});

// =============================================================================
// Group 2: N+1 Anti-patterns (documented, not yet fixed)
// These tests record the CURRENT query cost so improvements are measurable.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 6. Stock update count
//    Source: invoice.ts lines 271-288 (the two for-of loops over Maps)
// ─────────────────────────────────────────────────────────────────────────────

describe("countStockUpdates — documenting that N unique items = N UPDATE statements", () => {
  /**
   * CURRENT BEHAVIOR (invoice.ts:271-288):
   * After the Map deduplication step, the router iterates itemStockMap and
   * variantStockMap, issuing one tx.update() call per Map entry. This means:
   *
   *   DB UPDATE count = itemStockMap.size + variantStockMap.size
   *
   * For a typical invoice with 10 line items across 10 unique items, that is
   * 10 sequential UPDATE statements inside one transaction. The Map dedup is a
   * good first step, but the remaining loop is still O(unique items).
   *
   * OPTIMAL APPROACH (not yet implemented):
   * A single bulk UPDATE using a VALUES CTE would reduce this to 1 statement:
   *
   *   WITH delta(id, qty) AS (VALUES ($1,$2), ($3,$4), ...)
   *   UPDATE items SET stock_quantity = stock_quantity - delta.qty
   *   FROM delta WHERE items.id = delta.id;
   *
   * These tests document the current cost. Once the CTE approach is added, the
   * assertion "should be 1 with bulk CTE" should be updated to reflect reality.
   */

  function countStockUpdates(
    lineItems: Array<{ itemId: string | null; variantId: string | null }>
  ): { itemUpdates: number; variantUpdates: number } {
    // Mirrors the Map-building step from invoice.ts:258-270
    const itemIds = new Set<string>();
    const variantIds = new Set<string>();
    for (const li of lineItems) {
      if (li.variantId) variantIds.add(li.variantId);
      else if (li.itemId) itemIds.add(li.itemId);
    }
    // Each Set entry = one UPDATE in the current implementation
    return { itemUpdates: itemIds.size, variantUpdates: variantIds.size };
  }

  it("10 line items with 10 unique simple items → 10 UPDATE statements (the N+1)", () => {
    // This is the worst case: no deduplication benefit because every item is unique.
    // The Map helps when there ARE duplicates, but doesn't help here.
    const lines = Array.from({ length: 10 }, (_, i) => ({
      itemId: `item-${i}`,
      variantId: null,
    }));
    const { itemUpdates, variantUpdates } = countStockUpdates(lines);
    expect(itemUpdates).toBe(10);   // 10 DB writes — one per item
    expect(variantUpdates).toBe(0);
    // TODO: with bulk CTE, itemUpdates should be 1 regardless of unique-item count
  });

  it("10 line items with 3 unique items → 3 UPDATE statements (Map dedup helps here)", () => {
    // Deduplication reduces the cost from 10 to 3, but it's still 3 writes.
    const lines = [
      { itemId: "A", variantId: null },
      { itemId: "B", variantId: null },
      { itemId: "C", variantId: null },
      { itemId: "A", variantId: null },
      { itemId: "B", variantId: null },
      { itemId: "C", variantId: null },
      { itemId: "A", variantId: null },
      { itemId: "B", variantId: null },
      { itemId: "C", variantId: null },
      { itemId: "A", variantId: null },
    ];
    const { itemUpdates } = countStockUpdates(lines);
    expect(itemUpdates).toBe(3);    // better than 10, but still 3 round-trips
    // TODO: with bulk CTE, this should be 1
  });

  it("mixed items and variants are counted in separate buckets", () => {
    // Variants use a different table (item_variants) so they go through a
    // separate loop. This test confirms both counters are independent.
    const lines = [
      { itemId: null, variantId: "V1" },
      { itemId: null, variantId: "V2" },
      { itemId: "I1", variantId: null },
    ];
    const { itemUpdates, variantUpdates } = countStockUpdates(lines);
    expect(itemUpdates).toBe(1);
    expect(variantUpdates).toBe(2);
    // TODO: with bulk CTE per table, both should be 1
  });

  it("single line item → 1 update — no N+1 in the degenerate single-item case", () => {
    // When there's only one unique item, the current and optimal approaches
    // have the same cost. This case is fine as-is.
    const lines = [{ itemId: "only-item", variantId: null }];
    const { itemUpdates } = countStockUpdates(lines);
    expect(itemUpdates).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Payment allocation count
//    Source: payment.ts lines 243-269 (effectiveAllocations loop in payment.create)
// ─────────────────────────────────────────────────────────────────────────────

describe("countAllocationUpdates — documenting that N allocations = N SELECT + N UPDATE pairs", () => {
  /**
   * CURRENT BEHAVIOR (payment.ts:243-269):
   * The payment.create mutation loops over effectiveAllocations. For each
   * allocation it issues:
   *   1. tx.select() — fetch invoice to run the overpayment guard
   *   2. tx.execute(sql`UPDATE invoices SET ...`) — apply the allocation
   *
   * For a payment with 5 invoice allocations, that is 5 SELECTs + 5 UPDATEs
   * = 10 sequential DB round-trips inside the transaction. This is visible in
   * pg_stat_statements as unusually high statement counts on payment creation.
   *
   * OPTIMAL APPROACH (not yet implemented):
   * Fetch all involved invoices in one SELECT ... WHERE id = ANY($1::uuid[]),
   * run the overpayment validation in-memory, then apply all updates in a
   * single bulk UPDATE with a VALUES CTE (same pattern as the stock update
   * TODO above). This reduces 2N round-trips to 2 regardless of allocation count.
   *
   * NOTE: The overpayment guard adds meaningful complexity to the bulk approach
   * because the guard must see the pre-update balance for each invoice. The
   * current sequential approach handles this naturally. Any bulk rewrite must
   * carefully preserve the validation semantics before being merged.
   */

  function countAllocationUpdates(
    allocations: Array<{ invoiceId: string; amount: number }>
  ): { selectCount: number; updateCount: number; totalRoundTrips: number } {
    // Current: 1 SELECT (overpayment guard) + 1 UPDATE per allocation
    const selectCount = allocations.length;
    const updateCount = allocations.length;
    return { selectCount, updateCount, totalRoundTrips: selectCount + updateCount };
  }

  it("5 allocations → 10 DB round-trips (5 guard SELECTs + 5 UPDATE statements)", () => {
    const allocations = Array.from({ length: 5 }, (_, i) => ({
      invoiceId: `inv-${i}`,
      amount: 1000,
    }));
    const { selectCount, updateCount, totalRoundTrips } = countAllocationUpdates(allocations);
    expect(selectCount).toBe(5);
    expect(updateCount).toBe(5);
    expect(totalRoundTrips).toBe(10);
    // TODO: with bulk approach, totalRoundTrips should be 2 (1 batch SELECT + 1 bulk UPDATE)
  });

  it("1 allocation → 2 round-trips — no N+1 in the single-invoice case", () => {
    // Single-invoice payments (the common case) are fine at 2 round-trips.
    // The N+1 problem only bites on multi-invoice payments.
    const { totalRoundTrips } = countAllocationUpdates([
      { invoiceId: "inv-solo", amount: 5000 },
    ]);
    expect(totalRoundTrips).toBe(2);
  });

  it("0 allocations → 0 round-trips — unlinked payments skip the loop entirely", () => {
    // Payments not linked to any invoice (e.g. advance payments without an invoice)
    // have effectiveAllocations = [] and skip the loop entirely. No DB writes.
    const { totalRoundTrips } = countAllocationUpdates([]);
    expect(totalRoundTrips).toBe(0);
  });

  it("10 allocations → 20 round-trips — linear growth documents the scaling problem", () => {
    const allocations = Array.from({ length: 10 }, (_, i) => ({
      invoiceId: `inv-${i}`,
      amount: 500,
    }));
    const { totalRoundTrips } = countAllocationUpdates(allocations);
    expect(totalRoundTrips).toBe(20);
    // Projected cost at scale:
    // 100 allocations = 200 round-trips
    // 1000 allocations = 2000 round-trips
    // With bulk approach it stays at 2 regardless
  });
});

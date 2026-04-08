/**
 * Tests for GST report logic in lib/gst-reports.ts.
 *
 * WHY THIS FILE EXISTS:
 * The GSTR-1 generator contains several pure classification and aggregation
 * functions that are embedded inside generateGSTR1(). These functions carry
 * real-money consequences — a wrong B2B/B2C split causes incorrect GSTN filings
 * and potential penalties. A wrong state comparison causes CGST/SGST to be
 * reported as IGST (or vice versa), which the GST portal will flag as a mismatch.
 *
 * Three embedded functions are extracted verbatim and tested in full isolation:
 *
 * 1. isSameState — decides intra-state vs inter-state using stateCode (preferred)
 *    with text fallback. Drives the CGST/SGST vs IGST split for every invoice.
 *
 * 2. B2B/B2C classification — determines which section of GSTR-1 each invoice
 *    belongs to. B2B requires a GSTIN; B2C Large requires inter-state + total
 *    > ₹2.5L; everything else is B2C Small.
 *
 * 3. Tax split — converts a single tax amount into CGST/SGST (intra-state) or
 *    IGST (inter-state). The split formula is tax/2 each for intra-state.
 *
 * 4. HSN aggregation — groups line items by HSN code, summing quantity and
 *    values. Missing HSN defaults to "0000".
 *
 * The exported gstr1ToCSV() function is imported and tested directly for CSV
 * structure, period format, B2B row content, and comma escaping.
 *
 * APPROACH:
 * All section 1-4 tests are pure-function tests — no DB, no mocking, no async.
 * Functions are copied verbatim from the source (same pattern as shipment.test.ts).
 *
 * SOURCE REFERENCES:
 *   packages/api/src/lib/gst-reports.ts  lines 184-191   isSameState
 *   packages/api/src/lib/gst-reports.ts  lines 222-256   B2B/B2C classification
 *   packages/api/src/lib/gst-reports.ts  lines 211-213   tax split formula
 *   packages/api/src/lib/gst-reports.ts  lines 259-279   HSN aggregation
 *   packages/api/src/lib/gst-reports.ts  lines 472-517   gstr1ToCSV
 */

import { describe, it, expect } from "vitest";
import { gstr1ToCSV, gstr1ToPortalJson, type GSTR1Report } from "../lib/gst-reports.js";

// =============================================================================
// Pure functions — extracted verbatim from lib/gst-reports.ts
// =============================================================================

/**
 * Mirrors gst-reports.ts:184-191 (inside generateGSTR1).
 *
 * Prefers state code (2-digit GST codes) for comparison since codes are
 * authoritative and consistent. Falls back to text comparison when codes are
 * absent — covers old data or parties where stateCode was not captured.
 *
 * The biz object is partially reproduced here as a closure variable that the
 * test suite can swap per describe block.
 */
function makeIsSameState(biz: {
  stateCode?: string | null;
  state?: string | null;
}) {
  return function isSameState(
    partyState: string | null,
    partyStateCode: string | null
  ): boolean | undefined {
    // Prefer state code comparison (2-digit GST codes — more reliable)
    if (biz?.stateCode && partyStateCode) {
      return biz.stateCode === partyStateCode;
    }
    // Fallback to text comparison
    return biz?.state && partyState
      ? biz.state.toLowerCase() === partyState.toLowerCase()
      : false;
  };
}

/**
 * Tax split formula — mirrors gst-reports.ts:211-213.
 *
 * Same-state: tax is split equally between CGST and SGST, IGST=0.
 * Inter-state: full tax goes to IGST, CGST and SGST are 0.
 */
function splitTax(
  tax: number,
  sameState: boolean
): { cgst: number; sgst: number; igst: number } {
  const cgst = sameState ? tax / 2 : 0;
  const sgst = sameState ? tax / 2 : 0;
  const igst = sameState ? 0 : tax;
  return { cgst, sgst, igst };
}

/**
 * B2B/B2C classification — mirrors gst-reports.ts:222-255.
 *
 * Returns the section an invoice should be filed under.
 * Note: total is the invoice total (taxable + tax), used for the ₹2.5L threshold.
 */
type InvoiceSection = "b2b" | "b2cLarge" | "b2cSmall";

function classifyInvoice(
  partyGstin: string | null | undefined,
  sameState: boolean,
  total: number
): InvoiceSection {
  if (partyGstin) {
    return "b2b";
  } else if (!sameState && total > 250000) {
    return "b2cLarge";
  } else {
    return "b2cSmall";
  }
}

/**
 * HSN aggregation step — mirrors gst-reports.ts:259-279.
 *
 * Processes a single line item into an accumulator Map keyed by HSN code.
 * The Map shape matches GSTR1Report["hsn"][0].
 */
type HsnEntry = {
  hsn: string;
  description: string;
  quantity: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalValue: number;
};

function aggregateHsnLineItem(
  map: Map<string, HsnEntry>,
  lineItem: {
    itemId: string | null;
    description: string;
    quantity: string;
    totalAmount: string;
    taxAmount: string;
  },
  hsnFromLookup: string,
  sameState: boolean
): void {
  const existing = map.get(hsnFromLookup) ?? {
    hsn: hsnFromLookup,
    description: lineItem.description,
    quantity: 0,
    taxableValue: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalValue: 0,
  };
  const itemTaxable =
    parseFloat(lineItem.totalAmount) - parseFloat(lineItem.taxAmount);
  const itemTax = parseFloat(lineItem.taxAmount);
  existing.quantity += parseFloat(lineItem.quantity);
  existing.taxableValue += itemTaxable;
  existing.totalValue += parseFloat(lineItem.totalAmount);
  if (sameState) {
    existing.cgst += itemTax / 2;
    existing.sgst += itemTax / 2;
  } else {
    existing.igst += itemTax;
  }
  map.set(hsnFromLookup, existing);
}

// =============================================================================
// Section 1: isSameState — state code (preferred) + text fallback
//
// Guards the CGST/SGST vs IGST decision for every invoice. A wrong answer
// here means tax is filed under the wrong head at the portal.
// =============================================================================

describe("isSameState — state code comparison (preferred path)", () => {
  /**
   * GST state codes are authoritative 2-digit numbers assigned by the GSTN
   * (e.g., "27" = Maharashtra, "07" = Delhi, "29" = Karnataka).
   * When both biz and party have stateCode, the text field is ignored entirely.
   */

  it("returns true when business stateCode matches party stateCode (Maharashtra 27)", () => {
    const isSameState = makeIsSameState({ stateCode: "27", state: "Maharashtra" });
    expect(isSameState("SomeOtherTextState", "27")).toBe(true);
  });

  it("returns false when business stateCode differs from party stateCode", () => {
    // Business in MH (27), party in Karnataka (29)
    const isSameState = makeIsSameState({ stateCode: "27", state: "Maharashtra" });
    expect(isSameState("Karnataka", "29")).toBe(false);
  });

  it("uses stateCode even when text fields disagree — stateCode wins", () => {
    // stateCode says same state ("27"="27"), text says different — code is authoritative
    const isSameState = makeIsSameState({ stateCode: "27", state: "Maharashtra" });
    expect(isSameState("Karnataka", "27")).toBe(true);
  });

  it("Delhi (07) vs Delhi (07) — single-digit zero-padded codes match", () => {
    const isSameState = makeIsSameState({ stateCode: "07", state: "Delhi" });
    expect(isSameState("Delhi", "07")).toBe(true);
  });

  it("returns false for two different state codes even when they look similar", () => {
    // "06" (Haryana) vs "07" (Delhi)
    const isSameState = makeIsSameState({ stateCode: "06", state: "Haryana" });
    expect(isSameState("Delhi", "07")).toBe(false);
  });
});

describe("isSameState — text fallback when stateCode is absent", () => {
  /**
   * Older party records may not have stateCode populated. The function falls
   * back to case-insensitive text comparison of the state name string.
   */

  it("returns true via text when both state names match (case-insensitive)", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: "Maharashtra" });
    expect(isSameState("Maharashtra", null)).toBe(true);
  });

  it("text comparison is case-insensitive — 'maharashtra' matches 'Maharashtra'", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: "Maharashtra" });
    expect(isSameState("maharashtra", null)).toBe(true);
  });

  it("text comparison is case-insensitive — 'MAHARASHTRA' matches 'Maharashtra'", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: "Maharashtra" });
    expect(isSameState("MAHARASHTRA", null)).toBe(true);
  });

  it("returns false via text when state names differ", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: "Maharashtra" });
    expect(isSameState("Karnataka", null)).toBe(false);
  });

  it("returns false when both stateCode and state text are unavailable on biz", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: null });
    expect(isSameState("Maharashtra", null)).toBe(false);
  });

  it("returns false when partyState is null and no stateCode available", () => {
    const isSameState = makeIsSameState({ stateCode: null, state: "Maharashtra" });
    expect(isSameState(null, null)).toBe(false);
  });

  it("falls back to text when biz has stateCode but party has no stateCode", () => {
    /**
     * Party stateCode is null — so the stateCode branch is not taken even
     * though biz.stateCode is set. Text comparison runs instead.
     */
    const isSameState = makeIsSameState({ stateCode: "27", state: "Maharashtra" });
    // partyStateCode is null → falls through to text comparison
    expect(isSameState("Maharashtra", null)).toBe(true);
    expect(isSameState("Karnataka", null)).toBe(false);
  });
});

// =============================================================================
// Section 2: B2B/B2C classification
//
// The GSTR-1 has three sections for outward supplies to unregistered persons.
// A wrong classification means data ends up in the wrong GSTR-1 table, causing
// filing errors at the portal.
// =============================================================================

describe("classifyInvoice — B2B vs B2C Large vs B2C Small", () => {
  /**
   * Classification rules (in order of priority):
   *   1. Party has GSTIN → B2B (regardless of amount or state)
   *   2. No GSTIN + inter-state + total > ₹2.5L → B2C Large (B2CL)
   *   3. Everything else → B2C Small (B2CS)
   */

  // ── B2B ─────────────────────────────────────────────────────────────────────

  it("classifies as B2B when party has GSTIN — intra-state", () => {
    // Ramesh Traders, Maharashtra, registered dealer
    expect(classifyInvoice("27ABCDE1234F1Z5", true, 50000)).toBe("b2b");
  });

  it("classifies as B2B when party has GSTIN — inter-state, any amount", () => {
    // Registered dealer in Karnataka buying from Maharashtra business
    expect(classifyInvoice("29XYZAB5678G1Z9", false, 300000)).toBe("b2b");
  });

  it("classifies as B2B when party has GSTIN — even below ₹2.5L threshold", () => {
    expect(classifyInvoice("07PQRST9999H1Z3", false, 100000)).toBe("b2b");
  });

  // ── B2C Large ────────────────────────────────────────────────────────────────

  it("classifies as B2C Large — inter-state, total > ₹2.5L, no GSTIN", () => {
    // Walk-in customer from Gujarat, large purchase
    expect(classifyInvoice(null, false, 300000)).toBe("b2cLarge");
  });

  it("classifies as B2C Large — inter-state, total exactly ₹250001", () => {
    // One rupee above the threshold flips to B2C Large
    expect(classifyInvoice(null, false, 250001)).toBe("b2cLarge");
  });

  it("boundary: total exactly ₹250000 is B2C Small, NOT B2C Large", () => {
    /**
     * The condition in the source is `total > 250000` (strictly greater than).
     * ₹250000 exactly does NOT qualify as B2C Large.
     */
    expect(classifyInvoice(null, false, 250000)).toBe("b2cSmall");
  });

  it("boundary: total ₹249999 is B2C Small", () => {
    expect(classifyInvoice(null, false, 249999)).toBe("b2cSmall");
  });

  // ── B2C Small ────────────────────────────────────────────────────────────────

  it("classifies as B2C Small — intra-state, no GSTIN, any amount", () => {
    // Local retail sale to consumer in Maharashtra
    expect(classifyInvoice(null, true, 500000)).toBe("b2cSmall");
  });

  it("classifies as B2C Small — intra-state, no GSTIN, amount below ₹2.5L", () => {
    expect(classifyInvoice(null, true, 50000)).toBe("b2cSmall");
  });

  it("classifies as B2C Small — inter-state, no GSTIN, amount <= ₹2.5L", () => {
    // Inter-state but small invoice → B2C Small
    expect(classifyInvoice(null, false, 200000)).toBe("b2cSmall");
  });

  it("classifies as B2C Small — undefined GSTIN treated same as null", () => {
    expect(classifyInvoice(undefined, false, 300000)).toBe("b2cLarge");
    expect(classifyInvoice(undefined, true, 300000)).toBe("b2cSmall");
  });

  it("classifies as B2C Small — empty string GSTIN is truthy enough to be B2B? No — empty string is falsy", () => {
    /**
     * An empty string GSTIN means the party is effectively unregistered.
     * Empty string is falsy in JS, so the B2B branch is NOT taken.
     */
    expect(classifyInvoice("", false, 300000)).toBe("b2cLarge");
  });
});

// =============================================================================
// Section 3: Tax split — CGST/SGST vs IGST
//
// The formula is simple but load-bearing: wrong split causes a GST mismatch
// that the GSTN portal will flag during GSTR-1 reconciliation.
// =============================================================================

describe("splitTax — intra-state yields CGST+SGST, inter-state yields IGST", () => {
  /**
   * GST rule: for intra-state supplies, tax is split equally between CGST
   * (central) and SGST (state). For inter-state supplies, the entire tax is
   * IGST (integrated). CGST and SGST are always zero for inter-state.
   */

  // ── Intra-state ──────────────────────────────────────────────────────────────

  it("intra-state ₹1800 tax → CGST=900, SGST=900, IGST=0", () => {
    const { cgst, sgst, igst } = splitTax(1800, true);
    expect(cgst).toBe(900);
    expect(sgst).toBe(900);
    expect(igst).toBe(0);
  });

  it("intra-state ₹360 tax (18% on ₹2000) → CGST=180, SGST=180, IGST=0", () => {
    const { cgst, sgst, igst } = splitTax(360, true);
    expect(cgst).toBe(180);
    expect(sgst).toBe(180);
    expect(igst).toBe(0);
  });

  it("intra-state ₹50 tax (5% on ₹1000) → CGST=25, SGST=25, IGST=0", () => {
    const { cgst, sgst, igst } = splitTax(50, true);
    expect(cgst).toBe(25);
    expect(sgst).toBe(25);
    expect(igst).toBe(0);
  });

  it("intra-state split is always equal — CGST === SGST", () => {
    const { cgst, sgst } = splitTax(720, true);
    expect(cgst).toBe(sgst);
  });

  // ── Inter-state ──────────────────────────────────────────────────────────────

  it("inter-state ₹1800 tax → CGST=0, SGST=0, IGST=1800", () => {
    const { cgst, sgst, igst } = splitTax(1800, false);
    expect(cgst).toBe(0);
    expect(sgst).toBe(0);
    expect(igst).toBe(1800);
  });

  it("inter-state ₹5400 tax → IGST=5400, CGST=0, SGST=0", () => {
    const { cgst, sgst, igst } = splitTax(5400, false);
    expect(igst).toBe(5400);
    expect(cgst).toBe(0);
    expect(sgst).toBe(0);
  });

  // ── Zero-tax items ───────────────────────────────────────────────────────────

  it("zero tax intra-state → CGST=0, SGST=0, IGST=0", () => {
    const { cgst, sgst, igst } = splitTax(0, true);
    expect(cgst).toBe(0);
    expect(sgst).toBe(0);
    expect(igst).toBe(0);
  });

  it("zero tax inter-state → all zeros", () => {
    const { cgst, sgst, igst } = splitTax(0, false);
    expect(cgst).toBe(0);
    expect(sgst).toBe(0);
    expect(igst).toBe(0);
  });

  // ── Multiple line items accumulation ─────────────────────────────────────────

  it("accumulating tax across multiple intra-state line items sums correctly", () => {
    /**
     * A single invoice can have items at different tax rates. The totals in
     * GSTR-1 are the sum of individual splits — not a single split on the total.
     */
    const line1 = splitTax(180, true); // 18% on ₹1000
    const line2 = splitTax(60, true); // 12% on ₹500
    const line3 = splitTax(0, true); // 0% exempt item

    const totalCgst = line1.cgst + line2.cgst + line3.cgst;
    const totalSgst = line1.sgst + line2.sgst + line3.sgst;
    const totalIgst = line1.igst + line2.igst + line3.igst;

    expect(totalCgst).toBe(120); // (180+60+0)/2
    expect(totalSgst).toBe(120);
    expect(totalIgst).toBe(0);
  });

  it("accumulating tax across multiple inter-state line items sums correctly", () => {
    const line1 = splitTax(1800, false); // 18% on ₹10000
    const line2 = splitTax(600, false); // 12% on ₹5000
    const line3 = splitTax(0, false); // 0% item

    const totalIgst = line1.igst + line2.igst + line3.igst;
    const totalCgst = line1.cgst + line2.cgst + line3.cgst;

    expect(totalIgst).toBe(2400);
    expect(totalCgst).toBe(0);
  });
});

// =============================================================================
// Section 4: HSN aggregation
//
// GSTR-1 requires an HSN-wise summary of all supplies. Items with the same
// HSN must be aggregated (not listed separately). Missing HSN codes default to
// "0000" per the source code.
// =============================================================================

describe("HSN aggregation — groups line items by HSN code", () => {
  /**
   * The HSN summary section of GSTR-1 groups all line items by HSN code and
   * sums their quantities and values. This is used for the HSN-wise table
   * (mandatory for businesses above ₹5Cr turnover).
   */

  it("aggregates quantity and taxable value for the same HSN code", () => {
    const map = new Map<string, HsnEntry>();

    aggregateHsnLineItem(
      map,
      { itemId: "item-1", description: "Cotton Fabric", quantity: "10", totalAmount: "11800.00", taxAmount: "1800.00" },
      "5208", // HSN for cotton fabric
      true
    );
    aggregateHsnLineItem(
      map,
      { itemId: "item-2", description: "Cotton Fabric Roll", quantity: "5", totalAmount: "5900.00", taxAmount: "900.00" },
      "5208",
      true
    );

    const entry = map.get("5208")!;
    expect(entry.quantity).toBe(15);
    expect(entry.taxableValue).toBeCloseTo(15000); // (11800-1800) + (5900-900) = 10000+5000
    expect(entry.totalValue).toBeCloseTo(17700); // 11800 + 5900
    expect(entry.cgst).toBeCloseTo(1350); // (1800+900)/2
    expect(entry.sgst).toBeCloseTo(1350);
    expect(entry.igst).toBe(0);
  });

  it("produces separate entries for different HSN codes", () => {
    const map = new Map<string, HsnEntry>();

    // Steel pipes — HSN 7306
    aggregateHsnLineItem(
      map,
      { itemId: "item-A", description: "Steel Pipe", quantity: "20", totalAmount: "23600.00", taxAmount: "3600.00" },
      "7306",
      true
    );

    // Brass fittings — HSN 7412
    aggregateHsnLineItem(
      map,
      { itemId: "item-B", description: "Brass Elbow", quantity: "50", totalAmount: "2950.00", taxAmount: "450.00" },
      "7412",
      true
    );

    expect(map.size).toBe(2);
    expect(map.has("7306")).toBe(true);
    expect(map.has("7412")).toBe(true);

    expect(map.get("7306")!.quantity).toBe(20);
    expect(map.get("7412")!.quantity).toBe(50);
  });

  it("defaults missing HSN to '0000'", () => {
    /**
     * In the source: `const itemHsn = li.itemId ? (itemHsnLookup.get(li.itemId) || "0000") : "0000"`
     * A line item with no itemId (free-text description) or an item without
     * a configured HSN code maps to the default bucket "0000".
     */
    const map = new Map<string, HsnEntry>();

    aggregateHsnLineItem(
      map,
      { itemId: null, description: "Miscellaneous Charges", quantity: "1", totalAmount: "1000.00", taxAmount: "0.00" },
      "0000",
      true
    );

    expect(map.has("0000")).toBe(true);
    expect(map.get("0000")!.hsn).toBe("0000");
    expect(map.get("0000")!.quantity).toBe(1);
  });

  it("multiple items with no HSN accumulate in the '0000' bucket", () => {
    const map = new Map<string, HsnEntry>();

    aggregateHsnLineItem(
      map,
      { itemId: null, description: "Labour Charges", quantity: "1", totalAmount: "2000.00", taxAmount: "0.00" },
      "0000",
      true
    );
    aggregateHsnLineItem(
      map,
      { itemId: null, description: "Packing Material", quantity: "3", totalAmount: "600.00", taxAmount: "0.00" },
      "0000",
      true
    );

    expect(map.size).toBe(1);
    const entry = map.get("0000")!;
    expect(entry.quantity).toBe(4); // 1+3
    expect(entry.taxableValue).toBeCloseTo(2600); // 2000+600
  });

  it("inter-state line items contribute to IGST, not CGST/SGST", () => {
    const map = new Map<string, HsnEntry>();

    aggregateHsnLineItem(
      map,
      { itemId: "item-X", description: "Solar Panel", quantity: "2", totalAmount: "23600.00", taxAmount: "3600.00" },
      "8541", // HSN for solar cells/panels
      false // inter-state
    );

    const entry = map.get("8541")!;
    expect(entry.igst).toBeCloseTo(3600);
    expect(entry.cgst).toBe(0);
    expect(entry.sgst).toBe(0);
  });

  it("mixed HSN codes across intra and inter-state are tracked independently", () => {
    const map = new Map<string, HsnEntry>();

    // Intra-state item, HSN 8471 (computers)
    aggregateHsnLineItem(
      map,
      { itemId: "laptop-1", description: "Laptop", quantity: "1", totalAmount: "94400.00", taxAmount: "14400.00" },
      "8471",
      true
    );

    // Inter-state item, same HSN 8471
    aggregateHsnLineItem(
      map,
      { itemId: "laptop-2", description: "Laptop (export)", quantity: "2", totalAmount: "188800.00", taxAmount: "28800.00" },
      "8471",
      false
    );

    const entry = map.get("8471")!;
    expect(entry.quantity).toBe(3);
    // CGST/SGST only from intra-state item
    expect(entry.cgst).toBeCloseTo(7200); // 14400/2
    expect(entry.sgst).toBeCloseTo(7200);
    // IGST only from inter-state item
    expect(entry.igst).toBeCloseTo(28800);
  });
});

// =============================================================================
// Section 5: gstr1ToCSV — exported function, tested directly
//
// The CSV output is the primary artifact businesses use to file GSTR-1 offline.
// Structure and content correctness is therefore critical.
// =============================================================================

/**
 * Builds a minimal but complete GSTR1Report fixture for CSV testing.
 * Using a factory avoids repetition while keeping individual tests readable.
 */
function makeReport(overrides: Partial<GSTR1Report> = {}): GSTR1Report {
  return {
    period: "Apr 2025",
    businessGstin: "27AAAPL1234C1ZV",
    businessName: "Laxmi Enterprises",
    b2b: [],
    b2cLarge: [],
    b2cSmall: [],
    hsn: [],
    creditNotes: [],
    debitNotes: [],
    totalTaxableValue: 0,
    totalCgst: 0,
    totalSgst: 0,
    totalIgst: 0,
    totalTax: 0,
    totalInvoiceValue: 0,
    invoiceCount: 0,
    ...overrides,
  };
}

describe("gstr1ToCSV — CSV structure and header rows", () => {
  /**
   * The CSV has a fixed preamble (period, GSTIN, business name) followed by
   * B2B and B2CS section headers and a summary footer. These are checked
   * structurally — the order and column names must be stable for importers.
   */

  it("first line is the report title 'GSTR-1 Report'", () => {
    const csv = gstr1ToCSV(makeReport());
    const lines = csv.split("\n");
    expect(lines[0]).toBe("GSTR-1 Report");
  });

  it("second line contains the period", () => {
    const csv = gstr1ToCSV(makeReport({ period: "Apr 2025" }));
    const lines = csv.split("\n");
    expect(lines[1]).toBe("Period,Apr 2025");
  });

  it("period format is 'Mon YYYY' (three-letter month abbreviation)", () => {
    const csv = gstr1ToCSV(makeReport({ period: "Apr 2025" }));
    expect(csv).toContain("Period,Apr 2025");
  });

  it("third line contains the business GSTIN", () => {
    const csv = gstr1ToCSV(makeReport({ businessGstin: "27AAAPL1234C1ZV" }));
    const lines = csv.split("\n");
    expect(lines[2]).toBe("GSTIN,27AAAPL1234C1ZV");
  });

  it("fourth line contains the business name", () => {
    const csv = gstr1ToCSV(makeReport({ businessName: "Laxmi Enterprises" }));
    const lines = csv.split("\n");
    expect(lines[3]).toBe("Business,Laxmi Enterprises");
  });

  it("contains the B2B section header", () => {
    const csv = gstr1ToCSV(makeReport());
    expect(csv).toContain("B2B - Outward Supplies to Registered Persons");
  });

  it("contains the B2B column header row with expected columns", () => {
    const csv = gstr1ToCSV(makeReport());
    expect(csv).toContain(
      "Party GSTIN,Party Name,Invoice No,Invoice Date,Type,Taxable Value,CGST,SGST,IGST,Total Value"
    );
  });

  it("contains the B2CS section header", () => {
    const csv = gstr1ToCSV(makeReport());
    expect(csv).toContain("B2CS - Outward Supplies to Unregistered Persons (Small)");
  });

  it("contains the B2CS column header row", () => {
    const csv = gstr1ToCSV(makeReport());
    expect(csv).toContain("Tax Rate %,Taxable Value,CGST,SGST,IGST");
  });

  it("contains the Summary section", () => {
    const csv = gstr1ToCSV(makeReport());
    expect(csv).toContain("Summary");
  });

  it("summary section includes Total Invoices line", () => {
    const csv = gstr1ToCSV(makeReport({ invoiceCount: 7 }));
    expect(csv).toContain("Total Invoices,7");
  });

  it("summary section includes Total Taxable Value with 2dp", () => {
    const csv = gstr1ToCSV(makeReport({ totalTaxableValue: 85000.5 }));
    expect(csv).toContain("Total Taxable Value,85000.50");
  });

  it("summary section includes total tax breakdown and grand total", () => {
    const csv = gstr1ToCSV(
      makeReport({
        totalCgst: 7650,
        totalSgst: 7650,
        totalIgst: 0,
        totalTax: 15300,
        totalInvoiceValue: 100000,
      })
    );
    expect(csv).toContain("Total CGST,7650.00");
    expect(csv).toContain("Total SGST,7650.00");
    expect(csv).toContain("Total IGST,0.00");
    expect(csv).toContain("Total Tax,15300.00");
    expect(csv).toContain("Total Invoice Value,100000.00");
  });
});

describe("gstr1ToCSV — B2B row content", () => {
  /**
   * Each B2B entry becomes a comma-separated row in the B2B section.
   * The party name is wrapped in double quotes to handle embedded commas.
   */

  it("includes party GSTIN in B2B row", () => {
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "29ABCDE1234F1Z5",
            partyName: "Ramesh Traders",
            invoiceNumber: "INV-00001",
            invoiceDate: new Date("2025-04-15").toISOString(),
            invoiceType: "Regular",
            taxableValue: 50000,
            cgst: 4500,
            sgst: 4500,
            igst: 0,
            totalInvoiceValue: 59000,
          },
        ],
      })
    );
    expect(csv).toContain("29ABCDE1234F1Z5");
  });

  it("includes party name wrapped in double quotes in B2B row", () => {
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "27XYZAB5678G1Z9",
            partyName: "Ramesh Traders",
            invoiceNumber: "INV-00002",
            invoiceDate: new Date("2025-04-20").toISOString(),
            invoiceType: "Regular",
            taxableValue: 20000,
            cgst: 1800,
            sgst: 1800,
            igst: 0,
            totalInvoiceValue: 23600,
          },
        ],
      })
    );
    expect(csv).toContain('"Ramesh Traders"');
  });

  it("handles commas in party name without breaking CSV structure", () => {
    /**
     * Party names like "Singh & Sons, Traders" contain a comma.
     * The CSV writer wraps the name in double quotes so the comma is not
     * treated as a field separator by spreadsheet importers.
     */
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "06PQRST9012H1Z1",
            partyName: "Singh & Sons, Traders",
            invoiceNumber: "INV-00003",
            invoiceDate: new Date("2025-04-25").toISOString(),
            invoiceType: "Regular",
            taxableValue: 75000,
            cgst: 0,
            sgst: 0,
            igst: 13500,
            totalInvoiceValue: 88500,
          },
        ],
      })
    );
    // The party name with comma is quoted — column count stays intact
    expect(csv).toContain('"Singh & Sons, Traders"');
  });

  it("includes invoice number in B2B row", () => {
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "24DEFGH6789I1Z2",
            partyName: "Gujarat Steel Works",
            invoiceNumber: "INV-00042",
            invoiceDate: new Date("2025-04-10").toISOString(),
            invoiceType: "Regular",
            taxableValue: 100000,
            cgst: 0,
            sgst: 0,
            igst: 18000,
            totalInvoiceValue: 118000,
          },
        ],
      })
    );
    expect(csv).toContain("INV-00042");
  });

  it("numeric values in B2B rows are formatted to 2 decimal places", () => {
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "33MNOPQ4567J1Z8",
            partyName: "Chennai Suppliers",
            invoiceNumber: "INV-00005",
            invoiceDate: new Date("2025-04-05").toISOString(),
            invoiceType: "Regular",
            taxableValue: 10000,
            cgst: 900,
            sgst: 900,
            igst: 0,
            totalInvoiceValue: 11800,
          },
        ],
      })
    );
    expect(csv).toContain("10000.00");
    expect(csv).toContain("900.00");
    expect(csv).toContain("11800.00");
  });

  it("B2B row invoice type is 'Regular'", () => {
    const csv = gstr1ToCSV(
      makeReport({
        b2b: [
          {
            partyGstin: "09ABCDE1111F1Z5",
            partyName: "UP Distributors",
            invoiceNumber: "INV-00010",
            invoiceDate: new Date("2025-04-12").toISOString(),
            invoiceType: "Regular",
            taxableValue: 30000,
            cgst: 2700,
            sgst: 2700,
            igst: 0,
            totalInvoiceValue: 35400,
          },
        ],
      })
    );
    expect(csv).toContain("Regular");
  });
});

describe("gstr1ToCSV — period format validation", () => {
  /**
   * Period strings are generated by generateGSTR1() using the monthNames array.
   * The CSV should reproduce them verbatim — no reformatting.
   */

  it("Apr 2025 period is reproduced verbatim in the CSV", () => {
    const csv = gstr1ToCSV(makeReport({ period: "Apr 2025" }));
    expect(csv).toContain("Period,Apr 2025");
  });

  it("Jan 2026 period is reproduced verbatim", () => {
    const csv = gstr1ToCSV(makeReport({ period: "Jan 2026" }));
    expect(csv).toContain("Period,Jan 2026");
  });

  it("Mar 2025 (financial year end month) is reproduced verbatim", () => {
    const csv = gstr1ToCSV(makeReport({ period: "Mar 2025" }));
    expect(csv).toContain("Period,Mar 2025");
  });
});

// =============================================================================
// Section 6: gstr1ToPortalJson — GST portal JSON export
//
// The portal JSON must match the schema expected by the GST offline tool exactly.
// Wrong field names or formats will cause the portal upload to reject the file.
// =============================================================================

/**
 * Builds a minimal GSTR1Report for portal JSON testing.
 * Mirrors makeReport() but with concrete data matching the portal schema examples.
 */
function makePortalReport(overrides: Partial<GSTR1Report> = {}): GSTR1Report {
  return {
    period: "Aug 2025",
    businessGstin: "27AABCA0000R1ZM",
    businessName: "Test Business",
    b2b: [],
    b2cLarge: [],
    b2cSmall: [],
    hsn: [],
    creditNotes: [],
    debitNotes: [],
    totalTaxableValue: 0,
    totalCgst: 0,
    totalSgst: 0,
    totalIgst: 0,
    totalTax: 0,
    totalInvoiceValue: 0,
    invoiceCount: 0,
    ...overrides,
  };
}

describe("gstr1ToPortalJson — top-level structure", () => {
  /**
   * The portal JSON must have gstin and fp at the root level.
   * fp is the filing period in MMYYYY format (e.g. "082025" for August 2025).
   */

  it("includes gstin at root level", () => {
    const json = gstr1ToPortalJson(makePortalReport(), "27AABCA0000R1ZM", "2025-26", "082025");
    expect(json.gstin).toBe("27AABCA0000R1ZM");
  });

  it("includes fp (filing period) at root level", () => {
    const json = gstr1ToPortalJson(makePortalReport(), "27AABCA0000R1ZM", "2025-26", "082025");
    expect(json.fp).toBe("082025");
  });

  it("fp is passed through verbatim — not computed internally", () => {
    const json = gstr1ToPortalJson(makePortalReport(), "27AABCA0000R1ZM", "2025-26", "032026");
    expect(json.fp).toBe("032026");
  });

  it("empty report produces empty arrays for all sections", () => {
    const json = gstr1ToPortalJson(makePortalReport(), "27AABCA0000R1ZM", "2025-26", "082025");
    expect(json.b2b).toEqual([]);
    expect(json.b2cl).toEqual([]);
    expect(json.b2cs).toEqual([]);
    expect(json.cdnr).toEqual([]);
    expect((json.hsn as { data: unknown[] }).data).toEqual([]);
  });
});

describe("gstr1ToPortalJson — B2B section", () => {
  /**
   * B2B invoices must be grouped by recipient GSTIN (ctin).
   * Dates must be converted from ISO "YYYY-MM-DD" to portal "DD-MM-YYYY" format.
   * Monetary values must be numbers (not strings).
   */

  it("produces a b2b entry with correct ctin", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-15").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    expect(json.b2b).toHaveLength(1);
    expect((json.b2b as Array<{ ctin: string }>)[0].ctin).toBe("29XYZAB5678G1Z9");
  });

  it("formats invoice date as DD-MM-YYYY", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-15").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2BEntry = { ctin: string; inv: Array<{ idt: string }> };
    expect((json.b2b as B2BEntry[])[0].inv[0].idt).toBe("15-08-2025");
  });

  it("invoice value (val) is a number, not a string", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-15").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2BEntry = { ctin: string; inv: Array<{ val: unknown }> };
    expect(typeof (json.b2b as B2BEntry[])[0].inv[0].val).toBe("number");
    expect((json.b2b as B2BEntry[])[0].inv[0].val).toBe(11800);
  });

  it("groups two invoices to the same party under one ctin entry", () => {
    /**
     * The portal schema nests all invoices under a single ctin object.
     * Two B2B invoices to the same GSTIN must produce one ctin entry with
     * two items in the inv array, not two separate ctin entries.
     */
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [
          {
            partyGstin: "29XYZAB5678G1Z9",
            partyName: "Same Party",
            invoiceNumber: "INV-00001",
            invoiceDate: new Date("2025-08-10").toISOString(),
            invoiceType: "Regular",
            taxableValue: 10000,
            cgst: 0,
            sgst: 0,
            igst: 1800,
            totalInvoiceValue: 11800,
          },
          {
            partyGstin: "29XYZAB5678G1Z9",
            partyName: "Same Party",
            invoiceNumber: "INV-00002",
            invoiceDate: new Date("2025-08-20").toISOString(),
            invoiceType: "Regular",
            taxableValue: 20000,
            cgst: 0,
            sgst: 0,
            igst: 3600,
            totalInvoiceValue: 23600,
          },
        ],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2BEntry = { ctin: string; inv: unknown[] };
    const b2b = json.b2b as B2BEntry[];
    expect(b2b).toHaveLength(1);
    expect(b2b[0].ctin).toBe("29XYZAB5678G1Z9");
    expect(b2b[0].inv).toHaveLength(2);
  });

  it("two invoices to different parties produce two separate ctin entries", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [
          {
            partyGstin: "29XYZAB5678G1Z9",
            partyName: "Party A",
            invoiceNumber: "INV-00001",
            invoiceDate: new Date("2025-08-10").toISOString(),
            invoiceType: "Regular",
            taxableValue: 10000,
            cgst: 0,
            sgst: 0,
            igst: 1800,
            totalInvoiceValue: 11800,
          },
          {
            partyGstin: "27ABCDE1234F1Z5",
            partyName: "Party B",
            invoiceNumber: "INV-00002",
            invoiceDate: new Date("2025-08-20").toISOString(),
            invoiceType: "Regular",
            taxableValue: 5000,
            cgst: 450,
            sgst: 450,
            igst: 0,
            totalInvoiceValue: 5900,
          },
        ],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    expect((json.b2b as unknown[]).length).toBe(2);
  });

  it("invoice items block contains correct txval and tax amounts", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-15").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type ItmDet = { txval: number; iamt: number; camt: number; samt: number; csamt: number };
    type InvEntry = { itms: Array<{ num: number; itm_det: ItmDet }> };
    type B2BEntry = { ctin: string; inv: InvEntry[] };
    const itm = (json.b2b as B2BEntry[])[0].inv[0].itms[0].itm_det;
    expect(itm.txval).toBe(10000);
    expect(itm.iamt).toBe(1800);
    expect(itm.camt).toBe(0);
    expect(itm.samt).toBe(0);
    expect(itm.csamt).toBe(0);
  });

  it("sets rchrg to 'N' and inv_typ to 'R' for regular invoices", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-15").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type InvEntry = { rchrg: string; inv_typ: string };
    type B2BEntry = { inv: InvEntry[] };
    const inv = (json.b2b as B2BEntry[])[0].inv[0];
    expect(inv.rchrg).toBe("N");
    expect(inv.inv_typ).toBe("R");
  });
});

describe("gstr1ToPortalJson — B2CL section", () => {
  /**
   * B2C Large invoices are grouped by state code (pos field).
   * The state name from the report must be mapped to a 2-digit state code.
   */

  it("groups b2cLarge entries by state into b2cl array", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cLarge: [{
          state: "Karnataka",
          taxableValue: 254237.29,
          cgst: 0,
          sgst: 0,
          igst: 45762.71,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    expect((json.b2cl as unknown[]).length).toBe(1);
  });

  it("b2cl entry has pos field (state code)", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cLarge: [{
          state: "Karnataka",
          taxableValue: 254237.29,
          cgst: 0,
          sgst: 0,
          igst: 45762.71,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2CLEntry = { pos: string; inv: unknown[] };
    const entry = (json.b2cl as B2CLEntry[])[0];
    expect(entry.pos).toBeDefined();
    expect(typeof entry.pos).toBe("string");
  });
});

describe("gstr1ToPortalJson — B2CS section", () => {
  /**
   * B2C Small entries use sply_ty (INTRA/INTER), pos, rt (tax rate),
   * and aggregated tax amounts.
   */

  it("produces b2cs entries from b2cSmall data", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cSmall: [{
          taxRate: 18,
          taxableValue: 50000,
          cgst: 4500,
          sgst: 4500,
          igst: 0,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    expect((json.b2cs as unknown[]).length).toBe(1);
  });

  it("intra-state b2cs entry has sply_ty INTRA when cgst > 0", () => {
    /**
     * CGST and SGST are present only for intra-state supplies.
     * When cgst > 0, the supply type must be "INTRA".
     */
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cSmall: [{
          taxRate: 18,
          taxableValue: 50000,
          cgst: 4500,
          sgst: 4500,
          igst: 0,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2CSEntry = { sply_ty: string };
    expect((json.b2cs as B2CSEntry[])[0].sply_ty).toBe("INTRA");
  });

  it("inter-state b2cs entry has sply_ty INTER when igst > 0", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cSmall: [{
          taxRate: 18,
          taxableValue: 25000,
          cgst: 0,
          sgst: 0,
          igst: 4500,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2CSEntry = { sply_ty: string };
    expect((json.b2cs as B2CSEntry[])[0].sply_ty).toBe("INTER");
  });

  it("b2cs entry includes txval and rt fields", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2cSmall: [{
          taxRate: 12,
          taxableValue: 30000,
          cgst: 1800,
          sgst: 1800,
          igst: 0,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type B2CSEntry = { txval: number; rt: number };
    const entry = (json.b2cs as B2CSEntry[])[0];
    expect(entry.txval).toBe(30000);
    expect(entry.rt).toBe(12);
  });
});

describe("gstr1ToPortalJson — CDNR section (credit/debit notes)", () => {
  /**
   * Credit notes go to cdnr with ntty: "C", debit notes with ntty: "D".
   * Both are grouped by recipient GSTIN (ctin).
   */

  it("maps credit notes to cdnr with ntty C", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        creditNotes: [{
          invoiceNumber: "CN-00001",
          invoiceDate: new Date("2025-08-25").toISOString(),
          partyName: "Test Party",
          partyGstin: "29XYZAB5678G1Z9",
          totalAmount: "5000.00",
          taxableAmount: "4237.29",
          taxAmount: "762.71",
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type NtEntry = { ntty: string; nt_num: string };
    type CDNREntry = { ctin: string; nt: NtEntry[] };
    const cdnr = json.cdnr as CDNREntry[];
    expect(cdnr).toHaveLength(1);
    expect(cdnr[0].ctin).toBe("29XYZAB5678G1Z9");
    expect(cdnr[0].nt[0].ntty).toBe("C");
    expect(cdnr[0].nt[0].nt_num).toBe("CN-00001");
  });

  it("maps debit notes to cdnr with ntty D", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        debitNotes: [{
          invoiceNumber: "DN-00001",
          invoiceDate: new Date("2025-08-20").toISOString(),
          partyName: "Test Party",
          partyGstin: "29XYZAB5678G1Z9",
          totalAmount: "3000.00",
          taxableAmount: "2542.37",
          taxAmount: "457.63",
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type NtEntry = { ntty: string };
    type CDNREntry = { nt: NtEntry[] };
    const cdnr = json.cdnr as CDNREntry[];
    expect(cdnr).toHaveLength(1);
    expect(cdnr[0].nt[0].ntty).toBe("D");
  });

  it("formats credit note date as DD-MM-YYYY", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        creditNotes: [{
          invoiceNumber: "CN-00001",
          invoiceDate: new Date("2025-08-25").toISOString(),
          partyName: "Test Party",
          partyGstin: "29XYZAB5678G1Z9",
          totalAmount: "5000.00",
          taxableAmount: "4237.29",
          taxAmount: "762.71",
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type NtEntry = { nt_dt: string };
    type CDNREntry = { nt: NtEntry[] };
    expect((json.cdnr as CDNREntry[])[0].nt[0].nt_dt).toBe("25-08-2025");
  });

  it("groups credit and debit notes for the same party under one ctin", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        creditNotes: [{
          invoiceNumber: "CN-00001",
          invoiceDate: new Date("2025-08-25").toISOString(),
          partyName: "Test Party",
          partyGstin: "29XYZAB5678G1Z9",
          totalAmount: "5000.00",
          taxableAmount: "4237.29",
          taxAmount: "762.71",
        }],
        debitNotes: [{
          invoiceNumber: "DN-00001",
          invoiceDate: new Date("2025-08-20").toISOString(),
          partyName: "Test Party",
          partyGstin: "29XYZAB5678G1Z9",
          totalAmount: "3000.00",
          taxableAmount: "2542.37",
          taxAmount: "457.63",
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type CDNREntry = { ctin: string; nt: unknown[] };
    const cdnr = json.cdnr as CDNREntry[];
    // Both notes are for the same party — should be grouped under one ctin
    expect(cdnr).toHaveLength(1);
    expect(cdnr[0].nt).toHaveLength(2);
  });
});

describe("gstr1ToPortalJson — HSN section", () => {
  /**
   * HSN data must be under hsn.data as an array.
   * Each entry has a sequential num, hsn_sc, desc, uqc, qty, and tax amounts.
   */

  it("wraps HSN entries under hsn.data array", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        hsn: [{
          hsn: "8471",
          description: "Computers",
          quantity: 10,
          taxableValue: 100000,
          cgst: 9000,
          sgst: 9000,
          igst: 0,
          totalValue: 118000,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type HSNSection = { data: unknown[] };
    expect((json.hsn as HSNSection).data).toHaveLength(1);
  });

  it("HSN entry has correct field names: hsn_sc, desc, qty, txval", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        hsn: [{
          hsn: "8471",
          description: "Computers",
          quantity: 10,
          taxableValue: 100000,
          cgst: 9000,
          sgst: 9000,
          igst: 0,
          totalValue: 118000,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type HSNEntry = { num: number; hsn_sc: string; desc: string; qty: number; txval: number; uqc: string };
    type HSNSection = { data: HSNEntry[] };
    const entry = (json.hsn as HSNSection).data[0];
    expect(entry.hsn_sc).toBe("8471");
    expect(entry.desc).toBe("Computers");
    expect(entry.qty).toBe(10);
    expect(entry.txval).toBe(100000);
    expect(entry.num).toBe(1);
    expect(entry.uqc).toBe("NOS"); // default UQC when unit not known
  });

  it("assigns sequential num starting from 1", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        hsn: [
          { hsn: "8471", description: "Computers", quantity: 5, taxableValue: 50000, cgst: 4500, sgst: 4500, igst: 0, totalValue: 59000 },
          { hsn: "7306", description: "Steel Pipes", quantity: 20, taxableValue: 20000, cgst: 1800, sgst: 1800, igst: 0, totalValue: 23600 },
        ],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type HSNEntry = { num: number };
    type HSNSection = { data: HSNEntry[] };
    const data = (json.hsn as HSNSection).data;
    expect(data[0].num).toBe(1);
    expect(data[1].num).toBe(2);
  });

  it("HSN tax amounts include camt, samt, iamt, csamt", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        hsn: [{
          hsn: "8471",
          description: "Computers",
          quantity: 10,
          taxableValue: 100000,
          cgst: 9000,
          sgst: 9000,
          igst: 0,
          totalValue: 118000,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type HSNEntry = { camt: number; samt: number; iamt: number; csamt: number };
    type HSNSection = { data: HSNEntry[] };
    const entry = (json.hsn as HSNSection).data[0];
    expect(entry.camt).toBe(9000);
    expect(entry.samt).toBe(9000);
    expect(entry.iamt).toBe(0);
    expect(entry.csamt).toBe(0);
  });
});

describe("gstr1ToPortalJson — date formatting", () => {
  /**
   * Dates in the internal report are ISO strings (YYYY-MM-DDThh:mm:ss.sssZ).
   * The portal requires DD-MM-YYYY format.
   */

  it("converts first day of month correctly: 2025-08-01 → 01-08-2025", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-01").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type InvEntry = { idt: string };
    type B2BEntry = { inv: InvEntry[] };
    expect((json.b2b as B2BEntry[])[0].inv[0].idt).toBe("01-08-2025");
  });

  it("converts last day of month correctly: 2025-08-31 → 31-08-2025", () => {
    const json = gstr1ToPortalJson(
      makePortalReport({
        b2b: [{
          partyGstin: "29XYZAB5678G1Z9",
          partyName: "Test Party",
          invoiceNumber: "INV-00001",
          invoiceDate: new Date("2025-08-31").toISOString(),
          invoiceType: "Regular",
          taxableValue: 10000,
          cgst: 0,
          sgst: 0,
          igst: 1800,
          totalInvoiceValue: 11800,
        }],
      }),
      "27AABCA0000R1ZM", "2025-26", "082025"
    );
    type InvEntry = { idt: string };
    type B2BEntry = { inv: InvEntry[] };
    expect((json.b2b as B2BEntry[])[0].inv[0].idt).toBe("31-08-2025");
  });
});

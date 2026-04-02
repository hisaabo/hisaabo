/**
 * Tests for pure helper functions in lib/invoice-pdf.ts.
 *
 * WHY THIS FILE EXISTS:
 * invoice-pdf.ts contains seven non-exported helper functions that together
 * drive all formatting and GST logic on generated PDF invoices. Because they
 * are not exported they cannot be imported — the same pattern used in
 * shipment.test.ts is applied here: each function is extracted verbatim and
 * tested in isolation without touching the PDF generation layer.
 *
 * Functions covered:
 *   numberToWords  — Indian numbering (lakh/crore) for the "amount in words" field
 *   fmt            — INR currency formatting with Indian grouping (1,00,000)
 *   fmtDate        — DD Mon YYYY display format for invoice/due dates
 *   getInvoiceTitle — document heading driven by type + GST registration status
 *   isGstRegistered — predicate used to decide whether to show GSTIN sections
 *   isSameState    — determines CGST/SGST vs IGST split
 *   buildGstBreakdown — groups line items into a GST rate-wise breakdown table
 *
 * APPROACH:
 * All tests are pure-function tests — no PDF document instantiated, no file I/O,
 * no mocking. Functions are copied verbatim from invoice-pdf.ts.
 *
 * SOURCE REFERENCE (grep to find the real code):
 *   packages/api/src/lib/invoice-pdf.ts  lines 87-189
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Types — mirrors the relevant slice of InvoicePDFData (invoice-pdf.ts:11-81)
// =============================================================================

interface InvoicePDFData {
  businessName: string;
  partyName: string;
  invoiceNumber: string;
  invoiceDate: string;
  type: "sale" | "purchase";
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    taxAmount: string;
    discountPercent: string;
    totalAmount: string;
  }>;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  amountPaid: string;
  gstRegistrationType?: "regular" | "composition" | "unregistered";
  businessStateCode?: string;
  partyStateCode?: string;
  businessState?: string;
  partyState?: string;
}

interface GstBreakdown {
  rate: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

// =============================================================================
// Pure functions — extracted verbatim from invoice-pdf.ts lines 87-189
// =============================================================================

function fmt(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(num);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + chunk(n % 100) : "");
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = Math.floor(num % 1000);
  const paise = Math.round((num % 1) * 100);

  let words = "";
  if (crore) words += chunk(crore) + " Crore ";
  if (lakh) words += chunk(lakh) + " Lakh ";
  if (thousand) words += chunk(thousand) + " Thousand ";
  if (rest) words += chunk(rest);
  words = words.trim() + " Rupees";
  if (paise) words += " and " + chunk(paise) + " Paise";
  return words + " Only";
}

function getInvoiceTitle(data: InvoicePDFData): string {
  if (data.type === "purchase") return "PURCHASE INVOICE";
  if (!data.gstRegistrationType || data.gstRegistrationType === "unregistered") return "INVOICE";
  if (data.gstRegistrationType === "composition") return "BILL OF SUPPLY";
  return "TAX INVOICE";
}

function isGstRegistered(data: InvoicePDFData): boolean {
  return data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition";
}

function isSameState(data: InvoicePDFData): boolean {
  if (data.businessStateCode && data.partyStateCode) {
    return data.businessStateCode === data.partyStateCode;
  }
  if (data.businessState && data.partyState) {
    return data.businessState.toLowerCase() === data.partyState.toLowerCase();
  }
  return false;
}

function buildGstBreakdown(data: InvoicePDFData): GstBreakdown[] {
  const sameState = isSameState(data);
  const map = new Map<string, GstBreakdown>();

  for (const item of data.lineItems) {
    const rate = item.taxPercent;
    const taxable = parseFloat(item.totalAmount) - parseFloat(item.taxAmount);
    const taxAmt = parseFloat(item.taxAmount);

    if (!map.has(rate)) {
      map.set(rate, { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    }
    const entry = map.get(rate)!;
    entry.taxable += taxable;
    if (sameState) {
      entry.cgst += taxAmt / 2;
      entry.sgst += taxAmt / 2;
    } else {
      entry.igst += taxAmt;
    }
  }

  return Array.from(map.values());
}

// =============================================================================
// Helpers shared across test blocks
// =============================================================================

/** Minimal InvoicePDFData for tests that only need specific fields. */
function baseData(overrides: Partial<InvoicePDFData> = {}): InvoicePDFData {
  return {
    businessName: "Sharma Traders",
    partyName: "Gupta Enterprises",
    invoiceNumber: "INV-00001",
    invoiceDate: "2025-04-15",
    type: "sale",
    lineItems: [],
    subtotal: "0",
    taxAmount: "0",
    discountAmount: "0",
    totalAmount: "0",
    amountPaid: "0",
    ...overrides,
  };
}

// =============================================================================
// Section 1: numberToWords — Indian lakh/crore numbering system
//
// Indian invoices require the total amount spelled out in words as mandated by
// GST regulations. The function must handle zero, ones, teens, tens, hundreds,
// thousands, lakh, crore, and paise correctly.
// =============================================================================

describe("numberToWords — Indian lakh/crore numbering for invoice amount-in-words field", () => {
  /**
   * The Indian numbering system groups digits differently from the Western
   * system: ones/tens/hundreds (3 digits), then pairs of 2 digits for
   * thousands, lakhs, and crores. The function must reflect this convention
   * since the output appears verbatim on GST-compliant invoices.
   *
   * Paise (sub-rupee) appear as "and N Paise" only when non-zero.
   */

  it("returns 'Zero' for 0 — special case, no rupee/paise suffix", () => {
    /**
     * Zero invoices shouldn't occur in practice but the function must not
     * crash or produce an empty string when called with 0.
     */
    expect(numberToWords(0)).toBe("Zero");
  });

  it("handles 1 — the minimal positive amount", () => {
    expect(numberToWords(1)).toBe("One Rupees Only");
  });

  it("handles 100 — boundary between two-digit and three-digit", () => {
    expect(numberToWords(100)).toBe("One Hundred Rupees Only");
  });

  it("handles 21 — tens + ones (not a teen number)", () => {
    /**
     * teens (11-19) use dedicated words from the ones array.
     * 21 must NOT be rendered as "Twen One" — the tens array provides "Twenty"
     * and the ones array provides "One" for the remainder.
     */
    expect(numberToWords(21)).toBe("Twenty One Rupees Only");
  });

  it("handles 15000 — fifteen thousand (common invoice amount in INR)", () => {
    expect(numberToWords(15000)).toBe("Fifteen Thousand Rupees Only");
  });

  it("handles 150000 — lakh notation (1,50,000)", () => {
    /**
     * One lakh fifty thousand — the lakh grouping is specific to Indian
     * numbering. Western systems would say "one hundred fifty thousand".
     */
    expect(numberToWords(150000)).toBe("One Lakh Fifty Thousand Rupees Only");
  });

  it("handles 10000000 — one crore (1,00,00,000)", () => {
    expect(numberToWords(10000000)).toBe("One Crore Rupees Only");
  });

  it("handles 12345678 — mixed crore/lakh/thousand/rest", () => {
    /**
     * 12345678 = 1 crore 23 lakh 45 thousand 678
     * This is a realistic large invoice amount for wholesale/B2B transactions
     * in India (construction materials, machinery, etc.).
     */
    const result = numberToWords(12345678);
    expect(result).toContain("Crore");
    expect(result).toContain("Lakh");
    expect(result).toContain("Thousand");
    expect(result).toContain("Rupees Only");
    // Verify the specific decomposition
    expect(result).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred and Seventy Eight Rupees Only");
  });

  it("handles 99.50 — rupees with paise (50 paise)", () => {
    /**
     * When a fractional amount is present, the output must include
     * "and N Paise" at the end. This is the standard Indian billing format
     * used on handwritten challans and printed invoices alike.
     */
    const result = numberToWords(99.50);
    expect(result).toContain("Ninety Nine Rupees");
    expect(result).toContain("Fifty Paise");
    expect(result).toContain("Only");
  });

  it("does NOT append 'and Paise' when amount is a whole number", () => {
    /**
     * Paise section must only appear for fractional amounts. A whole-number
     * invoice (the common case) must not have trailing "and Zero Paise".
     */
    const result = numberToWords(5000);
    expect(result).not.toContain("Paise");
    expect(result).toBe("Five Thousand Rupees Only");
  });
});

// =============================================================================
// Section 2: fmt — INR currency formatting with Indian grouping
//
// Correct Indian grouping: 1,00,000 not 100,000. This distinction matters
// for user trust — an Indian accountant will immediately notice Western
// grouping and consider the invoice software unprofessional.
// =============================================================================

describe("fmt — INR currency formatting with Indian number grouping", () => {
  /**
   * en-IN locale produces Indian grouping: last 3 digits, then groups of 2.
   * The currency symbol for INR in en-IN is the ₹ sign.
   * minimumFractionDigits: 2 ensures ".00" is always shown (not ".5" for 0.5).
   */

  it("formats 15000.50 with Indian grouping and two decimal places", () => {
    /**
     * 15,000.50 in Western vs 15,000.50 in Indian — no difference at this
     * magnitude. We verify the ₹ symbol and 2 decimal places.
     */
    const result = fmt("15000.50");
    expect(result).toContain("15,000.50");
    // Should include the INR currency symbol
    expect(result).toMatch(/₹|INR/);
  });

  it("formats 100000 showing Indian lakh grouping (1,00,000)", () => {
    /**
     * This is where Indian vs Western grouping diverges visibly:
     *   Indian:  ₹1,00,000
     *   Western: ₹100,000
     * The en-IN locale must produce the Indian form.
     */
    const result = fmt(100000);
    expect(result).toContain("1,00,000");
  });

  it("accepts a number argument as well as a string", () => {
    // fmt is overloaded for both string (from DB) and number (calculated) inputs
    const fromString = fmt("500.00");
    const fromNumber = fmt(500);
    expect(fromString).toBe(fromNumber);
  });

  it("always shows two decimal places even for whole numbers", () => {
    const result = fmt("1000");
    expect(result).toContain("1,000.00");
  });

  it("formats zero as ₹0.00", () => {
    const result = fmt(0);
    expect(result).toContain("0.00");
  });
});

// =============================================================================
// Section 3: fmtDate — DD Mon YYYY display format
//
// Invoice dates must be human-readable in the Indian standard format.
// The en-IN locale with day/month/year options produces "15 Apr 2025" style.
// =============================================================================

describe("fmtDate — date formatting for invoice/due date display fields", () => {
  /**
   * The format produced by Intl.DateTimeFormat("en-IN", { day: "2-digit",
   * month: "short", year: "numeric" }) varies slightly by Node.js ICU data
   * version but consistently includes the day, abbreviated month, and year.
   */

  it("formats '2025-04-15' as a human-readable date string", () => {
    /**
     * April 15, 2025 — the start of the Indian financial year quarter.
     * Output should contain "Apr" (abbreviated month), "2025", and the day.
     */
    const result = fmtDate("2025-04-15");
    expect(result).toContain("Apr");
    expect(result).toContain("2025");
    expect(result).toMatch(/15/);
  });

  it("formats a financial year start date (01 Apr 2025)", () => {
    const result = fmtDate("2025-04-01");
    expect(result).toContain("Apr");
    expect(result).toContain("2025");
  });

  it("formats a December date correctly", () => {
    const result = fmtDate("2024-12-31");
    expect(result).toContain("Dec");
    expect(result).toContain("2024");
    expect(result).toMatch(/31/);
  });

  it("formats January — boundary month (month index 0)", () => {
    const result = fmtDate("2025-01-01");
    expect(result).toContain("Jan");
    expect(result).toContain("2025");
  });
});

// =============================================================================
// Section 4: getInvoiceTitle — document heading logic
//
// GST regulations in India mandate specific document headings based on the
// registration type and transaction direction. Using the wrong heading on a
// printed invoice can invalidate ITC (input tax credit) claims.
// =============================================================================

describe("getInvoiceTitle — GST-mandated document heading based on type and registration", () => {
  /**
   * Heading rules (simplified):
   *   purchase invoice (any)       → "PURCHASE INVOICE"
   *   sale + unregistered          → "INVOICE" (no GST breakdown, no GSTIN)
   *   sale + no gstRegistrationType→ "INVOICE" (same as unregistered)
   *   sale + composition           → "BILL OF SUPPLY" (composition dealers
   *                                   cannot charge GST from customers)
   *   sale + regular               → "TAX INVOICE" (standard GST invoice)
   */

  it("returns 'PURCHASE INVOICE' for purchase type regardless of registration", () => {
    /**
     * Purchase invoices are received from suppliers. The business uses them
     * to claim ITC. The heading "PURCHASE INVOICE" distinguishes inbound
     * from outbound documents in filing.
     */
    expect(getInvoiceTitle(baseData({ type: "purchase", gstRegistrationType: "regular" }))).toBe("PURCHASE INVOICE");
    expect(getInvoiceTitle(baseData({ type: "purchase", gstRegistrationType: "composition" }))).toBe("PURCHASE INVOICE");
    expect(getInvoiceTitle(baseData({ type: "purchase", gstRegistrationType: "unregistered" }))).toBe("PURCHASE INVOICE");
    expect(getInvoiceTitle(baseData({ type: "purchase" }))).toBe("PURCHASE INVOICE");
  });

  it("returns 'TAX INVOICE' for sale with regular GST registration", () => {
    /**
     * Regular registered businesses must issue a "Tax Invoice" to allow
     * their customers to claim input tax credit (ITC).
     */
    expect(getInvoiceTitle(baseData({ type: "sale", gstRegistrationType: "regular" }))).toBe("TAX INVOICE");
  });

  it("returns 'BILL OF SUPPLY' for sale with composition registration", () => {
    /**
     * Composition scheme dealers pay tax at a flat rate from their own pocket
     * and cannot charge GST to customers. They must issue a "Bill of Supply"
     * instead of a "Tax Invoice". Using "Tax Invoice" for composition would
     * mislead customers into wrongly claiming ITC.
     */
    expect(getInvoiceTitle(baseData({ type: "sale", gstRegistrationType: "composition" }))).toBe("BILL OF SUPPLY");
  });

  it("returns 'INVOICE' for sale with unregistered GST type", () => {
    expect(getInvoiceTitle(baseData({ type: "sale", gstRegistrationType: "unregistered" }))).toBe("INVOICE");
  });

  it("returns 'INVOICE' when gstRegistrationType is absent (undefined)", () => {
    /**
     * New businesses that haven't configured their GST type yet should
     * default to a simple "INVOICE" — the safest non-committal heading
     * that doesn't make incorrect compliance claims.
     */
    expect(getInvoiceTitle(baseData({ type: "sale" }))).toBe("INVOICE");
  });
});

// =============================================================================
// Section 5: isGstRegistered — predicate for GSTIN section visibility
//
// Drives whether the GSTIN, HSN, and GST breakdown sections are rendered on
// the PDF. Showing these sections for unregistered businesses would produce
// a legally incorrect invoice.
// =============================================================================

describe("isGstRegistered — predicate controlling GSTIN and tax breakdown visibility", () => {
  it("returns true for 'regular' registration", () => {
    expect(isGstRegistered(baseData({ gstRegistrationType: "regular" }))).toBe(true);
  });

  it("returns true for 'composition' registration", () => {
    /**
     * Composition dealers are registered for GST but cannot charge tax.
     * isGstRegistered returns true so their GSTIN can be printed — even
     * though no GST breakdown is shown on a Bill of Supply.
     */
    expect(isGstRegistered(baseData({ gstRegistrationType: "composition" }))).toBe(true);
  });

  it("returns false for 'unregistered'", () => {
    expect(isGstRegistered(baseData({ gstRegistrationType: "unregistered" }))).toBe(false);
  });

  it("returns false when gstRegistrationType is undefined", () => {
    expect(isGstRegistered(baseData())).toBe(false);
  });
});

// =============================================================================
// Section 6: isSameState — determines CGST/SGST vs IGST split
//
// Under GST law, transactions within the same state attract CGST + SGST
// (50% each). Cross-state transactions attract IGST (full amount to Centre).
// An incorrect split would produce a legally invalid invoice and cause
// reconciliation failures in GSTR-1/GSTR-2B filings.
// =============================================================================

describe("isSameState — intra-state vs inter-state determination for CGST/SGST vs IGST", () => {
  /**
   * Primary lookup: businessStateCode vs partyStateCode (2-digit codes per
   * GST portal, e.g. "27" for Maharashtra, "07" for Delhi).
   * Fallback: businessState vs partyState text comparison (case-insensitive).
   * If neither is available: returns false (defaults to IGST — the safer
   * option since IGST can always be claimed; a wrongly split CGST+SGST cannot).
   */

  it("returns true when state codes match (intra-state transaction)", () => {
    /**
     * Maharashtra seller → Maharashtra buyer (both state code "27").
     * This is the common case for local B2B retail transactions.
     */
    expect(isSameState(baseData({ businessStateCode: "27", partyStateCode: "27" }))).toBe(true);
  });

  it("returns false when state codes differ (inter-state transaction)", () => {
    /**
     * Maharashtra seller (27) → Delhi buyer (07).
     * IGST applies — the entire tax goes to the Centre which then transfers
     * the state share to the destination state (Delhi).
     */
    expect(isSameState(baseData({ businessStateCode: "27", partyStateCode: "07" }))).toBe(false);
  });

  it("falls back to text comparison when state codes are absent", () => {
    expect(isSameState(baseData({ businessState: "Maharashtra", partyState: "Maharashtra" }))).toBe(true);
    expect(isSameState(baseData({ businessState: "Maharashtra", partyState: "Delhi" }))).toBe(false);
  });

  it("text fallback is case-insensitive", () => {
    /**
     * State names can be entered in mixed case by users. The comparison
     * must normalise before comparing.
     */
    expect(isSameState(baseData({ businessState: "MAHARASHTRA", partyState: "maharashtra" }))).toBe(true);
    expect(isSameState(baseData({ businessState: "Tamil Nadu", partyState: "tamil nadu" }))).toBe(true);
  });

  it("state code match takes priority over state name", () => {
    /**
     * If both codes and names are set, codes win. This prevents edge cases
     * where codes and names disagree (e.g. data entry error in one field).
     */
    expect(isSameState(baseData({
      businessStateCode: "27",
      partyStateCode: "27",
      businessState: "Maharashtra",
      partyState: "Delhi", // name mismatch — code should win
    }))).toBe(true);
  });

  it("returns false when no state information is provided at all", () => {
    /**
     * Missing state data defaults to IGST to avoid generating an invalid
     * CGST+SGST split. An auditor can always verify IGST transactions.
     */
    expect(isSameState(baseData())).toBe(false);
  });
});

// =============================================================================
// Section 7: buildGstBreakdown — rate-wise GST table for the invoice footer
//
// GST-compliant invoices must show a tax breakdown table: each applicable rate
// with the taxable amount and tax split (CGST/SGST or IGST). This table is
// used by the buyer to file their GST returns.
// =============================================================================

describe("buildGstBreakdown — rate-wise GST breakdown table for GSTR compliance", () => {
  /**
   * The function:
   *  1. Groups line items by tax rate (12%, 18%, etc.)
   *  2. Accumulates taxable amount = totalAmount - taxAmount per item
   *  3. For same-state: splits taxAmount 50/50 into CGST + SGST
   *  4. For different-state: assigns full taxAmount to IGST
   *
   * Floating-point accumulation is acceptable here because the values are
   * for display purposes only — the authoritative amounts are on each line
   * item and in the invoice totals.
   */

  /** A minimal sale line item factory. */
  function lineItem(
    taxPercent: string,
    totalAmount: string,
    taxAmount: string,
  ) {
    return {
      description: "Item",
      quantity: "1",
      unitPrice: totalAmount,
      taxPercent,
      taxAmount,
      discountPercent: "0",
      totalAmount,
    };
  }

  it("produces CGST + SGST (50/50 split) for same-state transactions", () => {
    /**
     * Example: Maharashtra seller → Maharashtra buyer, 18% GST on ₹1000
     *   taxable = 1180 - 180 = 1000
     *   CGST = 90, SGST = 90, IGST = 0
     */
    const data = baseData({
      businessStateCode: "27",
      partyStateCode: "27",
      lineItems: [lineItem("18", "1180", "180")],
    });
    const breakdown = buildGstBreakdown(data);

    expect(breakdown).toHaveLength(1);
    const row = breakdown[0];
    expect(row.rate).toBe("18");
    expect(row.taxable).toBeCloseTo(1000);
    expect(row.cgst).toBeCloseTo(90);
    expect(row.sgst).toBeCloseTo(90);
    expect(row.igst).toBe(0);
  });

  it("produces IGST (full amount) for different-state transactions", () => {
    /**
     * Maharashtra seller → Delhi buyer, 18% GST on ₹1000
     *   CGST = 0, SGST = 0, IGST = 180
     */
    const data = baseData({
      businessStateCode: "27",
      partyStateCode: "07",
      lineItems: [lineItem("18", "1180", "180")],
    });
    const breakdown = buildGstBreakdown(data);

    expect(breakdown).toHaveLength(1);
    const row = breakdown[0];
    expect(row.cgst).toBe(0);
    expect(row.sgst).toBe(0);
    expect(row.igst).toBeCloseTo(180);
  });

  it("groups multiple line items with the same tax rate into one row", () => {
    /**
     * Two items both at 12% GST — the breakdown must show a single 12% row
     * with the combined taxable amount and tax. If they appeared as separate
     * rows, the invoice footer table would be unnecessarily verbose.
     *
     * Example: two clothing items at 12% GST, intra-state (state code "29" = Karnataka)
     *   Item 1: total=560, tax=60, taxable=500
     *   Item 2: total=1120, tax=120, taxable=1000
     *   Combined: taxable=1500, CGST=90, SGST=90
     */
    const data = baseData({
      businessStateCode: "29",
      partyStateCode: "29",
      lineItems: [
        lineItem("12", "560", "60"),
        lineItem("12", "1120", "120"),
      ],
    });
    const breakdown = buildGstBreakdown(data);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].rate).toBe("12");
    expect(breakdown[0].taxable).toBeCloseTo(1500);
    expect(breakdown[0].cgst).toBeCloseTo(90);
    expect(breakdown[0].sgst).toBeCloseTo(90);
  });

  it("produces separate rows for different tax rates", () => {
    /**
     * A mixed invoice with two different GST rates (common in wholesale):
     *   Item 1: 12% GST (e.g. fabrics)
     *   Item 2: 18% GST (e.g. synthetic material)
     * The breakdown table must show two distinct rows.
     */
    const data = baseData({
      businessStateCode: "27",
      partyStateCode: "27",
      lineItems: [
        lineItem("12", "1120", "120"),
        lineItem("18", "1180", "180"),
      ],
    });
    const breakdown = buildGstBreakdown(data);

    expect(breakdown).toHaveLength(2);
    const rates = breakdown.map((r) => r.rate);
    expect(rates).toContain("12");
    expect(rates).toContain("18");
  });

  it("returns an empty array when there are no line items", () => {
    const data = baseData({ businessStateCode: "27", partyStateCode: "27", lineItems: [] });
    expect(buildGstBreakdown(data)).toEqual([]);
  });

  it("handles zero-tax items (0% GST) correctly", () => {
    /**
     * Essential commodities like unprocessed food grains attract 0% GST.
     * These items still appear in the breakdown table to demonstrate
     * compliance — taxable amount is shown but CGST/SGST/IGST are all zero.
     */
    const data = baseData({
      businessStateCode: "27",
      partyStateCode: "27",
      lineItems: [lineItem("0", "500", "0")],
    });
    const breakdown = buildGstBreakdown(data);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].rate).toBe("0");
    expect(breakdown[0].taxable).toBeCloseTo(500);
    expect(breakdown[0].cgst).toBe(0);
    expect(breakdown[0].sgst).toBe(0);
    expect(breakdown[0].igst).toBe(0);
  });
});

// ─── UPI Payment URL Construction ────────────────────────────────────────────
// These test the UPI deep link format used for clickable QR codes in PDFs.
// The URL is built in server.ts and passed to the PDF generator.

describe("UPI payment URL format", () => {
  function buildUpiUrl(opts: {
    upiId: string;
    payeeName: string;
    amount: number;
    transactionNote: string;
  }): string {
    return `upi://pay?pa=${encodeURIComponent(opts.upiId)}&pn=${encodeURIComponent(opts.payeeName)}&am=${opts.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(opts.transactionNote)}`;
  }

  it("builds a valid UPI deep link with correct parameters", () => {
    const url = buildUpiUrl({
      upiId: "gupta@upi",
      payeeName: "Gupta Traders",
      amount: 1500.50,
      transactionNote: "INV-00042",
    });
    expect(url).toBe("upi://pay?pa=gupta%40upi&pn=Gupta%20Traders&am=1500.50&cu=INR&tn=INV-00042");
  });

  it("encodes special characters in payee name", () => {
    const url = buildUpiUrl({
      upiId: "business@paytm",
      payeeName: "Sharma & Sons (P) Ltd",
      amount: 10000,
      transactionNote: "INV-00100",
    });
    expect(url).toContain("pn=Sharma%20%26%20Sons%20(P)%20Ltd");
    expect(url).toContain("am=10000.00");
  });

  it("uses remaining balance for partially paid invoice", () => {
    const totalAmount = 5000;
    const amountPaid = 2000;
    const balance = totalAmount - amountPaid;
    const url = buildUpiUrl({
      upiId: "shop@ybl",
      payeeName: "My Shop",
      amount: balance,
      transactionNote: "INV-00200",
    });
    expect(url).toContain("am=3000.00");
  });

  it("uses full amount when nothing is paid", () => {
    const url = buildUpiUrl({
      upiId: "biz@upi",
      payeeName: "Business",
      amount: 25000,
      transactionNote: "INV-00001",
    });
    expect(url).toContain("am=25000.00");
  });

  it("formats amount to exactly 2 decimal places", () => {
    const url = buildUpiUrl({
      upiId: "test@upi",
      payeeName: "Test",
      amount: 99.9,
      transactionNote: "INV-00003",
    });
    expect(url).toContain("am=99.90");
  });

  it("uses closing balance for ledger QR", () => {
    const closingBalance = "12450.75";
    const url = buildUpiUrl({
      upiId: "shop@upi",
      payeeName: "My Business",
      amount: parseFloat(closingBalance),
      transactionNote: "Outstanding - Gupta Enterprises",
    });
    expect(url).toContain("am=12450.75");
    expect(url).toContain("tn=Outstanding%20-%20Gupta%20Enterprises");
  });
});

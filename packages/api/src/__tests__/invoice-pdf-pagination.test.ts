/**
 * PDF pagination regression tests.
 *
 * The A4 and A5 invoice templates place everything by hand, so they have to decide their own page
 * breaks. They once did not: PDFKit's bottom-margin auto-break fired on every text call that landed
 * below the margin (one new page per call, with the text stacked at the top), and the "Page X of N"
 * stamp sat inside that margin, so stamping an N-page invoice added N more pages. A paid-plan A5
 * invoice whose only overflow was its footer line came out as 4 pages (2 content + 2 stamp pages);
 * a 5-line A5 invoice came out as 40.
 *
 * These tests render synthetic invoices (see helpers/pdf-fixtures.ts) and pin the page counts. The
 * bounds are the layout's actual counts, not generous ceilings: a template change that adds a page
 * has to be a conscious one. Counts are the PDF's own page objects, so a stray page (an orphaned
 * footer, a stamp page) shows up here.
 */

import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import { generateLedgerPDF, type LedgerPDFData } from "../lib/ledger-pdf.js";
import { buildFullInvoice, countPdfPages, renderInvoicePdf } from "./helpers/pdf-fixtures.js";

/** A "lean" invoice: no per-line notes, no notes/terms, no bank / UPI / QR block. */
const LEAN = { lineNotes: false, notesAndTerms: false, payment: false } as const;

describe("A5 invoice pagination", () => {
  // [line items, expected pages] for a realistic full invoice: HSN, mixed GST rates, long item
  // names, per-line notes, notes, terms, bank + UPI + QR, signature, status stamp.
  it.each([
    [1, 2],
    [5, 2],
    [10, 2],
    [15, 3],
    [20, 3],
    [30, 4],
    [40, 4],
  ])("a full %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines), "a5");
    expect(countPdfPages(pdf)).toBe(pages);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [10, 2],
    [20, 2],
    [40, 3],
  ])("a lean %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines, LEAN), "a5");
    expect(countPdfPages(pdf)).toBe(pages);
  });

  it("does not spill a footer-only overflow onto extra pages (paid plan, 3 lines)", async () => {
    // The founder's case: everything fits except the one-line footer. Before the fix this was
    // 2 content pages + 2 "Page X of 2" pages = 4 pages. It now fits on one.
    const data = await buildFullInvoice(3, LEAN);
    data.isPaidPlan = true;
    data.businessLegalName = undefined;
    data.lineItems.forEach((li) => (li.itemName = li.itemName.slice(0, 30)));
    expect(countPdfPages(await renderInvoicePdf(data, "a5"))).toBe(1);
  });
});

describe("A4 invoice pagination", () => {
  it.each([
    [1, 1],
    [3, 1],
    [5, 2],
    [10, 2],
    [20, 2],
    [30, 2],
    [40, 3],
  ])("a full %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines), "a4");
    expect(countPdfPages(pdf)).toBe(pages);
  });

  it.each([
    [1, 1],
    [10, 1],
    [12, 2],
    [20, 2],
    [40, 2],
  ])("a lean %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines, LEAN), "a4");
    expect(countPdfPages(pdf)).toBe(pages);
  });
});

describe("thermal receipt is unaffected", () => {
  // Thermal is one tall page sized from the item count; the A4/A5 pagination does not apply to it.
  it.each([1, 5, 20, 40])("a lean %i-line receipt is a single 226pt-wide page", async (lines) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines, LEAN), "thermal");
    expect(countPdfPages(pdf)).toBe(1);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 226 /);
  });
});

describe("party ledger pagination", () => {
  const entries = (n: number): LedgerPDFData["entries"] =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(2026, 3, 1 + (i % 28)),
      type: i % 3 === 2 ? ("payment" as const) : ("invoice" as const),
      number: `INV-${1000 + i}`,
      description: i % 3 === 2 ? "Payment received" : "Sale invoice",
      debit: i % 3 === 2 ? "0.00" : "1500.00",
      credit: i % 3 === 2 ? "1500.00" : "0.00",
      runningBalance: String(1500 * (i + 1)),
    }));

  const ledger = async (n: number, withQr: boolean): Promise<LedgerPDFData> => ({
    businessName: "Anand Traders",
    partyName: "Bhagirathi Stores",
    partyType: "customer",
    openingBalance: "0.00",
    fromDate: null,
    toDate: null,
    entries: entries(n),
    summary: { totalDebit: "1000.00", totalCredit: "500.00", closingBalance: "500.00" },
    upiQrDataUrl: withQr ? await QRCode.toDataURL("upi://pay?pa=a@b", { width: 120, margin: 1 }) : undefined,
    upiPayUrl: withQr ? "https://example.invalid/pay" : undefined,
  });

  it.each([
    // [entries, with QR, expected pages]
    [0, false, 1],
    [25, true, 1],
    // The closing row, QR and footer are kept together; they used to run off the page and
    // spill the QR caption and the footer onto two extra pages.
    [28, true, 2],
    [30, false, 1],
    [31, false, 2],
    [70, true, 3],
    [70, false, 2],
  ])("%i entries (QR: %s) take %i pages", async (n, withQr, pages) => {
    const pdf = await generateLedgerPDF(await ledger(n, withQr));
    expect(countPdfPages(pdf)).toBe(pages);
  });
});

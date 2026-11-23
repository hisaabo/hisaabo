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
 * Item rows used to be a fixed height, so a wrapped item name or row note was drawn over the row
 * below instead of taking room (see invoice-pdf-layout.test.ts), and the A5 legal name shared a
 * line with the address. Rows now take the height of their wrapped text and the legal name has
 * its own line. The fixtures' long item names and two-line row notes are what push some of the
 * counts below up by one page (each is marked with its old count): the same invoices, now with
 * nothing drawn on top of anything else.
 *
 * The closing block (totals, amount in words, signatory, footer) used to need the signatory under
 * the totals, so a lean invoice that missed that by a few points put the totals on one page and the
 * signatory and footer alone on the next. The signatory now stands beside the totals when that is
 * all that keeps it off the page (A5: between the amount in words and the totals; A4: left of the
 * totals), and when it fits neither way the totals move to the next page with it. That brought
 * lean A5 invoices of up to 6 short lines and lean A4 invoices of up to 15 back to one page.
 *
 * These tests render synthetic invoices (see helpers/pdf-fixtures.ts) and pin the page counts. The
 * bounds are the layout's actual counts, not generous ceilings: a template change that adds a page
 * has to be a conscious one. Counts are the PDF's own page objects, so a stray page (an orphaned
 * footer, a stamp page) shows up here.
 */

import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import { generateLedgerPDF, type LedgerPDFData } from "../lib/ledger-pdf.js";
import { buildFullInvoice, buildNormalInvoice, countPdfPages, renderInvoicePdf } from "./helpers/pdf-fixtures.js";
import { traceInvoiceLayout, type LayoutTrace } from "./helpers/pdf-layout-trace.js";

/** The (0-based) page a piece of text was drawn on. */
const pageOf = (trace: LayoutTrace, text: string): number => {
  const box = trace.boxes.find((b) => b.text === text);
  if (!box) throw new Error(`"${text}" was not drawn`);
  return box.page;
};

/** A "lean" invoice: no per-line notes, no notes/terms, no bank / UPI / QR block. */
const LEAN = { lineNotes: false, notesAndTerms: false, payment: false } as const;

describe("A5 invoice pagination", () => {
  // [line items, expected pages] for a realistic full invoice: HSN, mixed GST rates, long item
  // names, per-line notes, notes, terms, bank + UPI + QR, signature, status stamp.
  it.each([
    [1, 2],
    [5, 2],
    [10, 3], // 2 before
    [15, 3],
    [20, 3],
    [30, 4],
    [40, 5], // 4 before
  ])("a full %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines), "a5");
    expect(countPdfPages(pdf)).toBe(pages);
  });

  it.each([
    [1, 1],
    [2, 1],
    [3, 1], // 2 before: the signatory and footer were alone on page 2
    [10, 2],
    [20, 2],
    [40, 4], // 3 before: rows take the height of their wrapped names
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
    [3, 2], // 1 before: the notes block now counts the notes' own height (they were drawn over the footer)
    [5, 2],
    [10, 2],
    [20, 2],
    [30, 3], // 2 before
    [40, 3],
  ])("a full %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines), "a4");
    expect(countPdfPages(pdf)).toBe(pages);
  });

  it.each([
    [1, 1],
    [10, 1],
    [12, 1], // 2 before: the signatory and footer were alone on page 2
    [20, 2],
    [40, 2],
  ])("a lean %i-line invoice takes %i pages", async (lines, pages) => {
    const pdf = await renderInvoicePdf(await buildFullInvoice(lines, LEAN), "a4");
    expect(countPdfPages(pdf)).toBe(pages);
  });
});

describe("lean invoices: the closing block never leaves a page of its own", () => {
  // Short item names (one line each), no notes, terms or bank block; the totals carry a paid and a
  // balance-due row and the footer is the free-plan one, so this is the tightest closing block.
  const lean = async (lines: number, format: "a4" | "a5") => {
    const data = await buildNormalInvoice(lines, LEAN);
    if (format === "a5") data.businessLegalName = undefined;
    return data;
  };

  it.each([1, 3, 5, 6])("A5: %i lines fit on one page", async (lines) => {
    expect(countPdfPages(await renderInvoicePdf(await lean(lines, "a5"), "a5"))).toBe(1);
  });

  it.each([1, 5, 10, 14, 15])("A4: %i lines fit on one page", async (lines) => {
    expect(countPdfPages(await renderInvoicePdf(await lean(lines, "a4"), "a4"))).toBe(1);
  });

  it("A5: the first line count that does not fit moves the totals and the signatory together", async () => {
    const data = await lean(7, "a5");
    const trace = traceInvoiceLayout(data, "a5");
    expect(trace.pageCount).toBe(2);
    expect(pageOf(trace, "TOTAL")).toBe(1);
    expect(pageOf(trace, "Authorized Signatory")).toBe(1);
  });

  it("A4: the first line count that does not fit moves the totals and the signatory together", async () => {
    const trace = traceInvoiceLayout(await lean(16, "a4"), "a4");
    expect(trace.pageCount).toBe(2);
    expect(pageOf(trace, "TOTAL")).toBe(1);
    expect(pageOf(trace, "Authorized Signatory")).toBe(1);
  });

  // No page may hold only the signatory and the footer, for any line count, with or without
  // per-line notes, a paid plan, or an unpaid invoice (a shorter totals block).
  it.each([
    ["a5", {}],
    ["a5", { unpaid: true }],
    ["a5", { paidPlan: true }],
    ["a4", {}],
    ["a4", { unpaid: true }],
    ["a4", { paidPlan: true }],
  ] as const)("%s %j: no page holds only the signatory and the footer", async (format, variant) => {
    for (let lines = 1; lines <= 24; lines++) {
      const data = await lean(lines, format);
      if ("unpaid" in variant) data.amountPaid = "0.00";
      if ("paidPlan" in variant) data.isPaidPlan = true;
      const trace = traceInvoiceLayout(data, format);
      const closing = new Set([data.businessName, "For", "Authorized Signatory"]);
      const footer = (t: string) => /^(This is a computer-generated invoice|Powered by)/.test(t);
      for (let page = 0; page < trace.pageCount; page++) {
        const texts = trace.boxes.filter((b) => b.page === page).map((b) => b.text);
        const other = texts.filter((t) => !closing.has(t) && !footer(t));
        expect(other.length, `${format} ${lines} lines: page ${page + 1} has only the signatory / footer`).toBeGreaterThan(0);
      }
      // ... and the totals are on the signatory's page
      expect(pageOf(trace, "TOTAL"), `${format} ${lines} lines`).toBe(pageOf(trace, "Authorized Signatory"));
    }
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

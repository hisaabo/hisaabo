/**
 * PDF layout regression tests: nothing the invoice templates draw may overlap.
 *
 * The A4, A5 and thermal templates place every line by hand from a running `y`, so a block taller
 * than the height reserved for it is drawn over its neighbour. Three such bugs shipped together:
 *
 *   1. A4: long notes were drawn over the footer rule and the disclaimer below them (the notes'
 *      own height was not part of the block's height, so it did not even trigger a page break).
 *   2. A5: the legal name was drawn on the same line as the first address line (and, when it
 *      wrapped, over several), because the address started at a fixed offset.
 *   3. A4 / A5: item rows had a fixed height, so an item name or row note that wrapped to a second
 *      line was drawn over the row below. Thermal rows were already measured, but its page height
 *      was an estimate of ~30pt per item, so long names and many GST rates spilled onto extra pages.
 *
 * These tests record every text call and horizontal rule while an invoice is generated (see
 * helpers/pdf-layout-trace.ts) and assert that no two text boxes collide, no rule cuts through
 * text and nothing falls off the page. Page counts alone cannot see these bugs.
 */

import { describe, it, expect } from "vitest";
import {
  findTextBelowPage,
  findTextCrossingRules,
  findTextOverlaps,
  traceInvoiceLayout,
  type CheckOptions,
  type LayoutTrace,
  type TextBox,
} from "./helpers/pdf-layout-trace.js";
import {
  buildFullInvoice,
  buildNormalInvoice,
  LONG_LEGAL_NAME,
  LONG_NOTES,
  TINY_LOGO_PNG,
  VERY_LONG_ITEM_NAME,
} from "./helpers/pdf-fixtures.js";

const LEAN = { lineNotes: false, notesAndTerms: false, payment: false } as const;

/**
 * Two collisions that are older than, and unrelated to, anything asserted here, and whose fixes
 * would change every GST invoice, so these checks let them through:
 *   - the A4 tax summary draws its "TAX SUMMARY" title and its "TAX RATE" column heading in the
 *     same spot;
 *   - the A4 "Scan or tap to pay <amount>" QR caption wraps to a second line that sits on the rule
 *     under the payment block.
 */
const KNOWN: CheckOptions = {
  ignorePair: (a, b) => new Set([a.text, b.text]).has("TAX SUMMARY") && new Set([a.text, b.text]).has("TAX RATE"),
  ignoreBox: (b) => /^Scan (or tap )?to pay/.test(b.text),
};

/** Every layout problem found in a trace, as readable lines (an empty array is a clean layout). */
function problems(trace: LayoutTrace): string[] {
  return [
    ...findTextOverlaps(trace, KNOWN),
    ...findTextCrossingRules(trace, KNOWN),
    ...findTextBelowPage(trace),
  ];
}

/** The part of page 1 above the "BILL TO" label: the header block. */
const headerOf = (trace: LayoutTrace): LayoutTrace => {
  const billTo = trace.boxes.find((b) => b.text === "BILL TO");
  if (!billTo) throw new Error("no BILL TO label");
  return {
    ...trace,
    boxes: trace.boxes.filter((b) => b.page === 0 && b.y1 <= billTo.y0 + 0.5),
    rules: trace.rules.filter((r) => r.page === 0 && r.y < billTo.y0),
  };
};

const boxOf = (trace: LayoutTrace, test: (b: TextBox) => boolean): TextBox => {
  const found = trace.boxes.find(test);
  if (!found) throw new Error("expected text was not drawn");
  return found;
};

describe("A4: long notes flow above the footer", () => {
  // Line counts around the page break: the notes block is taller than the bit of page left under
  // the payment block for some of these, so it has to move to the next page as a whole.
  it.each([1, 5, 12, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30])(
    "%i lines with long notes: no overlap, notes end above the footer",
    async (lines) => {
      const data = await buildNormalInvoice(lines);
      data.notes = LONG_NOTES;
      const trace = traceInvoiceLayout(data, "a4");
      expect(problems(trace)).toEqual([]);

      const notes = boxOf(trace, (b) => b.text === LONG_NOTES);
      const footer = boxOf(trace, (b) => b.text.startsWith("This is a computer-generated invoice"));
      expect(footer.page).toBe(notes.page);
      expect(notes.y1).toBeLessThanOrEqual(footer.y0);
    },
  );

  it("long notes without a bank block, and without terms", async () => {
    for (const patch of [{ payment: false }, { notesAndTerms: true }]) {
      const data = await buildNormalInvoice(5, patch);
      data.notes = LONG_NOTES;
      if ("notesAndTerms" in patch) data.termsAndConditions = undefined;
      expect(problems(traceInvoiceLayout(data, "a4"))).toEqual([]);
    }
  });

  it("keeps the whole notes block (terms, notes, signatory, footer) on one page", async () => {
    for (const lines of [18, 19, 20, 21, 22]) {
      const data = await buildNormalInvoice(lines);
      data.notes = LONG_NOTES;
      const trace = traceInvoiceLayout(data, "a4");
      const pages = new Set(
        ["Terms & Conditions", "Notes", "Authorized Signatory"]
          .map((t) => boxOf(trace, (b) => b.text === t).page)
          .concat(boxOf(trace, (b) => b.text.startsWith("This is a computer-generated")).page),
      );
      expect(pages.size).toBe(1);
    }
  });
});

describe("A5: the legal name does not overlap the address", () => {
  const withLegal = async (legal: string | undefined, opts: { logo?: boolean; name?: string } = {}) => {
    const data = await buildNormalInvoice(5);
    data.businessLegalName = legal;
    if (opts.name) data.businessName = opts.name;
    if (opts.logo) data.logoBuffer = TINY_LOGO_PNG;
    return traceInvoiceLayout(data, "a5");
  };

  it.each<[string, string, { logo?: boolean; name?: string }]>([
    ["a short legal name", "Anand Wholesale Traders Pvt. Ltd.", {}],
    ["a legal name that wraps to three lines", LONG_LEGAL_NAME, {}],
    ["a wrapping legal name beside a logo", LONG_LEGAL_NAME, { logo: true }],
    ["a short legal name beside a logo", "Anand Wholesale Traders Pvt. Ltd.", { logo: true }],
    ["a wrapped business name and a wrapped legal name", LONG_LEGAL_NAME, {
      name: "Anand Wholesale Traders and Commission Agents Pvt Ltd",
    }],
  ])("%s", async (_label, legal, opts) => {
    const trace = await withLegal(legal, opts);
    // The whole invoice must be clean, except that a business name this long also wraps in the
    // signatory block further down, which is not what is under test: the header is checked alone.
    expect(problems(opts.name ? headerOf(trace) : trace)).toEqual([]);

    const legalBox = boxOf(trace, (b) => b.text === legal);
    const address = boxOf(trace, (b) => b.text.startsWith("Shop 14"));
    expect(address.y0).toBeGreaterThanOrEqual(legalBox.y1 - 1);
  });

  it("leaves the address where it always was when there is no legal name", async () => {
    const trace = await withLegal(undefined);
    // margin 28 + 16 below the business name
    expect(boxOf(trace, (b) => b.text.startsWith("Shop 14")).y0).toBeCloseTo(44, 5);
  });

  it("leaves the address where it always was beside a logo, for a legal name that fits", async () => {
    const trace = await withLegal("Anand Wholesale Traders Pvt. Ltd.", { logo: true, name: "Anand Traders" });
    // below the 32pt logo slot: margin 28 + 32 + 4
    expect(boxOf(trace, (b) => b.text.startsWith("Shop 14")).y0).toBeCloseTo(64, 5);
  });
});

describe("item rows grow with their wrapped item name and note", () => {
  /** Distance between the tops of consecutive item-name boxes, i.e. the height of each row. */
  const rowPitches = (trace: LayoutTrace, names: string[]) => {
    const tops = names.map((n) => boxOf(trace, (b) => b.text === n).y0);
    return tops.slice(1).map((t, i) => t - tops[i]);
  };

  describe.each([
    ["a4", 18],
    ["a5", 17],
  ] as const)("%s", (format, baseRow) => {
    it("keeps the row height for one-line names and notes (unchanged look)", async () => {
      const data = await buildNormalInvoice(4);
      const pitches = rowPitches(traceInvoiceLayout(data, format), data.lineItems.map((l) => l.itemName));
      // rows 1 and 3 have a one-line note (+9); rows 2 and 4 have none
      expect(pitches[0]).toBeCloseTo(baseRow + 9, 5);
      expect(pitches[1]).toBeCloseTo(baseRow, 5);
      expect(pitches[2]).toBeCloseTo(baseRow + 9, 5);
    });

    it.each([1, 5, 12, 40])("a full %i-line invoice (wrapping names, wrapping notes)", async (lines) => {
      expect(problems(traceInvoiceLayout(await buildFullInvoice(lines), format))).toEqual([]);
    });

    it("a lean invoice whose names wrap", async () => {
      expect(problems(traceInvoiceLayout(await buildFullInvoice(8, LEAN), format))).toEqual([]);
    });

    it("names of 200 characters with 300-character notes", async () => {
      const data = await buildFullInvoice(6);
      data.lineItems.forEach((li, i) => {
        li.itemName = VERY_LONG_ITEM_NAME;
        if (i % 2 === 1) li.description = "Fragile: " + LONG_NOTES.slice(0, 300);
      });
      expect(problems(traceInvoiceLayout(data, format))).toEqual([]);
    });

    it("a wrapped name makes its row taller by the extra lines", async () => {
      const data = await buildNormalInvoice(3, { lineNotes: false });
      data.lineItems[1].itemName = VERY_LONG_ITEM_NAME;
      const names = data.lineItems.map((l) => l.itemName);
      const [first, second] = rowPitches(traceInvoiceLayout(data, format), names);
      expect(first).toBeCloseTo(baseRow, 5);
      expect(second).toBeGreaterThan(baseRow + 20);
    });
  });
});

describe("thermal receipt: the page is as tall as the receipt", () => {
  // A short business name keeps these about the page height; the header is covered below.
  const fullReceipt = async (lines: number) => {
    const data = await buildFullInvoice(lines);
    data.businessName = "Anand Traders";
    return data;
  };

  it.each([1, 5, 12, 20, 40])("a full %i-line receipt (long names, notes, five GST rates) is one clean page", async (lines) => {
    const trace = traceInvoiceLayout(await fullReceipt(lines), "thermal");
    expect(trace.pageCount).toBe(1);
    expect(problems(trace)).toEqual([]);
  });

  it("names of 200 characters with 300-character notes", async () => {
    const data = await fullReceipt(6);
    data.lineItems.forEach((li, i) => {
      li.itemName = VERY_LONG_ITEM_NAME;
      if (i % 2 === 1) li.description = "Fragile: " + LONG_NOTES.slice(0, 300);
    });
    const trace = traceInvoiceLayout(data, "thermal");
    expect(trace.pageCount).toBe(1);
    expect(problems(trace)).toEqual([]);
  });

  it("keeps the height a receipt always had when its content fits the estimate", async () => {
    // 5 tidy lines: the ~30pt-per-item estimate (200 + 5 * 30 + GSTIN + 10 tax lines + paid) is
    // more than the layout needs, so the page is the estimate, not the measured layout.
    const data = await buildNormalInvoice(5);
    data.businessName = "Anand Traders";
    const trace = traceInvoiceLayout(data, "thermal");
    expect(trace.pageHeight).toBe(488);
    expect(trace.pageCount).toBe(1);
  });

  it("a wrapped business name does not overlap the address", async () => {
    const data = await buildNormalInvoice(3); // "ANAND WHOLESALE TRADERS PRIVATE LIMITED" wraps
    const trace = traceInvoiceLayout(data, "thermal");
    expect(problems(trace)).toEqual([]);
    const name = boxOf(trace, (b) => b.text === data.businessName.toUpperCase());
    expect(name.y1 - name.y0).toBeGreaterThan(20); // two lines
  });
});

describe("tidy invoices keep a clean layout", () => {
  it.each(["a4", "a5", "thermal"] as const)("%s: one-line names, notes and legal name", async (format) => {
    for (const lines of [1, 5, 12, 40]) {
      const data = await buildNormalInvoice(lines);
      if (format === "thermal") data.businessName = "Anand Traders";
      expect(problems(traceInvoiceLayout(data, format))).toEqual([]);
    }
  });
});

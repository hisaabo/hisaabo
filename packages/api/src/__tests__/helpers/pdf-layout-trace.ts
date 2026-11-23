/**
 * pdf-layout-trace.ts — records where the invoice PDF templates put their text and rules, so a test
 * can assert that nothing overlaps without rasterising or parsing the PDF.
 *
 * The A4 / A5 / thermal templates place every line by hand from a running `y`, so a block that
 * is taller than the height reserved for it draws over its neighbour (a wrapped item name over the
 * row note below it, long notes over the footer rule, a wrapped legal name over the address). Those
 * bugs are invisible to a page-count assertion. This helper spies on `PDFDocument.prototype.text`,
 * `moveTo` and `lineTo` while an invoice is generated and keeps, for every text call, the box it
 * occupies (position, wrapped height, aligned width) and, for every horizontal rule, its position.
 *
 * Boxes are line boxes (font ascent + descent), which are a little taller than the glyphs: the
 * templates deliberately stack single lines that touch by about a point, so the overlap checks
 * take a tolerance (default 2pt) and only report real collisions.
 */

import PDFDocument from "pdfkit";
import { vi } from "vitest";
import { generateInvoicePDF, type InvoicePDFData, type PDFFormat } from "../../lib/invoice-pdf.js";

export interface TextBox {
  page: number;
  text: string;
  x0: number;
  x1: number;
  /** Top and bottom of the (wrapped) text, in points from the top of the page. */
  y0: number;
  y1: number;
  fontSize: number;
}

export interface Rule {
  page: number;
  y: number;
  x0: number;
  x1: number;
}

export interface LayoutTrace {
  boxes: TextBox[];
  rules: Rule[];
  pageCount: number;
  pageHeight: number;
  pageWidth: number;
}

// Drawn after the layout (stamps are rotated, "Page X of N" sits in the bottom margin on purpose).
const STAMP_TEXT = /^(PAID|PARTIAL|OVERDUE|CANCELLED|DRAFT|Page \d+ of \d+)$/;

type Doc = InstanceType<typeof PDFDocument> & Record<string, any>;

/** Generate `data` as `format` and return where everything was placed. */
export function traceInvoiceLayout(data: InvoicePDFData, format: PDFFormat): LayoutTrace {
  // Per document: the thermal template also lays the receipt out on a scratch document to size its
  // page, and that layout must not be mixed into the trace of the real one.
  const perDoc = new Map<object, { boxes: TextBox[]; rules: Rule[] }>();
  const recordsOf = (doc: object) => {
    let r = perDoc.get(doc);
    if (!r) perDoc.set(doc, (r = { boxes: [], rules: [] }));
    return r;
  };
  const lastMove = new WeakMap<object, { x: number; y: number }>();

  const proto = PDFDocument.prototype as Record<string, any>;
  const origText = proto.text;
  const origMoveTo = proto.moveTo;
  const origLineTo = proto.lineTo;

  const pageOf = (doc: Doc) => (doc._pageBuffer as unknown[]).indexOf(doc.page);

  const textSpy = vi.spyOn(proto, "text").mockImplementation(function (this: Doc, ...args: any[]) {
    const [text, x, y, options] = args;
    if (typeof text === "string" && typeof x === "number" && typeof y === "number" && !STAMP_TEXT.test(text)) {
      const opts: { width?: number; align?: string } = options ?? {};
      const lineH = this.currentLineHeight(true);
      // Without an explicit width PDFKit wraps at the right margin, measured from the x it is given.
      const wrapW = opts.width ?? this.page.width - x - this.page.margins.right;
      const h = this.heightOfString(text, { width: wrapW });
      let x0 = x;
      let x1 = x + (opts.width ?? this.widthOfString(text));
      if (h <= lineH * 1.01 && text.length > 0) {
        // One line: its box is the text itself, positioned by the alignment inside `width`.
        const w = Math.min(this.widthOfString(text), opts.width ?? Infinity);
        if (opts.width && opts.align === "right") x0 = x + opts.width - w;
        else if (opts.width && opts.align === "center") x0 = x + (opts.width - w) / 2;
        x1 = x0 + w;
      }
      recordsOf(this).boxes.push({ page: pageOf(this), text, x0, x1, y0: y, y1: y + h, fontSize: this._fontSize });
    }
    return origText.apply(this, args);
  });
  const moveSpy = vi.spyOn(proto, "moveTo").mockImplementation(function (this: Doc, ...args: any[]) {
    const [x, y] = args as [number, number];
    lastMove.set(this, { x, y });
    return origMoveTo.call(this, x, y);
  });
  const lineSpy = vi.spyOn(proto, "lineTo").mockImplementation(function (this: Doc, ...args: any[]) {
    const [x, y] = args as [number, number];
    const from = lastMove.get(this);
    if (from && Math.abs(from.y - y) < 1e-6 && Math.abs(x - from.x) >= 20) {
      recordsOf(this).rules.push({ page: pageOf(this), y, x0: Math.min(from.x, x), x1: Math.max(from.x, x) });
    }
    lastMove.set(this, { x, y });
    return origLineTo.call(this, x, y);
  });

  try {
    const doc = generateInvoicePDF(data, format) as Doc;
    const pageCount = doc.bufferedPageRange().count;
    const pageHeight = doc.page.height;
    const pageWidth = doc.page.width;
    const { boxes, rules } = recordsOf(doc);
    return { boxes, rules, pageCount, pageHeight, pageWidth };
  } finally {
    textSpy.mockRestore();
    moveSpy.mockRestore();
    lineSpy.mockRestore();
  }
}

const describeBox = (b: TextBox) =>
  `p${b.page + 1} "${b.text.length > 48 ? b.text.slice(0, 45) + "..." : b.text}" ` +
  `x ${b.x0.toFixed(1)}-${b.x1.toFixed(1)} y ${b.y0.toFixed(1)}-${b.y1.toFixed(1)}`;

export interface CheckOptions {
  /** Overlaps / crossings thinner than this many points are ignored (default 2). */
  tolerance?: number;
  /** Return true to ignore a colliding pair (a known, separately tracked overlap). */
  ignorePair?: (a: TextBox, b: TextBox) => boolean;
  /** Return true to ignore a text box that a rule cuts through (a known, separately tracked case). */
  ignoreBox?: (b: TextBox) => boolean;
}

/** Pairs of text boxes on the same page that share both horizontal and vertical space. */
export function findTextOverlaps(trace: LayoutTrace, opts: CheckOptions = {}): string[] {
  const tol = opts.tolerance ?? 2;
  const found: string[] = [];
  const { boxes } = trace;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.page !== b.page) continue;
      const dx = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const dy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (dx > 0.5 && dy > tol && !opts.ignorePair?.(a, b)) {
        found.push(`${describeBox(a)}  overlaps  ${describeBox(b)}  (${dy.toFixed(1)}pt)`);
      }
    }
  }
  return found;
}

/** Text boxes that a horizontal rule on the same page cuts through. */
export function findTextCrossingRules(trace: LayoutTrace, opts: CheckOptions = {}): string[] {
  const tol = opts.tolerance ?? 2;
  const found: string[] = [];
  for (const r of trace.rules) {
    for (const b of trace.boxes) {
      if (b.page !== r.page || opts.ignoreBox?.(b)) continue;
      const dx = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0);
      if (dx > 0.5 && r.y > b.y0 + tol && r.y < b.y1 - tol) {
        found.push(`${describeBox(b)}  is cut by a rule at y ${r.y.toFixed(1)} (x ${r.x0.toFixed(1)}-${r.x1.toFixed(1)})`);
      }
    }
  }
  return found;
}

/** Text boxes that run past the bottom of their page. */
export function findTextBelowPage(trace: LayoutTrace): string[] {
  return trace.boxes
    .filter((b) => b.y1 > trace.pageHeight + 0.5)
    .map((b) => `${describeBox(b)}  ends below the page (${trace.pageHeight.toFixed(1)}pt)`);
}

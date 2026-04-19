/**
 * Invoice PDF logo rendering smoke tests.
 *
 * The `drawLogo` helper inside invoice-pdf.ts is not exported, so these
 * tests exercise the logo path end-to-end through `generateInvoicePDF`
 * for each of the three supported formats (a4, a5, thermal). The
 * assertions are deliberately coarse — byte-count comparisons and
 * header checks rather than pixel snapshots — because PDFKit's output
 * is only stable-ish across minor releases and font-subset churn. The
 * invariants we care about survive that churn:
 *
 *   1. Rendering with a valid logo produces a strictly larger PDF than
 *      the same invoice without one. If a refactor silently stops
 *      emitting the logo image stream (e.g. caller passes Uint8Array
 *      and the `Buffer.isBuffer` branch was the only path), this
 *      assertion fails.
 *   2. Rendering with a corrupt buffer MUST NOT throw — a broken logo
 *      is not a reason to fail to render the invoice. This is the
 *      resilience promise in drawLogo()'s doc comment.
 *   3. An empty buffer is treated identically to an absent logo —
 *      defence against callers passing a zero-length Buffer instead of
 *      `undefined` when a business has no logo set.
 *   4. Uint8Array inputs are accepted alongside Buffer — worker-thread
 *      structuredClone strips the Buffer subclass on transfer, and a
 *      regression here would break logos on worker-rendered PDFs even
 *      though they'd work in single-thread tests.
 */

import { describe, it, expect } from "vitest";
import { generateInvoicePDF, type InvoicePDFData } from "../lib/invoice-pdf.js";

// A 1×1 transparent PNG — small enough to keep the test fast, real
// enough to exercise the PDFKit image-decode path. Base64 source is the
// same one used by server.ts as the "no logo" placeholder, so we know
// PDFKit can decode it on every supported platform.
const PNG_1PX_TRANSPARENT_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_1PX_BUF = Buffer.from(PNG_1PX_TRANSPARENT_B64, "base64");

async function renderToBuffer(data: InvoicePDFData, format: "a4" | "a5" | "thermal"): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = generateInvoicePDF(data, format);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function baseData(overrides: Partial<InvoicePDFData> = {}): InvoicePDFData {
  return {
    businessName: "Sharma Traders",
    partyName: "Walk-in Customer",
    invoiceNumber: "INV-00001",
    invoiceDate: new Date("2026-04-19").toISOString(),
    type: "sale",
    lineItems: [{
      itemName: "Basmati Rice 1 kg",
      description: null,
      quantity: "1",
      unitPrice: "80.00",
      taxPercent: "5",
      taxAmount: "4.00",
      discountPercent: "0",
      totalAmount: "84.00",
    }],
    subtotal: "80.00",
    taxAmount: "4.00",
    discountAmount: "0.00",
    totalAmount: "84.00",
    amountPaid: "0.00",
    gstRegistrationType: "unregistered",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Positive path — logo is actually drawn
// ─────────────────────────────────────────────────────────────────────────
describe("generateInvoicePDF — with a valid PNG logoBuffer", () => {
  for (const format of ["a4", "a5", "thermal"] as const) {
    it(`${format}: renders a strictly larger PDF than the same invoice without a logo`, async () => {
      const noLogo = await renderToBuffer(baseData(), format);
      const withLogo = await renderToBuffer(baseData({ logoBuffer: PNG_1PX_BUF }), format);

      // Both must be valid PDFs.
      expect(noLogo.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(withLogo.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      // The logo image stream is embedded only when a logo is present,
      // so the size difference is the clearest structural signal we
      // can get without binary-diffing PDFKit output.
      expect(withLogo.length).toBeGreaterThan(noLogo.length);
    });
  }

  it("accepts a Uint8Array logoBuffer — worker-thread structuredClone strips the Buffer subclass, so drawLogo must accept either", async () => {
    const asUint8 = new Uint8Array(PNG_1PX_BUF);
    const withU8 = await renderToBuffer(baseData({ logoBuffer: asUint8 }), "a4");
    const noLogo = await renderToBuffer(baseData(), "a4");
    expect(withU8.length).toBeGreaterThan(noLogo.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Resilience — a corrupt logo must never break the invoice
// ─────────────────────────────────────────────────────────────────────────
describe("generateInvoicePDF — resilience to broken logoBuffer inputs", () => {
  it("does not throw when logoBuffer holds bytes that are not a valid image — a corrupt upload must never take down PDF rendering", async () => {
    // Random bytes — no valid image format header
    const bogus = Buffer.from("this-is-not-an-image-at-all");
    const buf = await renderToBuffer(baseData({ logoBuffer: bogus }), "a4");
    // Must still produce a valid PDF — just with no logo drawn.
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("treats a zero-length Buffer identically to an absent logoBuffer — protects against callers passing `Buffer.alloc(0)` instead of `undefined`", async () => {
    const empty = Buffer.alloc(0);
    const [noLogo, emptyBufLogo] = await Promise.all([
      renderToBuffer(baseData(), "a4"),
      renderToBuffer(baseData({ logoBuffer: empty }), "a4"),
    ]);

    // Both paths must render. They may differ by a handful of bytes
    // because PDFKit output has trace-level nondeterminism, but the
    // logo image stream (hundreds of bytes) must NOT be present.
    expect(emptyBufLogo.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(Math.abs(emptyBufLogo.length - noLogo.length)).toBeLessThan(200);
  });

  it("a corrupt logo for thermal format still renders the receipt (estimated-height path must not allocate a logo slot for bytes we'll drop)", async () => {
    // Thermal measures the page height up front; a corrupt buffer
    // reserves the slot but drawLogo returns false, leaving the slot
    // blank. The test proves the page height calculation doesn't NaN
    // or throw.
    const bogus = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const buf = await renderToBuffer(baseData({ logoBuffer: bogus }), "thermal");
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });
});

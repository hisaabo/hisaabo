/**
 * PDF renderer smoke tests for the Bug B schema split.
 *
 * Verifies that lib/invoice-pdf.ts:generateInvoicePDF produces non-empty
 * output for the new itemName + description shape, and that rendering a
 * line with a non-null description produces a larger document than the
 * same line without description (because the secondary notes row adds
 * visible content).
 *
 * This is a function-level smoke test — not a pixel-perfect snapshot.
 * Snapshot testing a PDFKit Buffer would couple the test to glyph
 * metrics / font subset bytes which are too brittle. The "larger when
 * notes are present" assertion gives reasonable confidence that the
 * secondary line is being drawn without hard-coding binary output.
 */

import { describe, it, expect } from "vitest";
import { generateInvoicePDF, type InvoicePDFData } from "../lib/invoice-pdf.js";

async function renderToBuffer(data: InvoicePDFData, format: "a4" | "a5" | "thermal") {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = generateInvoicePDF(data, format);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function baseData(lineItems: InvoicePDFData["lineItems"]): InvoicePDFData {
  return {
    businessName: "Test Business",
    partyName: "Test Customer",
    invoiceNumber: "INV-00001",
    invoiceDate: new Date("2026-04-01").toISOString(),
    type: "sale",
    lineItems,
    subtotal: "1000.00",
    taxAmount: "0.00",
    discountAmount: "0.00",
    totalAmount: "1000.00",
    amountPaid: "0.00",
    gstRegistrationType: "unregistered",
  };
}

describe("generateInvoicePDF — itemName + description rendering (Bug B)", () => {
  for (const format of ["a4", "a5", "thermal"] as const) {
    describe(format, () => {
      it("renders a non-empty PDF with only itemName", async () => {
        const data = baseData([
          {
            itemName: "Rice Basmati",
            description: null,
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "0",
            taxAmount: "0.00",
            discountPercent: "0",
            totalAmount: "1000.00",
          },
        ]);

        const buf = await renderToBuffer(data, format);
        // PDF files start with "%PDF-"
        expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
        expect(buf.length).toBeGreaterThan(500);
      });

      it("renders a larger PDF when description (notes) is present", async () => {
        const withoutNote = baseData([
          {
            itemName: "Rice Basmati",
            description: null,
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "0",
            taxAmount: "0.00",
            discountPercent: "0",
            totalAmount: "1000.00",
          },
        ]);
        const withNote = baseData([
          {
            itemName: "Rice Basmati",
            description: "Keep separate from order #42 — customer insists on it",
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "0",
            taxAmount: "0.00",
            discountPercent: "0",
            totalAmount: "1000.00",
          },
        ]);

        const [bufA, bufB] = await Promise.all([
          renderToBuffer(withoutNote, format),
          renderToBuffer(withNote, format),
        ]);

        // Both must be valid PDFs.
        expect(bufA.subarray(0, 5).toString("ascii")).toBe("%PDF-");
        expect(bufB.subarray(0, 5).toString("ascii")).toBe("%PDF-");

        // Description renders as an extra secondary line, which means the
        // output stream carries extra glyphs. Size check is a reasonable
        // proxy without coupling to font metrics.
        expect(bufB.length).toBeGreaterThan(bufA.length);
      });

      it("skips the note sub-line when description is an empty string", async () => {
        // Whitespace-only description must be treated as "no note" so that
        // we don't waste vertical space rendering a blank secondary line.
        const emptyNote = baseData([
          {
            itemName: "Rice Basmati",
            description: "   ",
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "0",
            taxAmount: "0.00",
            discountPercent: "0",
            totalAmount: "1000.00",
          },
        ]);
        const noNote = baseData([
          {
            itemName: "Rice Basmati",
            description: null,
            quantity: "1",
            unitPrice: "1000.00",
            taxPercent: "0",
            taxAmount: "0.00",
            discountPercent: "0",
            totalAmount: "1000.00",
          },
        ]);

        const [bufEmpty, bufNone] = await Promise.all([
          renderToBuffer(emptyNote, format),
          renderToBuffer(noNote, format),
        ]);

        // Both paths must render as valid PDFs. The whitespace-only case
        // should not add a visible sub-line; this is a weaker assertion
        // than "bytes are equal" because PDFKit may stream output with
        // minor nondeterminism, so we only assert the difference is small.
        expect(bufEmpty.subarray(0, 5).toString("ascii")).toBe("%PDF-");
        expect(bufNone.subarray(0, 5).toString("ascii")).toBe("%PDF-");
        expect(Math.abs(bufEmpty.length - bufNone.length)).toBeLessThan(200);
      });
    });
  }
});

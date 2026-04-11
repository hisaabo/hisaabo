/**
 * Import adapter tests covering the Bug B schema split.
 *
 * The MyBillBook and Hisaabo CSV import adapters both used to write the
 * item name into the invoice line item's `description` column via a
 * fallback chain. After Bug B, the target is the new required `itemName`
 * column, and the optional `description` (notes) column stays NULL for
 * historical imports.
 *
 * These tests exercise the canonical transforms directly — no DB, no
 * tRPC caller, no fixtures — so they are fast and stable.
 */

import { describe, it, expect } from "vitest";
import { transformInvoice as transformMyBillBook } from "../routers/import/adapters/mybillbook/transforms.js";
import { transformInvoice as transformHisaabo } from "../routers/import/adapters/hisaabo/transforms.js";

describe("MyBillBook adapter — invoice line items map to itemName", () => {
  it("uses the CSV 'Item Name' column when present and leaves description NULL", () => {
    const raw = {
      invoiceNumber: "INV-001",
      partyName: "Acme Traders",
      invoiceDate: "2026-04-01",
      lineItems: [
        {
          itemName: "Basmati Rice",
          quantity: "10",
          unitPrice: "100.00",
          taxPercent: "5",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformMyBillBook(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems).toHaveLength(1);
    expect(canonical!.lineItems![0]!.itemName).toBe("Basmati Rice");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });

  it("falls back to the legacy 'Description' column when itemName is missing", () => {
    // Old-shape CSV from before the schema split had only a Description
    // column. The adapter must keep accepting those rows so users can
    // still import historical exports.
    const raw = {
      invoiceNumber: "INV-002",
      partyName: "Acme Traders",
      invoiceDate: "2026-04-01",
      lineItems: [
        {
          description: "Legacy-named Item",
          quantity: "1",
          unitPrice: "500.00",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformMyBillBook(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems![0]!.itemName).toBe("Legacy-named Item");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });

  it("falls back to a placeholder when both fields are missing", () => {
    const raw = {
      invoiceNumber: "INV-003",
      partyName: "Acme Traders",
      invoiceDate: "2026-04-01",
      lineItems: [
        {
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformMyBillBook(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems![0]!.itemName).toBe("Imported item");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });
});

describe("Hisaabo adapter — invoice line items map to itemName", () => {
  it("prefers itemName over legacy description", () => {
    const raw = {
      invoiceNumber: "INV-100",
      partyName: "Customer A",
      invoiceDate: "2026-04-01",
      type: "sale",
      lineItems: [
        {
          itemName: "Widget Pro",
          quantity: "2",
          unitPrice: "250.00",
          taxPercent: "18",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformHisaabo(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems![0]!.itemName).toBe("Widget Pro");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });

  it("accepts legacy Hisaabo exports that only had a description column", () => {
    const raw = {
      invoiceNumber: "INV-101",
      partyName: "Customer A",
      invoiceDate: "2026-04-01",
      type: "sale",
      lineItems: [
        {
          description: "Pre-split Widget",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformHisaabo(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems![0]!.itemName).toBe("Pre-split Widget");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });
});

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
    expect(canonical!.lineItems![0]!.unitPrice).toBe("100.00");
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
    expect(canonical!.lineItems![0]!.unitPrice).toBe("500.00");
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
    expect(canonical!.lineItems![0]!.unitPrice).toBe("250.00");
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
    expect(canonical!.lineItems![0]!.unitPrice).toBe("100.00");
    expect(canonical!.lineItems![0]!.description).toBeNull();
  });
});

// ── Bug A regression guard ──────────────────────────────────────
//
// The import pipeline must NOT auto-derive secondary unit prices from
// conversion factors. Derivation only happens in two places:
//   1. The ImportWizard's item-level unit conflict resolver
//      (ImportWizard.tsx — adjusts the ITEM's salePrice on its alt unit)
//   2. The items create/edit form (items.tsx — UnitVariantEditor)
//
// Invoice import faithfully preserves whatever unitPrice the CSV provides
// because the CSV is the source of truth for historical invoices. The
// recorded price may have been negotiated, discounted, or rounded — it
// must never be recalculated from basePrice × CF.
//
// See also: packages/api/src/routers/import/engine/invoices.ts line ~134
// where `li.unitPrice` is passed through unchanged to the DB insert.

describe("Invoice import preserves CSV unitPrice — Bug A regression guard", () => {
  it("MyBillBook: unitPrice from CSV is passed through, not derived from CF", () => {
    // Setup: an item priced at ₹100/kg with CF=0.2 (1 packet = 0.2 kg).
    // Derivation would produce ₹20.00. But the CSV records ₹25.00 — a
    // negotiated bulk price that must be preserved exactly.
    const raw = {
      invoiceNumber: "INV-PRICE-01",
      partyName: "Test Customer",
      invoiceDate: "2026-04-01",
      lineItems: [
        {
          itemName: "Rice Basmati",
          quantity: "3",
          unitPrice: "25.00",
          unit: "packet",
          conversionFactor: "0.2",
          taxPercent: "5",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformMyBillBook(raw);
    expect(canonical).not.toBeNull();
    // The critical assertion: unitPrice is the CSV value, not basePrice × CF
    expect(canonical!.lineItems![0]!.unitPrice).toBe("25.00");
    // Conversion factor is passed through for stock arithmetic, not price derivation
    expect(canonical!.lineItems![0]!.conversionFactor).toBe("0.2");
  });

  it("Hisaabo: unitPrice from CSV is passed through, not derived from CF", () => {
    const raw = {
      invoiceNumber: "INV-PRICE-02",
      partyName: "Test Customer",
      invoiceDate: "2026-04-01",
      type: "sale",
      lineItems: [
        {
          itemName: "Rice Basmati",
          quantity: "3",
          unitPrice: "25.00",
          unit: "packet",
          conversionFactor: "0.2",
          taxPercent: "5",
          discountPercent: "0",
        },
      ],
    };

    const canonical = transformHisaabo(raw);
    expect(canonical).not.toBeNull();
    expect(canonical!.lineItems![0]!.unitPrice).toBe("25.00");
    expect(canonical!.lineItems![0]!.conversionFactor).toBe("0.2");
  });
});

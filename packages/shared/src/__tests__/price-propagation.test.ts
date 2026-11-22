import { describe, it, expect } from "vitest";
import {
  convertPriceBasis,
  priceUpdateKey,
  proposalToUpdate,
  proposePriceUpdates,
  propagateBillPrices,
  supportsPricePropagation,
  updatePricesFromDocumentSchema,
  type PricePropagationClient,
  type PricingCatalogItem,
} from "../index.js";

const rice: PricingCatalogItem = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Basmati Rice",
  unit: "kg",
  itemMode: "alt_units",
  salePrice: "90.00",
  purchasePrice: "70.00",
  taxInclusive: false,
  unitVariants: [{ unit: "5 kg", conversionFactor: 5, salePrice: "450.00", purchasePrice: null }],
};

const ghee: PricingCatalogItem = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Ghee 1L",
  unit: "pcs",
  itemMode: "simple",
  salePrice: "620.00",
  purchasePrice: "540.00",
  taxInclusive: true,
};

const tee: PricingCatalogItem = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Tee",
  unit: "pcs",
  itemMode: "variants",
  salePrice: null,
  variants: [
    { id: "44444444-4444-4444-8444-444444444444", attributeValues: { Size: "M", Colour: "Red" }, salePrice: "300.00", purchasePrice: null },
  ],
};

const items = [rice, ghee, tee];

describe("supportsPricePropagation", () => {
  it("offers the prompt on invoices only", () => {
    expect(supportsPricePropagation("invoice")).toBe(true);
    for (const t of ["quotation", "proforma", "delivery_challan", "credit_note", "debit_note", "sales_return", "purchase_return", "", null, undefined]) {
      expect(supportsPricePropagation(t as string)).toBe(false);
    }
  });
});

describe("proposePriceUpdates", () => {
  it("proposes the new sale price for an edited base-unit rate", () => {
    const { proposals, skipped } = proposePriceUpdates({
      side: "sale",
      items,
      lines: [{ itemId: ghee.id, unitPrice: "600", originalUnitPrice: "620.00" }],
    });
    expect(skipped).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      itemId: ghee.id,
      side: "sale",
      label: "Ghee 1L",
      oldPrice: "620.00",
      newPrice: "600.00",
      // the item stores its prices GST-inclusive: the proposal says so
      priceIncludesTax: true,
    });
  });

  it("uses the purchase price on the purchase side", () => {
    const { proposals } = proposePriceUpdates({
      side: "purchase",
      items,
      lines: [{ itemId: ghee.id, unitPrice: "560", originalUnitPrice: "540" }],
    });
    expect(proposals[0]).toMatchObject({ side: "purchase", oldPrice: "540.00", newPrice: "560.00" });
  });

  it("ignores a rate the user did not edit, even if the catalog moved on since", () => {
    // an old bill at 600 opened after the catalog price became 620: untouched
    const { proposals } = proposePriceUpdates({
      side: "sale",
      items,
      lines: [{ itemId: ghee.id, unitPrice: "600", originalUnitPrice: "600" }],
    });
    expect(proposals).toEqual([]);
  });

  it("ignores a rate edited back to what it was, and a rate equal to the stored price", () => {
    const { proposals } = proposePriceUpdates({
      side: "sale",
      items,
      lines: [
        { itemId: ghee.id, unitPrice: "620.00", originalUnitPrice: "600" },
        { itemId: rice.id, unitPrice: "90", originalUnitPrice: "95" },
      ],
    });
    expect(proposals).toEqual([]);
  });

  it("ignores free-text lines, unknown items, empty and zero rates", () => {
    const { proposals, skipped } = proposePriceUpdates({
      side: "sale",
      items,
      lines: [
        { unitPrice: "10" },
        { itemId: "99999999-9999-4999-8999-999999999999", unitPrice: "10" },
        { itemId: ghee.id, unitPrice: "", originalUnitPrice: "620" },
        { itemId: ghee.id, unitPrice: "0", originalUnitPrice: "620" },
        { itemId: ghee.id, unitPrice: "12.345", originalUnitPrice: "620" },
      ],
    });
    expect(proposals).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("with no baseline (CLI / MCP) every linked line whose rate differs counts as edited", () => {
    const { proposals } = proposePriceUpdates({
      side: "sale",
      items,
      lines: [
        { itemId: ghee.id, unitPrice: "600" },
        { itemId: rice.id, unitPrice: "90" },
      ],
    });
    expect(proposals.map((p) => p.itemId)).toEqual([ghee.id]);
  });

  describe("line-level discount", () => {
    it("never counts: a discounted line with an untouched rate proposes nothing", () => {
      const { proposals } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: ghee.id, unitPrice: "620", originalUnitPrice: "620", discountPercent: "10" } as never],
      });
      expect(proposals).toEqual([]);
    });

    it("proposes the RATE, not the discounted net, when the rate field itself changed", () => {
      const { proposals } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: ghee.id, unitPrice: "700", originalUnitPrice: "620", discountPercent: "10" } as never],
      });
      expect(proposals[0].newPrice).toBe("700.00"); // not 630.00
    });
  });

  describe("alternate units", () => {
    it("updates the alternate unit's own price and labels it with the unit", () => {
      const { proposals } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: rice.id, selectedUnit: "5 kg", conversionFactor: "5", unitPrice: "480", originalUnitPrice: "450" }],
      });
      expect(proposals).toHaveLength(1);
      expect(proposals[0]).toMatchObject({ unit: "5 kg", label: "Basmati Rice (5 kg)", oldPrice: "450.00", newPrice: "480.00" });
      expect(proposalToUpdate(proposals[0])).toEqual({
        itemId: rice.id,
        unit: "5 kg",
        side: "sale",
        newPrice: "480.00",
        priceIncludesTax: false,
      });
    });

    it("compares a base-unit line with the base price, not the pack price", () => {
      const { proposals } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: rice.id, unitPrice: "96", originalUnitPrice: "90", conversionFactor: "1" }],
      });
      expect(proposals[0]).toMatchObject({ oldPrice: "90.00", newPrice: "96.00" });
      expect(proposals[0].unit).toBeUndefined();
    });

    it("proposes a first price (old = null) for an alternate unit with no purchase price yet", () => {
      const { proposals } = proposePriceUpdates({
        side: "purchase",
        items,
        lines: [{ itemId: rice.id, selectedUnit: "5 kg", conversionFactor: "5", unitPrice: "330", originalUnitPrice: "450" }],
      });
      expect(proposals[0]).toMatchObject({ unit: "5 kg", oldPrice: null, newPrice: "330.00" });
    });

    it("skips, with a note, a unit the item no longer has", () => {
      const { proposals, skipped } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: rice.id, selectedUnit: "10 kg", conversionFactor: "10", unitPrice: "900", originalUnitPrice: "850" }],
      });
      expect(proposals).toEqual([]);
      expect(skipped).toEqual([{ itemName: "Basmati Rice (10 kg)", reason: expect.stringContaining("no longer one of this item's units") }]);
    });

    it("skips a line whose conversion no longer matches the unit (base unit switched since)", () => {
      const { proposals, skipped } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: rice.id, selectedUnit: "5 kg", conversionFactor: "4", unitPrice: "480", originalUnitPrice: "450" }],
      });
      expect(proposals).toEqual([]);
      expect(skipped[0].reason).toMatch(/conversion changed/);
    });

    it("skips a base-unit line carrying a foreign conversion factor", () => {
      const { proposals, skipped } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: rice.id, conversionFactor: "5", unitPrice: "480", originalUnitPrice: "450" }],
      });
      expect(proposals).toEqual([]);
      expect(skipped).toHaveLength(1);
    });
  });

  describe("product variants", () => {
    it("updates the variant's price", () => {
      const { proposals } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: tee.id, variantId: tee.variants![0].id, unitPrice: "320", originalUnitPrice: "300" }],
      });
      expect(proposals[0]).toMatchObject({ variantId: tee.variants![0].id, label: "Tee (M / Red)", oldPrice: "300.00", newPrice: "320.00" });
    });

    it("skips a variant item billed without a chosen variant", () => {
      const { proposals, skipped } = proposePriceUpdates({
        side: "sale",
        items,
        lines: [{ itemId: tee.id, unitPrice: "320" }],
      });
      expect(proposals).toEqual([]);
      expect(skipped[0].reason).toMatch(/no variant is selected/);
    });
  });

  it("collapses repeated lines at the same rate and skips conflicting ones", () => {
    const same = proposePriceUpdates({
      side: "sale",
      items,
      lines: [
        { itemId: ghee.id, unitPrice: "600" },
        { itemId: ghee.id, unitPrice: "600.00" },
      ],
    });
    expect(same.proposals).toHaveLength(1);

    const conflict = proposePriceUpdates({
      side: "sale",
      items,
      lines: [
        { itemId: ghee.id, unitPrice: "600" },
        { itemId: ghee.id, unitPrice: "610" },
      ],
    });
    expect(conflict.proposals).toEqual([]);
    expect(conflict.skipped[0].reason).toMatch(/different prices/);
  });

  it("keys proposals per slot and side", () => {
    expect(priceUpdateKey({ itemId: "a", side: "sale" })).not.toBe(priceUpdateKey({ itemId: "a", side: "purchase" }));
    expect(priceUpdateKey({ itemId: "a", unit: "5 kg", side: "sale" })).not.toBe(priceUpdateKey({ itemId: "a", side: "sale" }));
  });
});

describe("convertPriceBasis", () => {
  it("converts between tax-inclusive and tax-exclusive prices at the item's rate", () => {
    expect(convertPriceBasis("1180", "18", true)).toBe("1000.00");
    expect(convertPriceBasis("1000", "18", false)).toBe("1180.00");
    expect(convertPriceBasis("100", "0", true)).toBe("100.00");
  });
});

describe("propagateBillPrices (CLI / MCP)", () => {
  const applied = { updated: [{ label: "Ghee 1L", side: "sale" as const, oldPrice: "620.00", newPrice: "600.00" }], unchanged: [] };

  function fakeClient(over: Partial<PricePropagationClient> = {}) {
    const calls: Array<Parameters<PricePropagationClient["applyUpdates"]>[0]> = [];
    const client: PricePropagationClient = {
      getItem: async (id) => items.find((i) => i.id === id) ?? null,
      applyUpdates: async (input) => {
        calls.push(input);
        return applied;
      },
      ...over,
    };
    return { client, calls };
  }

  it("updates the items whose rate differs and names the bill it came from", async () => {
    const { client, calls } = fakeClient();
    const out = await propagateBillPrices({
      client, documentType: "invoice", side: "sale", documentId: "inv-1",
      lines: [{ itemId: ghee.id, unitPrice: "600" }, { itemId: rice.id, unitPrice: "90" }],
    });
    expect(out.status).toBe("updated");
    expect(out.updated).toEqual(applied.updated);
    expect(calls).toEqual([{
      documentId: "inv-1",
      updates: [{ itemId: ghee.id, side: "sale", newPrice: "600.00", priceIncludesTax: true }],
    }]);
  });

  it("does nothing, and calls nothing, when every rate equals the saved price", async () => {
    const { client, calls } = fakeClient();
    const out = await propagateBillPrices({
      client, documentType: "invoice", side: "sale", documentId: "inv-1",
      lines: [{ itemId: ghee.id, unitPrice: "620" }, { unitPrice: "5" }],
    });
    expect(out.status).toBe("nothing_to_update");
    expect(calls).toEqual([]);
  });

  it("is not applicable to quotations, notes and returns", async () => {
    const { client, calls } = fakeClient();
    for (const documentType of ["quotation", "credit_note", "sales_return"]) {
      const out = await propagateBillPrices({ client, documentType, side: "sale", documentId: "d", lines: [{ itemId: ghee.id, unitPrice: "1" }] });
      expect(out.status).toBe("not_applicable");
      expect(out.message).toMatch(/invoices only/);
    }
    expect(calls).toEqual([]);
  });

  it("never throws: a refused or failing update is reported, the bill stands", async () => {
    const { client } = fakeClient({ applyUpdates: async () => { throw new Error("You do not have permission to update items"); } });
    const out = await propagateBillPrices({
      client, documentType: "invoice", side: "sale", documentId: "inv-1", lines: [{ itemId: ghee.id, unitPrice: "600" }],
    });
    expect(out.status).toBe("failed");
    expect(out.message).toMatch(/bill was saved, but item prices were not updated: You do not have permission/);

    const broken = fakeClient({ getItem: async () => { throw new Error("network down"); } });
    const out2 = await propagateBillPrices({
      client: broken.client, documentType: "invoice", side: "sale", documentId: "inv-1", lines: [{ itemId: ghee.id, unitPrice: "600" }],
    });
    expect(out2.status).toBe("failed");
  });

  it("reports lines it could not offer", async () => {
    const { client } = fakeClient({ applyUpdates: async () => ({ updated: [], unchanged: [] }) });
    const out = await propagateBillPrices({
      client, documentType: "invoice", side: "sale", documentId: "inv-1", lines: [{ itemId: tee.id, unitPrice: "320" }],
    });
    expect(out.status).toBe("nothing_to_update");
    expect(out.skipped[0]!.reason).toMatch(/no variant is selected/);
  });
});

describe("updatePricesFromDocumentSchema", () => {
  const itemId = "11111111-1111-4111-8111-111111111111";
  it("accepts a base, a unit and a variant update", () => {
    const parsed = updatePricesFromDocumentSchema.safeParse({
      updates: [
        { itemId, side: "sale", newPrice: "10.50" },
        { itemId, unit: "5 kg", side: "purchase", newPrice: "50" },
        { itemId, variantId: "44444444-4444-4444-8444-444444444444", side: "sale", newPrice: "9", priceIncludesTax: true },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty list, a bad price, a bad side and a variant plus unit", () => {
    for (const bad of [
      { updates: [] },
      { updates: [{ itemId, side: "sale", newPrice: "1.234" }] },
      { updates: [{ itemId, side: "sale", newPrice: "-1" }] },
      { updates: [{ itemId, side: "both", newPrice: "1" }] },
      { updates: [{ itemId, variantId: "44444444-4444-4444-8444-444444444444", unit: "5 kg", side: "sale", newPrice: "1" }] },
    ]) {
      expect(updatePricesFromDocumentSchema.safeParse(bad).success).toBe(false);
    }
  });
});

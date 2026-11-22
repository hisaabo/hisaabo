import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { registerWith, callTool, recordingClient, writeAdmin, UUID } from "./helpers.js";

/**
 * invoice_create / invoice_update `update_item_prices`: after the invoice is
 * saved, also update the saved price of every linked item whose unit_price
 * differs. A second, independent write: the invoice is saved either way and the
 * outcome rides along as `itemPriceUpdate`.
 */

const ITEM = "22222222-2222-4222-8222-222222222222";
const ghee = {
  id: ITEM, name: "Ghee 1L", unit: "pcs", itemMode: "simple", salePrice: "620.00", purchasePrice: "540.00",
  taxPercent: "18.00", taxInclusive: false, unitVariants: [], variants: [],
};
const saved = { id: "inv-1", invoiceNumber: "INV-00001", documentType: "invoice", type: "sale", totalAmount: "600.00" };
const applied = { documentId: "inv-1", updated: [{ itemId: ITEM, side: "sale", label: "Ghee 1L", oldPrice: "620.00", newPrice: "600.00" }], unchanged: [] };

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function setup(overrides: Record<string, unknown> = {}, errors: Record<string, { code: string; message: string }> = {}) {
  const rec = recordingClient((path) => ({
    "invoice.create": saved,
    "invoice.update": saved,
    "item.getById": ghee,
    "item.updatePricesFromDocument": applied,
    ...overrides,
  })[path] ?? {}, errors);
  restore = rec.restore;
  const { tools } = registerWith(writeAdmin, rec.client);
  return { ...rec, tools };
}

const paths = (calls: Array<{ url: URL }>) => calls.map((c) => c.url.pathname.replace("/api/trpc/", ""));
const line = { description: "Ghee 1L", quantity: "1", unit_price: "600.00", item_id: ITEM, tax_percent: "18.00" };
/** Tool results are fenced: {notice, untrusted, data}. */
const baseInput = (name: string) =>
  name === "invoice_create"
    ? { party_id: UUID, type: "sale", line_items: [line], confirm: true }
    : { invoice_id: UUID, confirm: true };
const parse = (res: { content: Array<{ type: string; text?: string }> }) => JSON.parse(res.content[0]!.text!).data;

describe("invoice_create update_item_prices", () => {
  it("is an optional boolean that says what it does", () => {
    const { tools } = setup();
    for (const name of ["invoice_create", "invoice_update"]) {
      const shape = tools.get(name)!.shape;
      expect(Object.keys(shape), name).toContain("update_item_prices");
      // omitting it is valid: it defaults to "no"
      expect(z.object(shape).safeParse(baseInput(name)).success, name).toBe(true);
    }
  });

  it("saves the invoice, then updates the price from that invoice and reports it", async () => {
    const { tools, calls } = setup();
    const res = parse(await callTool(tools.get("invoice_create")!, { party_id: UUID, type: "sale", line_items: [line], update_item_prices: true }));

    const order = paths(calls);
    expect(order.indexOf("invoice.create")).toBeLessThan(order.indexOf("item.updatePricesFromDocument"));
    expect(calls.find((c) => c.url.pathname.endsWith("item.updatePricesFromDocument"))!.body).toEqual({
      documentId: "inv-1",
      updates: [{ itemId: ITEM, side: "sale", newPrice: "600.00", priceIncludesTax: false }],
    });
    expect(res.invoiceNumber).toBe("INV-00001");
    expect(res.itemPriceUpdate).toMatchObject({ status: "updated", updated: [{ newPrice: "600.00" }] });
  });

  it("does nothing to the catalog without the flag, and the result is the bare invoice", async () => {
    const { tools, calls } = setup();
    const res = parse(await callTool(tools.get("invoice_create")!, { party_id: UUID, type: "sale", line_items: [line] }));
    expect(paths(calls)).not.toContain("item.updatePricesFromDocument");
    expect(res.itemPriceUpdate).toBeUndefined();
  });

  it("a purchase bill updates the purchase price", async () => {
    const { tools, calls } = setup({ "invoice.create": { ...saved, type: "purchase" } });
    await callTool(tools.get("invoice_create")!, { party_id: UUID, type: "purchase", line_items: [{ ...line, unit_price: "560.00" }], update_item_prices: true });
    const body = calls.find((c) => c.url.pathname.endsWith("item.updatePricesFromDocument"))!.body as { updates: Array<{ side: string }> };
    expect(body.updates[0]!.side).toBe("purchase");
  });

  it("is not applicable to a quotation: no price call, and it says why", async () => {
    const { tools, calls } = setup({ "invoice.create": { ...saved, documentType: "quotation" } });
    const res = parse(await callTool(tools.get("invoice_create")!, {
      party_id: UUID, type: "sale", document_type: "quotation", line_items: [line], update_item_prices: true,
    }));
    expect(paths(calls)).not.toContain("item.updatePricesFromDocument");
    expect(res.itemPriceUpdate.status).toBe("not_applicable");
  });

  it("a refused or failing price update is reported; the invoice is still returned", async () => {
    const { tools } = setup({}, { "item.updatePricesFromDocument": { code: "FORBIDDEN", message: "You do not have permission to update items" } });
    const res = parse(await callTool(tools.get("invoice_create")!, { party_id: UUID, type: "sale", line_items: [line], update_item_prices: true }));
    expect(res.invoiceNumber).toBe("INV-00001");
    expect(res.itemPriceUpdate.status).toBe("failed");
    expect(res.itemPriceUpdate.message).toMatch(/bill was saved, but item prices were not updated/);
  });
});

describe("invoice_update update_item_prices", () => {
  it("compares the new line_items with the saved prices, after the update", async () => {
    const { tools, calls } = setup();
    const res = parse(await callTool(tools.get("invoice_update")!, {
      invoice_id: UUID, line_items: [line], update_item_prices: true, confirm: true,
    }));
    const order = paths(calls);
    expect(order.indexOf("invoice.update")).toBeLessThan(order.indexOf("item.updatePricesFromDocument"));
    expect(res.itemPriceUpdate.status).toBe("updated");
  });

  it("without line_items there is nothing to compare: not applicable, and no price call", async () => {
    const { tools, calls } = setup();
    const res = parse(await callTool(tools.get("invoice_update")!, {
      invoice_id: UUID, notes: "x", update_item_prices: true, confirm: true,
    }));
    expect(paths(calls)).not.toContain("item.updatePricesFromDocument");
    expect(res.itemPriceUpdate.status).toBe("not_applicable");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import {
  createInvoiceSchema,
  createPaymentSchema,
  createRecurringInvoiceSchema,
  invoiceLineItemSchema,
  invoiceStatuses,
  paymentModes,
} from "@hisaabo/shared";
import { registerWith, callTool, recordingClient, writeAdmin, UUID } from "./helpers.js";

const BIZ = "00000000-0000-4000-8000-000000000002";

let restore: (() => void) | undefined;
afterEach(() => restore?.());

function setup(respond?: (path: string) => unknown) {
  const rec = recordingClient(respond);
  restore = rec.restore;
  const { tools } = registerWith(writeAdmin, rec.client);
  return { ...rec, tools };
}

const lineItem = { description: "Web Design", quantity: "1.000", unit_price: "15000.00" };

/** invoice.update's router input (packages/api/src/routers/invoice.ts): flat id + fields. */
const updateInvoiceInput = z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000).optional().nullable(),
  invoiceDate: z.string().datetime().optional(),
  lineItems: z.array(invoiceLineItemSchema).min(1).optional(),
}).passthrough();

describe("contract: payloads parse against the shared server schemas", () => {
  it("invoice_create maps description -> itemName and omits unset tax", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("invoice_create")!, { party_id: UUID, type: "sale", line_items: [lineItem] });
    const payload = calls[0].body as { lineItems: Array<Record<string, unknown>> };
    expect(createInvoiceSchema.safeParse(payload).success).toBe(true);
    expect(payload.lineItems[0]).toMatchObject({ itemName: "Web Design", unitPrice: "15000.00" });
    expect(payload.lineItems[0]).not.toHaveProperty("description");
    expect(payload.lineItems[0]).not.toHaveProperty("taxPercent");
  });

  it("invoice_create resolves tax from the linked item when not given", async () => {
    const { tools, calls } = setup((path) => (path === "item.getById" ? { id: UUID, taxPercent: "18.00" } : {}));
    await callTool(tools.get("invoice_create")!, {
      party_id: UUID, type: "sale", line_items: [{ ...lineItem, item_id: UUID }, { ...lineItem, item_id: UUID, tax_percent: "5.00" }],
    });
    const payload = calls.find((c) => c.url.pathname.endsWith("invoice.create"))!.body as { lineItems: Array<{ taxPercent: string }> };
    expect(payload.lineItems.map((l) => l.taxPercent)).toEqual(["18.00", "5.00"]);
    expect(createInvoiceSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects a billed name over 200 chars (server limit)", async () => {
    const { tools } = setup();
    await expect(callTool(tools.get("invoice_create")!, {
      party_id: UUID, type: "sale", line_items: [{ ...lineItem, description: "x".repeat(201) }],
    })).rejects.toThrow();
  });

  it("invoice_update sends a flat {id, ...fields} payload", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("invoice_update")!, { invoice_id: UUID, notes: "hi", line_items: [lineItem], confirm: true });
    const payload = calls[0].body as Record<string, unknown>;
    expect(payload).not.toHaveProperty("data");
    expect(updateInvoiceInput.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ id: UUID, notes: "hi" });
  });

  it("quotation_create line items satisfy the shared schema", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("quotation_create")!, { party_id: UUID, type: "sale", line_items: [lineItem] });
    expect(createInvoiceSchema.safeParse(calls[0].body).success).toBe(true);
  });

  it("automated_invoice_create sends itemName line items", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("automated_invoice_create")!, {
      party_id: UUID, name: "Hosting", type: "sale", frequency: "monthly",
      line_items: [lineItem], start_date: "2026-01-01T00:00:00.000Z",
    });
    const res = createRecurringInvoiceSchema.safeParse(calls[0].body);
    expect(res.success).toBe(true);
  });

  it("payment_create accepts every server payment mode", async () => {
    const { tools, calls } = setup();
    for (const mode of paymentModes) {
      await callTool(tools.get("payment_create")!, { party_id: UUID, amount: "10.00", mode });
    }
    expect(calls.length).toBe(paymentModes.length);
    for (const c of calls) expect(createPaymentSchema.safeParse(c.body).success).toBe(true);
  });

  it("invoice_update_status accepts 'adjusted'", () => {
    const { tools } = setup();
    const shape = z.object(tools.get("invoice_update_status")!.shape);
    for (const status of invoiceStatuses) {
      expect(shape.safeParse({ invoice_id: UUID, status, confirm: true }).success).toBe(true);
    }
  });

  it("item_adjust_stock sends `quantity` without a leading '+'", async () => {
    const { tools, calls } = setup();
    await callTool(tools.get("item_adjust_stock")!, { item_id: UUID, adjustment: "+50", reason: "received" });
    const payload = calls[0].body as Record<string, unknown>;
    // packages/api/src/routers/item.ts adjustStock input
    const serverInput = z.object({
      itemId: z.string().uuid(),
      quantity: z.string().regex(/^-?\d+(\.\d{1,3})?$/),
      reason: z.string().max(500).optional(),
    }).strict();
    expect(serverInput.safeParse(payload).success).toBe(true);
    expect(payload.quantity).toBe("50");
  });

  it("item_categories no longer exists (no such API procedure)", () => {
    const { tools } = setup();
    expect(tools.has("item_categories")).toBe(false);
  });

  it("business.get resolves the configured business id", async () => {
    const { client, calls } = setup();
    await client.business.get();
    expect(calls[0].url.pathname).toMatch(/business\.getById$/);
    const input = JSON.parse(calls[0].url.searchParams.get("input")!);
    expect(input.json).toEqual({ id: BIZ });
  });
});

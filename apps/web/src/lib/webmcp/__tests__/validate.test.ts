/**
 * Input a write tool can already tell is unusable is refused BEFORE the user is
 * asked. A prompt for something certain to fail teaches people to click Allow
 * without reading, and spends the agent's budget and rate allowance for nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildBrowserTool, resetWriteThrottle } from "../runtime";
import { resetWriteBudget, writesUsed } from "../budget";
import { webMcpTools } from "../tools";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const UUID = "3f1c2b90-4d2e-4a1b-9c77-0b2e9d5a1f44";
const writes = webMcpTools.filter((t) => !t.annotations.readOnlyHint);

function tool(name: string): WebMcpToolDefinition {
  return webMcpTools.find((t) => t.name === name)!;
}

function ctx(role = "owner"): WebMcpToolContext {
  return {
    client: {} as WebMcpToolContext["client"],
    signal: new AbortController().signal,
    activeBusinessId: () => "biz-1",
    role,
    businessId: "biz-1",
    businessName: "Acme",
    invalidate: vi.fn(),
  } as unknown as WebMcpToolContext;
}

const opts = () => ({ signal: new AbortController().signal });

beforeEach(() => {
  resetWriteBudget();
  resetWriteThrottle();
});
afterEach(() => vi.restoreAllMocks());

describe("every write tool validates before anything else", () => {
  it("defines validate on all six write tools", () => {
    expect(writes).toHaveLength(6);
    for (const t of writes) expect(t.validate, t.name).toBeTypeOf("function");
  });

  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ["invoice_create", {}, /partyId is required/],
    ["invoice_create", { partyId: UUID, type: "refund" }, /type must be/],
    ["invoice_create", { partyId: UUID, type: "sale", lineItems: [] }, /line item/i],
    ["invoice_update_status", {}, /invoiceId is required/],
    ["invoice_update_status", { invoiceId: UUID, status: "cancelled" }, /not available to browser agents/],
    ["invoice_update_status", { invoiceId: UUID, status: "void" }, /status must be one of/],
    ["party_create", { name: "A" }, /type must be/],
    ["party_create", { type: "customer" }, /name is required/],
    ["item_create", {}, /name is required/],
    ["payment_create", { amount: "1.00", mode: "cash" }, /partyId is required/],
    ["payment_create", { partyId: UUID, mode: "cash" }, /amount is required/],
    ["payment_create", { partyId: UUID, amount: "1.00", mode: "barter" }, /mode must be one of/],
    ["expense_create", { amount: "1.00", mode: "cash" }, /category is required/],
    ["expense_create", { category: "Rent", mode: "cash" }, /amount is required/],
    ["expense_create", { category: "Rent", amount: "1.00" }, /mode must be one of/],
  ];

  it.each(invalid)("%s rejects %j", (name, input, message) => {
    expect(() => tool(name).validate!(input, ctx())).toThrow(message);
  });

  it("accepts a well-formed input for each", () => {
    const good: Record<string, Record<string, unknown>> = {
      invoice_create: { partyId: UUID, type: "sale", lineItems: [{ itemName: "A", quantity: "1", unitPrice: "1.00" }] },
      invoice_update_status: { invoiceId: UUID, status: "sent" },
      party_create: { type: "customer", name: "Acme" },
      item_create: { name: "Cement" },
      payment_create: { partyId: UUID, amount: "5.00", mode: "upi" },
      expense_create: { category: "Rent", amount: "5.00", mode: "bank" },
    };
    for (const [name, input] of Object.entries(good)) expect(() => tool(name).validate!(input, ctx()), name).not.toThrow();
  });

  it("knows a seller may not record a purchase", () => {
    expect(() =>
      tool("invoice_create").validate!(
        { partyId: UUID, type: "purchase", lineItems: [{ itemName: "A", quantity: "1", unitPrice: "1.00" }] },
        ctx("seller"),
      ),
    ).toThrow();
  });

  it("execute still refuses the same input when called directly", async () => {
    await expect(tool("party_create").execute({ type: "customer" }, ctx())).rejects.toThrow(/name is required/);
    await expect(
      tool("invoice_update_status").execute({ invoiceId: UUID, status: "cancelled" }, ctx()),
    ).rejects.toThrow(/not available to browser agents/);
  });
});

describe("the runtime asks nobody, and spends nothing, for unusable input", () => {
  it("returns the error without a prompt, a budget write or a rate token", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const browserTool = buildBrowserTool(tool("invoice_update_status"), ctx());

    for (let i = 0; i < 30; i++) {
      const result = (await browserTool.execute({ invoiceId: UUID, status: "cancelled" }, opts())) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/not available to browser agents/);
    }

    expect(confirm).not.toHaveBeenCalled();
    expect(writesUsed()).toBe(0);
    // Thirty refusals later the per-minute allowance is untouched: a valid write still goes through.
    const client = { invoice: { updateStatus: { mutate: vi.fn().mockResolvedValue({ id: UUID, status: "sent" }) } } };
    const good = buildBrowserTool(tool("invoice_update_status"), {
      ...ctx(),
      client: client as unknown as WebMcpToolContext["client"],
    });
    confirm.mockReturnValue(true);
    const ok = (await good.execute({ invoiceId: UUID, status: "sent" }, opts())) as { isError?: boolean };
    expect(ok.isError).toBeFalsy();
    expect(client.invoice.updateStatus.mutate).toHaveBeenCalledWith({ id: UUID, status: "sent" });
  });

  it("does not run validate for reads", async () => {
    const validate = vi.fn();
    const read: WebMcpToolDefinition = {
      name: "party_list",
      description: "d",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      validate,
      execute: async () => [],
    };
    await buildBrowserTool(read, ctx()).execute({}, opts());
    expect(validate).not.toHaveBeenCalled();
  });
});

/**
 * Idempotency is opt-in, and only the agent opts in.
 *
 * An earlier design derived a key from the request, which silently swallowed
 * legitimate repeats: two identical cash sales within 15 minutes, both approved by
 * the user, booked once. Now a write tool sends an idempotencyKey ONLY when the agent
 * passes one, and a replay is reported as a replay (and costs no write budget).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildBrowserTool, resetWriteThrottle } from "../runtime";
import { resetWriteBudget, writesUsed } from "../budget";
import { webMcpTools } from "../tools";
import { REPLAY_NOTICE, describeCreateResult } from "../tools/shared";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const UUID = "3f1c2b90-4d2e-4a1b-9c77-0b2e9d5a1f44";
const opts = () => ({ signal: new AbortController().signal });
const KEY = "attempt-7f3a-0001";

function tool(name: string): WebMcpToolDefinition {
  return webMcpTools.find((t) => t.name === name)!;
}

function makeCtx(client: Record<string, unknown>): WebMcpToolContext {
  return {
    client: client as unknown as WebMcpToolContext["client"],
    signal: new AbortController().signal,
    activeBusinessId: () => "biz-1",
    role: "owner",
    businessId: "biz-1",
    businessName: "Acme",
    invalidate: vi.fn(),
  } as unknown as WebMcpToolContext;
}

const invoiceInput = {
  partyId: UUID,
  type: "sale",
  lineItems: [{ itemName: "Cash sale", quantity: "1", unitPrice: "100.00", taxPercent: "0" }],
};
const paymentInput = { partyId: UUID, amount: "100.00", mode: "cash" };

beforeEach(() => {
  resetWriteBudget();
  resetWriteThrottle();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("no key unless the agent passes one", () => {
  it("invoice_create sends no idempotencyKey of its own, so two identical sales are two sales", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "inv-1" });
    const ctx = makeCtx({ invoice: { create: { mutate } } });
    await tool("invoice_create").execute(invoiceInput, ctx);
    await tool("invoice_create").execute(invoiceInput, ctx);
    expect(mutate).toHaveBeenCalledTimes(2);
    for (const [arg] of mutate.mock.calls) expect(arg.idempotencyKey).toBeUndefined();
  });

  it("payment_create sends no idempotencyKey of its own either", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "pay-1" });
    const ctx = makeCtx({ payment: { create: { mutate } } });
    await tool("payment_create").execute(paymentInput, ctx);
    await tool("payment_create").execute(paymentInput, ctx);
    for (const [arg] of mutate.mock.calls) expect(arg.idempotencyKey).toBeUndefined();
  });

  it("passes the agent's own key through unchanged", async () => {
    const invoice = vi.fn().mockResolvedValue({ id: "inv-1" });
    const payment = vi.fn().mockResolvedValue({ id: "pay-1" });
    const ctx = makeCtx({ invoice: { create: { mutate: invoice } }, payment: { create: { mutate: payment } } });
    await tool("invoice_create").execute({ ...invoiceInput, idempotencyKey: KEY }, ctx);
    await tool("payment_create").execute({ ...paymentInput, idempotencyKey: KEY }, ctx);
    expect(invoice.mock.calls[0][0].idempotencyKey).toBe(KEY);
    expect(payment.mock.calls[0][0].idempotencyKey).toBe(KEY);
  });

  it("refuses a malformed key before asking the user, instead of silently dropping it", async () => {
    const confirm = vi.mocked(window.confirm);
    const mutate = vi.fn();
    const ctx = makeCtx({ invoice: { create: { mutate } } });
    for (const bad of ["short", "has spaces in it", "x".repeat(101), 12345678]) {
      const result = (await buildBrowserTool(tool("invoice_create"), ctx).execute(
        { ...invoiceInput, idempotencyKey: bad },
        opts(),
      )) as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error).toMatch(/idempotencyKey must be 8-100 characters/);
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("is declared on invoice_create and payment_create only, optional, and described as opt-in with fresh keys", () => {
    for (const t of webMcpTools) {
      const has = t.inputSchema.properties?.idempotencyKey !== undefined;
      expect(has, t.name).toBe(t.name === "invoice_create" || t.name === "payment_create");
    }
    for (const name of ["invoice_create", "payment_create"]) {
      const def = tool(name);
      expect(def.inputSchema.required).not.toContain("idempotencyKey");
      const prop = (def.inputSchema.properties!.idempotencyKey as { description: string }).description;
      expect(prop).toMatch(/FRESH key/);
      expect(prop).toMatch(/reuse that same key only to retry/i);
      expect(prop).toMatch(/Without it every call creates a record|strictly opt-in/);
      expect(def.description).toMatch(/fresh idempotencyKey/);
      expect(def.description).toMatch(/two identical (sales|payments) are two (invoices|payments)/);
      expect(def.description).not.toMatch(/Safe to retry|IDENTICAL call/);
    }
  });
});

describe("a replay is reported as one", () => {
  it("describeCreateResult says nothing new was created and carries the existing record", () => {
    const out = describeCreateResult({ id: "inv-1", invoiceNumber: "INV-1", idempotentReplay: true }) as Record<string, unknown>;
    expect(out).toEqual({
      idempotentReplay: true,
      notice: REPLAY_NOTICE,
      record: { id: "inv-1", invoiceNumber: "INV-1" },
    });
    expect(REPLAY_NOTICE).toBe(
      "No new record was created; this matches an earlier request with the same idempotencyKey. Pass a new key to create another.",
    );
  });

  it("leaves a normal create untouched, with or without the server's idempotentReplay:false", () => {
    expect(describeCreateResult({ id: "inv-1" })).toEqual({ id: "inv-1" });
    expect(describeCreateResult({ id: "inv-1", idempotentReplay: false })).toEqual({ id: "inv-1", idempotentReplay: false });
    expect(describeCreateResult("text")).toBe("text");
    expect(describeCreateResult(null)).toBeNull();
  });

  it("the agent reads the notice in the result of a replayed call", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "pay-1", paymentNumber: "PAY-1", idempotentReplay: true });
    const result = (await buildBrowserTool(tool("payment_create"), makeCtx({ payment: { create: { mutate } } })).execute(
      { ...paymentInput, idempotencyKey: KEY },
      opts(),
    )) as { content: Array<{ text: string }> };
    const body = JSON.parse(result.content[0].text);
    expect(body.data.idempotentReplay).toBe(true);
    expect(body.data.notice).toMatch(/No new record was created/);
    expect(body.data.record.paymentNumber).toBe("PAY-1");
  });

  it("a replay does not spend a write; a real create does", async () => {
    const replay = vi.fn().mockResolvedValue({ id: "inv-1", idempotentReplay: true });
    const created = vi.fn().mockResolvedValue({ id: "inv-2", idempotentReplay: false });
    await buildBrowserTool(tool("invoice_create"), makeCtx({ invoice: { create: { mutate: replay } } })).execute(
      { ...invoiceInput, idempotencyKey: KEY },
      opts(),
    );
    expect(writesUsed()).toBe(0);

    await buildBrowserTool(tool("invoice_create"), makeCtx({ invoice: { create: { mutate: created } } })).execute(
      { ...invoiceInput, idempotencyKey: "attempt-7f3a-0002" },
      opts(),
    );
    expect(writesUsed()).toBe(1);
  });

  it("a replay does not refresh the UI (nothing changed)", async () => {
    const mutate = vi.fn().mockResolvedValue({ id: "inv-1", idempotentReplay: true });
    const ctx = makeCtx({ invoice: { create: { mutate } } });
    await buildBrowserTool(tool("invoice_create"), ctx).execute({ ...invoiceInput, idempotencyKey: KEY }, opts());
    expect(ctx.invalidate).not.toHaveBeenCalled();
  });

  it("twenty replays never run the budget down", async () => {
    vi.useFakeTimers();
    try {
      const mutate = vi.fn().mockResolvedValue({ id: "inv-1", idempotentReplay: true });
      const built = buildBrowserTool(tool("invoice_create"), makeCtx({ invoice: { create: { mutate } } }));
      for (let i = 0; i < 25; i++) {
        const r = (await built.execute({ ...invoiceInput, idempotencyKey: KEY }, opts())) as { isError?: boolean };
        expect(r.isError).toBeFalsy();
        vi.advanceTimersByTime(7_000);
      }
      expect(writesUsed()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("two calls with the same explicit key reach the API twice, in order (the server recognises the replay)", async () => {
    const order: string[] = [];
    const server = new Map<string, string>();
    const mutate = vi.fn(async (input: { idempotencyKey?: string }) => {
      order.push("call");
      const key = input.idempotencyKey!;
      if (server.has(key)) return { id: server.get(key), idempotentReplay: true };
      server.set(key, `inv-${server.size + 1}`);
      return { id: server.get(key), idempotentReplay: false };
    });
    const ctx = makeCtx({ invoice: { create: { mutate } } });
    const [a, b] = (await Promise.all([
      buildBrowserTool(tool("invoice_create"), ctx).execute({ ...invoiceInput, idempotencyKey: KEY }, opts()),
      buildBrowserTool(tool("invoice_create"), ctx).execute({ ...invoiceInput, idempotencyKey: KEY }, opts()),
    ])) as Array<{ content: Array<{ text: string }> }>;
    expect(order).toEqual(["call", "call"]);
    expect(JSON.parse(a.content[0].text).data.id).toBe("inv-1");
    expect(JSON.parse(b.content[0].text).data.record.id).toBe("inv-1");
    expect(writesUsed()).toBe(1);
  });
});

/**
 * Rate limiting and double-submit protection on the browser side.
 *
 *   - a token bucket caps approved writes per minute and answers the agent in plain words
 *   - approved writes execute one at a time (the second waits for the first), which is
 *     what lets the server-side idempotency key catch a duplicated call
 *   - the write tools send an idempotency key that is stable for an identical request
 *   - the API's own 429 reaches the agent as a readable error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCClientError } from "@trpc/client";
import {
  TokenBucket,
  WRITE_LIMIT_PER_MINUTE,
  buildBrowserTool,
  resetWriteThrottle,
  toErrorResult,
} from "../runtime";
import { resetWriteBudget } from "../budget";
import { deriveIdempotencyKey, idempotencyKeyFor } from "../tools/shared";
import { webMcpTools } from "../tools";
import type { WebMcpToolContext, WebMcpToolDefinition } from "../types";

const opts = () => ({ signal: new AbortController().signal });
const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;

function ctx(): WebMcpToolContext {
  return {
    signal: new AbortController().signal,
    activeBusinessId: () => "biz-1",
    businessId: "biz-1",
    businessName: "Acme",
    invalidate: vi.fn(),
  } as unknown as WebMcpToolContext;
}

function writeDef(execute: WebMcpToolDefinition["execute"] = async () => ({ id: "1" })): WebMcpToolDefinition {
  return {
    name: "party_create",
    description: "d",
    inputSchema: { type: "object", properties: {} },
    annotations: { consequentialHint: true },
    execute,
  };
}

beforeEach(() => {
  resetWriteBudget();
  resetWriteThrottle();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TokenBucket", () => {
  it("starts full, empties, and refills continuously", () => {
    let now = 0;
    const bucket = new TokenBucket(10, () => now);
    for (let i = 0; i < 10; i++) expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
    expect(bucket.retryAfterMs()).toBe(6_000);

    now = 5_999;
    expect(bucket.tryTake()).toBe(false);
    now = 6_000;
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("never holds more than its capacity however long it idles", () => {
    let now = 0;
    const bucket = new TokenBucket(3, () => now);
    now = 10 * 60_000;
    let taken = 0;
    while (bucket.tryTake()) taken++;
    expect(taken).toBe(3);
  });

  it("retryAfterMs takes nothing", () => {
    const bucket = new TokenBucket(1, () => 0);
    expect(bucket.retryAfterMs()).toBe(0);
    expect(bucket.retryAfterMs()).toBe(0);
    expect(bucket.tryTake()).toBe(true);
  });
});

describe("write rate limit in the runtime", () => {
  it("allows 10 approved writes a minute, then answers with how long to wait, without prompting", async () => {
    vi.useFakeTimers();
    const confirm = vi.mocked(window.confirm);
    const execute = vi.fn(async () => ({ id: "1" }));
    const tool = buildBrowserTool(writeDef(execute), ctx());

    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) {
      expect(await tool.execute({ n: i }, opts())).not.toMatchObject({ isError: true });
    }
    const refused = await tool.execute({ n: 99 }, opts());

    expect(refused).toMatchObject({ isError: true });
    expect(text(refused)).toMatch(/Too many writes: the limit is 10 per minute/);
    expect(text(refused)).toMatch(/Nothing was changed/);
    expect(text(refused)).toMatch(/Wait about 6 seconds/);
    expect(execute).toHaveBeenCalledTimes(WRITE_LIMIT_PER_MINUTE);
    expect(confirm).toHaveBeenCalledTimes(WRITE_LIMIT_PER_MINUTE);
  });

  it("lets writes through again once the bucket has refilled", async () => {
    vi.useFakeTimers();
    const tool = buildBrowserTool(writeDef(), ctx());
    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) await tool.execute({ n: i }, opts());
    expect(await tool.execute({}, opts())).toMatchObject({ isError: true });

    vi.advanceTimersByTime(6_100);
    expect(await tool.execute({}, opts())).not.toMatchObject({ isError: true });
  });

  it("never throttles reads", async () => {
    const read = buildBrowserTool({ ...writeDef(), name: "party_list", annotations: { readOnlyHint: true } }, ctx());
    for (let i = 0; i < 50; i++) expect(await read.execute({}, opts())).not.toMatchObject({ isError: true });
  });

  it("does not spend a token when the user declines", async () => {
    const tool = buildBrowserTool(writeDef(), ctx());
    vi.mocked(window.confirm).mockReturnValue(false);
    for (let i = 0; i < 25; i++) {
      expect(text(await tool.execute({}, opts()))).toMatch(/user declined/i);
    }
    vi.mocked(window.confirm).mockReturnValue(true);
    expect(await tool.execute({}, opts())).not.toMatchObject({ isError: true });
  });
});

describe("approved writes run one at a time", () => {
  it("starts the second write only after the first has finished", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = writeDef(
      () =>
        new Promise((resolve) => {
          order.push("first:start");
          releaseFirst = () => {
            order.push("first:end");
            resolve({ id: "1" });
          };
        }),
    );
    const second = writeDef(async () => {
      order.push("second:start");
      return { id: "2" };
    });

    const a = buildBrowserTool(first, ctx()).execute({}, opts());
    const b = buildBrowserTool(second, ctx()).execute({}, opts());
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    // The second call has been approved too, but must wait its turn.
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([a, b]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("keeps going after a write fails", async () => {
    const failing = buildBrowserTool(
      writeDef(async () => {
        throw new Error("boom");
      }),
      ctx(),
    );
    const fine = buildBrowserTool(writeDef(async () => ({ id: "ok" })), ctx());
    const [bad, good] = await Promise.all([failing.execute({}, opts()), fine.execute({}, opts())]);
    expect(bad).toMatchObject({ isError: true });
    expect(good).not.toMatchObject({ isError: true });
  });

  it("a duplicated tool call reaches the API twice, in order, with the SAME idempotency key", async () => {
    const seen: string[] = [];
    const create = {
      ...(webMcpTools.find((t) => t.name === "party_create") as WebMcpToolDefinition),
    };
    // Stand in for the API: the first call creates, the second (same key) is the replay.
    const created = new Map<string, string>();
    const idempotentCreate = writeDef(async (input, c) => {
      const key = deriveIdempotencyKey("party_create", c.businessId, input);
      seen.push(key);
      if (!created.has(key)) created.set(key, `party-${created.size + 1}`);
      return { id: created.get(key) };
    });
    expect(create.name).toBe("party_create");

    const tool = buildBrowserTool(idempotentCreate, ctx());
    const [a, b] = await Promise.all([
      tool.execute({ type: "customer", name: "Acme" }, opts()),
      tool.execute({ type: "customer", name: "Acme" }, opts()),
    ]);
    expect(seen[0]).toBe(seen[1]);
    expect(created.size).toBe(1);
    expect(text(a)).toContain("party-1");
    expect(text(b)).toContain("party-1");
  });
});

describe("idempotency keys sent by the write tools", () => {
  const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

  it("derives a well-formed key that is stable for an identical request", () => {
    const input = { partyId: "p", type: "sale", lineItems: [{ itemName: "A", quantity: "1", unitPrice: "10.00" }] };
    const a = deriveIdempotencyKey("invoice_create", "biz-1", input);
    expect(a).toMatch(KEY_RE);
    expect(deriveIdempotencyKey("invoice_create", "biz-1", { ...input })).toBe(a);
    // Field order and an explicit idempotencyKey do not matter.
    expect(
      deriveIdempotencyKey("invoice_create", "biz-1", {
        lineItems: [{ unitPrice: "10.00", quantity: "1", itemName: "A" }],
        type: "sale",
        idempotencyKey: "anything-else",
        partyId: "p",
      }),
    ).toBe(a);
  });

  it("changes when the request, the business or the tool changes", () => {
    const input = { partyId: "p", amount: "10.00" };
    const base = deriveIdempotencyKey("payment_create", "biz-1", input);
    expect(deriveIdempotencyKey("payment_create", "biz-1", { ...input, amount: "10.01" })).not.toBe(base);
    expect(deriveIdempotencyKey("payment_create", "biz-2", input)).not.toBe(base);
    expect(deriveIdempotencyKey("invoice_create", "biz-1", input)).not.toBe(base);
  });

  it("honours a well-formed key from the agent and ignores a malformed one", () => {
    expect(idempotencyKeyFor("invoice_create", "biz-1", { idempotencyKey: "my-attempt-0002" })).toBe("my-attempt-0002");
    const derived = deriveIdempotencyKey("invoice_create", "biz-1", { idempotencyKey: "short" });
    expect(idempotencyKeyFor("invoice_create", "biz-1", { idempotencyKey: "short" })).toBe(derived);
    expect(idempotencyKeyFor("invoice_create", "biz-1", { idempotencyKey: "has spaces in it" })).toMatch(KEY_RE);
  });

  it("is declared on invoice_create and payment_create, and nowhere else", () => {
    for (const t of webMcpTools) {
      const has = t.inputSchema.properties?.idempotencyKey !== undefined;
      expect(has, t.name).toBe(t.name === "invoice_create" || t.name === "payment_create");
    }
    for (const name of ["invoice_create", "payment_create"]) {
      const def = webMcpTools.find((t) => t.name === name)!;
      expect(def.description).toMatch(/Safe to retry/);
      expect(def.inputSchema.required).not.toContain("idempotencyKey");
    }
  });
});

describe("the API's own rate limit", () => {
  function tooManyRequests() {
    // What the HTTP link produces when the API's limiter answers 429 outside tRPC.
    const err = new TRPCClientError("Unable to transform response from server");
    Object.assign(err, { meta: { response: { status: 429 } } });
    return err;
  }

  it("reaches the agent as a readable slow-down message", () => {
    const result = toErrorResult(tooManyRequests());
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe("Too many requests: slow down and try again in a moment.");
  });

  it("does not mistake other HTTP failures for it", () => {
    const err = new TRPCClientError("Unable to transform response from server");
    Object.assign(err, { meta: { response: { status: 502 } } });
    expect(JSON.parse(toErrorResult(err).content[0].text).error).toMatch(/^API error:/);
  });
});

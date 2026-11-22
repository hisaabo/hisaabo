import { describe, it, expect, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  hasPlausibleCredential,
  countStrictProcedures,
  trpcProcedures,
  pickRateTier,
  chargeRateLimits,
  AGENT_LIMIT_PER_MIN,
  type RateMap,
} from "../lib/rate-limit-tier.js";
import { NegativeCache } from "../lib/ttl-negative-cache.js";
import {
  validateOrderItemsShape,
  normalizeIndianMobile,
  aggregateStockDemand,
  findInsufficientStock,
  MAX_ORDER_ITEMS,
  MAX_ITEM_QUANTITY,
} from "../lib/store-order-validation.js";
import { verifyShippingWebhook, parseWebhookTime } from "../lib/shipping-webhook.js";
import { getTrustedClientIp } from "../lib/client-ip.js";
import { exceedsArrayLimits, MAX_ARRAY_ITEMS, MAX_TOTAL_ARRAY_ITEMS } from "../lib/json-limits.js";

const SESSION = "A".repeat(64);

describe("rate-limit credential shape", () => {
  it("rejects trivial Bearer values and session_id substrings", () => {
    expect(hasPlausibleCredential({ authorization: "Bearer x" })).toBe(false);
    expect(hasPlausibleCredential({ authorization: "Bearer " })).toBe(false);
    expect(hasPlausibleCredential({ cookie: "session_id=1" })).toBe(false);
    expect(hasPlausibleCredential({ cookie: "x=session_id=" + SESSION })).toBe(false);
    expect(hasPlausibleCredential({ cookie: "not_session_id=" + SESSION })).toBe(false);
  });

  it("accepts plausibly shaped credentials", () => {
    expect(hasPlausibleCredential({ authorization: `Bearer ${SESSION}` })).toBe(true);
    expect(hasPlausibleCredential({ authorization: `Bearer at_${"b".repeat(64)}` })).toBe(true);
    expect(hasPlausibleCredential({ authorization: `Bearer hisaabo_key_${"c".repeat(43)}` })).toBe(true);
    expect(hasPlausibleCredential({ cookie: `a=1; session_id=${SESSION}` })).toBe(true);
  });

  it("elevated tier requires a credential; anonymous stays low", () => {
    expect(pickRateTier({ sameOrigin: true, hasCredential: true }).limit).toBe(300);
    expect(pickRateTier({ sameOrigin: true, hasCredential: false }).limit).toBe(60);
    expect(pickRateTier({ sameOrigin: false, hasCredential: false }).limit).toBe(10);
  });
});

describe("browser-agent rate cap (charged on top of the ordinary tier)", () => {
  const IP = "203.0.113.7";
  const human = { sameOrigin: true, hasCredential: true, agent: false };
  const agent = { sameOrigin: true, hasCredential: true, agent: true };

  it("the ordinary tier no longer knows about the marker", () => {
    expect(pickRateTier({ sameOrigin: true, hasCredential: true })).toEqual({ tier: "same-auth", limit: 300 });
    expect(pickRateTier({ sameOrigin: true, hasCredential: false })).toEqual({ tier: "same-anon", limit: 60 });
    expect(pickRateTier({ sameOrigin: false, hasCredential: true })).toEqual({ tier: "ext-auth", limit: 120 });
    expect(pickRateTier({ sameOrigin: false, hasCredential: false })).toEqual({ tier: "ext-anon", limit: 10 });
    expect(AGENT_LIMIT_PER_MIN).toBeLessThan(300);
  });

  it("an agent stuck in a loop is cut off at its own cap", () => {
    const map: RateMap = new Map();
    let allowed = 0;
    for (let i = 0; i < 1000; i++) if (chargeRateLimits(map, IP, agent, 1_000_000).ok) allowed++;
    expect(allowed).toBe(AGENT_LIMIT_PER_MIN);
    expect(chargeRateLimits(map, IP, agent, 1_000_000)).toEqual({ ok: false, tier: "agent-auth" });
  });

  it("the agent drains at most its cap from the human's budget, and the human keeps the rest", () => {
    const map: RateMap = new Map();
    for (let i = 0; i < 1000; i++) chargeRateLimits(map, IP, agent, 1_000_000);
    // 300 - 120 = 180 requests left for the person in the same tab.
    let human_ok = 0;
    for (let i = 0; i < 1000; i++) if (chargeRateLimits(map, IP, human, 1_000_000).ok) human_ok++;
    expect(human_ok).toBe(300 - AGENT_LIMIT_PER_MIN);
  });

  it("alternating the header never gets more than the base tier in total", () => {
    const map: RateMap = new Map();
    let allowed = 0;
    let allowedAgent = 0;
    for (let i = 0; i < 2000; i++) {
      const marked = i % 2 === 0;
      if (chargeRateLimits(map, IP, marked ? agent : human, 1_000_000).ok) {
        allowed++;
        if (marked) allowedAgent++;
      }
    }
    expect(allowed).toBe(300);
    expect(allowedAgent).toBeLessThanOrEqual(AGENT_LIMIT_PER_MIN);
  });

  it("marking every request is no better than not marking: still the base tier at most", () => {
    const marked: RateMap = new Map();
    const plain: RateMap = new Map();
    let a = 0;
    let b = 0;
    for (let i = 0; i < 2000; i++) {
      if (chargeRateLimits(marked, IP, agent, 5).ok) a++;
      if (chargeRateLimits(plain, IP, human, 5).ok) b++;
    }
    expect(b).toBe(300);
    expect(a).toBeLessThan(b);
  });

  it("never lets an anonymous caller use the marker for anything", () => {
    const map: RateMap = new Map();
    const anonAgent = { sameOrigin: true, hasCredential: false, agent: true };
    let allowed = 0;
    for (let i = 0; i < 200; i++) if (chargeRateLimits(map, IP, anonAgent, 1_000_000).ok) allowed++;
    expect(allowed).toBe(60);
    expect(map.has(`agent-auth:${IP}`)).toBe(false);
  });

  it("an over-cap agent is refused without spending the human's tier", () => {
    const map: RateMap = new Map();
    for (let i = 0; i < AGENT_LIMIT_PER_MIN; i++) chargeRateLimits(map, IP, agent, 1_000_000);
    const spent = map.get(`same-auth:${IP}`)!.count;
    for (let i = 0; i < 50; i++) chargeRateLimits(map, IP, agent, 1_000_000);
    expect(map.get(`same-auth:${IP}`)!.count).toBe(spent);
  });

  it("both windows refill after their minute", () => {
    const map: RateMap = new Map();
    for (let i = 0; i < 1000; i++) chargeRateLimits(map, IP, agent, 0);
    expect(chargeRateLimits(map, IP, agent, 59_000).ok).toBe(false);
    expect(chargeRateLimits(map, IP, agent, 60_001).ok).toBe(true);
  });

  it("reports which bucket refused the request", () => {
    const map: RateMap = new Map();
    for (let i = 0; i < 300; i++) chargeRateLimits(map, IP, { ...human, sameOrigin: true }, 0);
    expect(chargeRateLimits(map, IP, human, 0)).toEqual({ ok: false, tier: "same-auth" });
  });
});

describe("strict auth procedures", () => {
  it("detects auth procedures including inside batches", () => {
    expect(countStrictProcedures("/api/trpc/auth.login")).toBe(1);
    expect(countStrictProcedures("/api/trpc/auth.me,auth.login,auth.login")).toBe(2);
    expect(countStrictProcedures("/api/trpc/invoice.list")).toBe(0);
    expect(trpcProcedures("/api/trpc/a.b,c.d")).toEqual(["a.b", "c.d"]);
  });
});

describe("NegativeCache", () => {
  it("expires entries and stays bounded", () => {
    const c = new NegativeCache(3, 1000);
    c.add("a", 0);
    expect(c.has("a", 500)).toBe(true);
    expect(c.has("a", 1000)).toBe(false);
    for (const k of ["b", "c", "d", "e"]) c.add(k, 2000);
    expect(c.size).toBeLessThanOrEqual(3);
    expect(c.has("b", 2001)).toBe(false); // oldest evicted
    expect(c.has("e", 2001)).toBe(true);
  });
});

describe("store order validation", () => {
  const ok = { itemId: "i1", quantity: 1 };
  it("caps items and quantity", () => {
    expect(validateOrderItemsShape([ok])).toBeNull();
    expect(validateOrderItemsShape(Array.from({ length: MAX_ORDER_ITEMS + 1 }, () => ok))).toMatch(/at most/);
    expect(validateOrderItemsShape([{ itemId: "i1", quantity: MAX_ITEM_QUANTITY + 1 }])).toMatch(/exceed/);
    expect(validateOrderItemsShape([{ itemId: "i1", quantity: 0 }])).toMatch(/positive/);
    expect(validateOrderItemsShape([])).toMatch(/required/);
  });

  it("normalises phones to exactly 10 digits", () => {
    expect(normalizeIndianMobile("+91 98765-43210")).toBe("9876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("9876543210");
    expect(normalizeIndianMobile("43210")).toBeNull();
    expect(normalizeIndianMobile("1234567890")).toBeNull();
    expect(normalizeIndianMobile("98765432101234")).toBeNull();
    expect(normalizeIndianMobile(12345)).toBeNull();
  });

  it("aggregates stock demand (alt units, duplicates) and flags shortfalls", () => {
    const demand = aggregateStockDemand([
      { itemId: "i1", quantity: "2", conversionFactor: "12" },
      { itemId: "i1", quantity: "1" },
      { itemId: "i2", variantId: "v1", quantity: "3" },
    ]);
    expect(demand.items.get("i1")).toBe(25);
    expect(demand.variants.get("v1")).toBe(3);
    expect(findInsufficientStock(demand.items, new Map([["i1", "24.000"]]))).toEqual(["i1"]);
    expect(findInsufficientStock(demand.items, new Map([["i1", "25.000"]]))).toEqual([]);
    expect(findInsufficientStock(demand.variants, new Map())).toEqual(["v1"]);
  });
});

describe("shipping webhook verification", () => {
  const secret = "s3cret";
  const body = JSON.stringify({ awb: "X1", status: "delivered" });
  const now = 1_700_000_000_000;
  const hmac = (m: string) => createHmac("sha256", secret).update(m).digest("hex");

  it("accepts legacy body-only signatures", () => {
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: hmac(body), now }).ok).toBe(true);
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: "00", now }).ok).toBe(false);
  });

  it("can require a timestamp", () => {
    const v = verifyShippingWebhook({ secret, rawBody: body, signature: hmac(body), requireTimestamp: true, now });
    expect(v.ok).toBe(false);
  });

  it("enforces the timestamp window and signs the timestamp", () => {
    const ts = String(Math.floor(now / 1000));
    const sig = hmac(`${ts}.${body}`);
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: sig, timestampHeader: ts, now }).ok).toBe(true);
    // body-only signature must not satisfy the timestamped scheme
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: hmac(body), timestampHeader: ts, now }).ok).toBe(false);
    // replay outside the window
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: sig, timestampHeader: ts, now: now + 6 * 60_000 }).ok).toBe(false);
    expect(verifyShippingWebhook({ secret, rawBody: body, signature: sig, timestampHeader: "garbage", now }).ok).toBe(false);
  });

  it("rejects invalid dates", () => {
    expect(parseWebhookTime("not a date")).toBeNull();
    expect(parseWebhookTime(NaN)).toBeNull();
    expect(parseWebhookTime("2025-01-01T00:00:00Z")).toBeInstanceOf(Date);
  });
});

describe("trusted client IP", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("ignores cf-connecting-ip unless TRUST_CLOUDFLARE=true", () => {
    delete process.env.TRUST_CLOUDFLARE;
    process.env.TRUST_PROXY_HOPS = "0";
    const h = new Headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" });
    expect(getTrustedClientIp(h)).toBeNull();
    process.env.TRUST_CLOUDFLARE = "true";
    expect(getTrustedClientIp(h)).toBe("1.2.3.4");
  });
});

describe("JSON array limits (memory exhaustion guard, defence in depth under zod >= 4.6.6)", () => {
  it("allows realistic inputs, including a full 5,000-row import", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ name: `Item ${i}`, lineItems: [{ qty: 1 }, { qty: 2 }] }));
    expect(exceedsArrayLimits({ 0: { json: { rows } } })).toBe(false);
    expect(exceedsArrayLimits({ ids: Array(500).fill("x") })).toBe(false);
    expect(exceedsArrayLimits("plain")).toBe(false);
    expect(exceedsArrayLimits(null)).toBe(false);
  });

  it("rejects one oversized array, at any depth", () => {
    expect(exceedsArrayLimits({ ids: Array(MAX_ARRAY_ITEMS + 1).fill(1) })).toBe(true);
    expect(exceedsArrayLimits({ a: [{ b: { c: Array(MAX_ARRAY_ITEMS + 1).fill(0) } }] })).toBe(true);
    expect(exceedsArrayLimits({ ids: Array(MAX_ARRAY_ITEMS).fill(1) })).toBe(false);
  });

  it("rejects many arrays that are each under the per-array cap", () => {
    const rows = Array.from({ length: 30 }, () => ({ items: Array(MAX_ARRAY_ITEMS).fill(0) }));
    expect(exceedsArrayLimits({ rows })).toBe(true);
    expect(exceedsArrayLimits({ rows }, MAX_ARRAY_ITEMS, MAX_TOTAL_ARRAY_ITEMS * 10)).toBe(false);
  });

  it("walks deep nesting without overflowing the stack", () => {
    let deep: unknown = [];
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(exceedsArrayLimits(deep)).toBe(false);
  });
});

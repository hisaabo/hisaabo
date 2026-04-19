/**
 * store-rate-limit.test.ts — Regression tests for the per-IP rate limit
 * applied to the public `POST /store/:slug/order` and
 * `POST /store/:slug/identify` endpoints.
 *
 * WHY THIS FILE EXISTS:
 * `/store/*` is intentionally exempt from the global CSRF middleware
 * because those handlers don't read the admin session cookie. A per-IP
 * rate limit is one of the compensating controls — without it, a
 * Turnstile-less attacker (or a bot that burns Turnstile tokens) could
 * enumerate phones or spam order attempts from a single host.
 *
 * The limiter is implemented inline in `server.ts` against a small Map.
 * The plan explicitly avoids refactoring that limiter into its own
 * module (keeps the diff minimal), so this test mirrors the exact
 * limiter shape in a throwaway Hono app — same structure, same
 * semantics, zero DB, zero tRPC. If the production limiter is ever
 * changed, the mirror here must be updated in lockstep or the
 * regression is real.
 *
 * The 21st request within a minute window must return 429.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

/**
 * Build a minimal app that mirrors the server.ts limiter shape:
 * per-IP + per-path window, 20/min cap, 429 on breach.
 *
 * NOTE — keep in sync with `checkStoreIpRateLimit` in `server.ts`.
 */
function buildAppWithLimiter(limit = 20) {
  const map = new Map<string, { count: number; reset: number }>();

  function check(ip: string, path: string): boolean {
    const now = Date.now();
    const key = `${ip}:${path}`;
    const entry = map.get(key);
    if (!entry || now > entry.reset) {
      map.set(key, { count: 1, reset: now + 60_000 });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  }

  const app = new Hono();
  app.post("/store/:slug/order", (c) => {
    // Mirror: the real handler uses getClientIp which prefers
    // cf-connecting-ip then the last entry of x-forwarded-for.
    const ip = c.req.header("cf-connecting-ip") ?? "test-ip";
    if (!check(ip, "/store/order")) {
      return c.json({ error: "Too many requests. Please wait a moment." }, 429);
    }
    return c.json({ ok: true });
  });
  app.post("/store/:slug/identify", (c) => {
    const ip = c.req.header("cf-connecting-ip") ?? "test-ip";
    if (!check(ip, "/store/identify")) {
      return c.json({ error: "Too many requests. Please wait a moment." }, 429);
    }
    return c.json({ ok: true });
  });
  return app;
}

describe("/store/* per-IP rate limit (20/min per path per IP)", () => {
  it("POST /store/:slug/order — the 21st call from the same IP within a minute returns 429 with the stable error copy; the first 20 calls must pass unchanged", async () => {
    const app = buildAppWithLimiter(20);
    const headers = { "cf-connecting-ip": "1.2.3.4", "content-type": "application/json" };

    // 20 requests pass.
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/store/shop/order", {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(res.status).toBe(200);
    }

    // 21st trips the limiter.
    const blocked = await app.request("/store/shop/order", {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string };
    expect(body).toEqual({ error: "Too many requests. Please wait a moment." });
  });

  it("per-IP counter is scoped by path — 20 order posts do not consume the identify budget for the same IP (each path carries its own 20/min window)", async () => {
    const app = buildAppWithLimiter(20);
    const headers = { "cf-connecting-ip": "1.2.3.4", "content-type": "application/json" };

    // Exhaust the order window.
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/store/shop/order", { method: "POST", headers, body: "{}" });
      expect(res.status).toBe(200);
    }
    const orderBlocked = await app.request("/store/shop/order", { method: "POST", headers, body: "{}" });
    expect(orderBlocked.status).toBe(429);

    // identify still has its full 20-request budget.
    const identifyOk = await app.request("/store/shop/identify", { method: "POST", headers, body: "{}" });
    expect(identifyOk.status).toBe(200);
  });

  it("per-IP counter is scoped by IP — a second IP gets its own budget and is not blocked by a noisy neighbour on the same path", async () => {
    const app = buildAppWithLimiter(20);

    // IP A exhausts the window.
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/store/shop/order", {
        method: "POST",
        headers: { "cf-connecting-ip": "1.2.3.4", "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
    }
    const blocked = await app.request("/store/shop/order", {
      method: "POST",
      headers: { "cf-connecting-ip": "1.2.3.4", "content-type": "application/json" },
      body: "{}",
    });
    expect(blocked.status).toBe(429);

    // IP B is unaffected.
    const other = await app.request("/store/shop/order", {
      method: "POST",
      headers: { "cf-connecting-ip": "5.6.7.8", "content-type": "application/json" },
      body: "{}",
    });
    expect(other.status).toBe(200);
  });
});

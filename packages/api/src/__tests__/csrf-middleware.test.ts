/**
 * csrf-middleware.test.ts — Regression tests for the Hono-level CSRF
 * protection in `packages/api/src/lib/csrf-middleware.ts`.
 *
 * WHY THIS FILE EXISTS:
 * A prior pass hand-wired the CSRF check inline in `server.ts` and
 * rejected every React Native POST because Android's native HTTP
 * cookie jar replays the stale `session_id` cookie from a previous
 * magic-link verification. That caused the Android app to emit
 * "Unable to transform response from server" on every login attempt.
 * These tests pin the fix so the same regression cannot recur.
 *
 * The tests mount the factory-produced middleware onto a throwaway
 * `new Hono()` instance — NO database, NO tRPC router, NO setInterval
 * side effects — so they run in a few ms and can gate every push.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createCsrfMiddleware } from "../lib/csrf-middleware.js";

/**
 * Build a minimal Hono app that mounts the CSRF middleware followed by
 * a catch-all route that returns `{ok: true}` so a passing test returns
 * 200 and a blocked test returns whatever status the middleware set.
 *
 * By default we disable the tRPC path skip so the tests can exercise
 * both Hono-scope (non-tRPC) and tRPC-scope behaviours on the same
 * instance.
 */
function buildTestApp(opts: { skipPathPrefixes?: string[] } = {}) {
  const app = new Hono();
  app.use("*", createCsrfMiddleware({ skipPathPrefixes: opts.skipPathPrefixes ?? [] }));
  app.all("/api/store/order", (c) => c.json({ ok: true }));
  app.all("/api/trpc/auth.sendMagicLink", (c) => c.json({ ok: true }));
  app.all("/", (c) => c.json({ ok: true }));
  return app;
}

describe("CSRF middleware — Hono layer for non-tRPC routes", () => {
  it("CSRF middleware allows POST when the request has an Authorization: Bearer header even if a session_id cookie is also present — mobile clients carry stale cookies from React Native's native HTTP cookie jar and must not be blocked because they authenticate via Bearer", async () => {
    const app = buildTestApp();

    // Simulate a mobile POST: Bearer token for real auth, stale
    // session_id cookie left over in the native cookie jar, and NO
    // `X-Requested-With` header (the original mobile tRPC client
    // never set it). The middleware must NOT reject.
    const res = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "authorization": "Bearer mobile-session-token-xyz",
        "cookie": "session_id=stale-from-native-jar; other=foo",
        "content-type": "application/json",
      },
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("CSRF middleware still rejects POST requests that have a session_id cookie, no Authorization header, and no X-Requested-With: hisaabo — this is the original cookie-auth browser threat model and must stay protected", async () => {
    const app = buildTestApp();

    // Classic browser-origin CSRF: attacker-controlled page submits
    // a form to the API, the browser attaches session_id automatically,
    // but the attacker cannot set X-Requested-With from a simple HTML
    // form. This MUST return 403.
    const res = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "cookie": "session_id=real-browser-session",
        "content-type": "application/json",
      },
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "CSRF validation failed" });
  });

  it("CSRF middleware allows POST when the request has session_id cookie and X-Requested-With: hisaabo — web and desktop clients pass unchanged", async () => {
    const app = buildTestApp();

    // Web / desktop Tauri: cookies + the sentinel header the JS client sets.
    const res = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "cookie": "session_id=real-browser-session",
        "x-requested-with": "hisaabo",
        "content-type": "application/json",
      },
      body: JSON.stringify({ items: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("CSRF middleware allows POST when the request has no session_id cookie at all — unauthenticated public endpoints like sendMagicLink must not be gated by CSRF", async () => {
    const app = buildTestApp();

    // Unauthenticated public POST (e.g. initial magic-link request).
    // No cookie → nothing to protect → must pass without the sentinel.
    const res = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "new-user@example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("CSRF middleware exempts GET requests entirely — side-effect-free reads never need the sentinel header", async () => {
    const app = buildTestApp();

    const res = await app.request("/api/store/order", {
      method: "GET",
      headers: {
        "cookie": "session_id=real-browser-session",
      },
    });

    expect(res.status).toBe(200);
  });

  it("CSRF middleware exempts OPTIONS preflight requests — browsers must be able to preflight without the sentinel or 403s break CORS", async () => {
    const app = buildTestApp();

    const res = await app.request("/api/store/order", {
      method: "OPTIONS",
      headers: {
        "origin": "https://app.hisaabo.in",
        "access-control-request-method": "POST",
      },
    });

    // Hono's catch-all returns 200; the point is the middleware did
    // not short-circuit with 403.
    expect(res.status).not.toBe(403);
  });

  it("CSRF middleware case-insensitively matches Bearer prefix — 'BEARER token' and 'bearer token' both bypass", async () => {
    const app = buildTestApp();

    for (const prefix of ["Bearer", "bearer", "BEARER", "BeArEr"]) {
      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": `${prefix} token-xyz`,
          "cookie": "session_id=stale",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(res.status).toBe(200);
    }
  });

  it("CSRF middleware skips tRPC paths entirely when skipPathPrefixes includes /api/trpc/ — the tRPC-layer middleware owns those rejections", async () => {
    // Default behaviour — skipPathPrefixes defaults to ["/api/trpc/"].
    const app = new Hono();
    app.use("*", createCsrfMiddleware()); // default skip list
    app.all("/api/trpc/auth.sendMagicLink", (c) => c.json({ ok: true }));

    // A POST that WOULD be blocked by the Hono layer (cookie, no XRW)
    // must pass through because tRPC handles CSRF itself.
    const res = await app.request("/api/trpc/auth.sendMagicLink", {
      method: "POST",
      headers: {
        "cookie": "session_id=real-browser-session",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(res.status).toBe(200);
  });

  it("CSRF middleware allows POST /store/:slug/order when session_id cookie is present and X-Requested-With is missing — /store/* is CSRF-exempt because those routes are auth-less; a same-origin admin session cookie must not trip the gate on a customer checkout", async () => {
    // Mount the middleware with the production skip list for store.
    const app = new Hono();
    app.use("*", createCsrfMiddleware({ skipPathPrefixes: ["/api/trpc/", "/store/"] }));
    app.all("/store/:slug/order", (c) => c.json({ ok: true }));

    // Simulate the exact failure mode we are fixing: customer loads
    // store.example.com on a browser that also holds an admin session
    // cookie for the same origin; they submit the order; CSRF MUST NOT
    // reject even though XRW is absent.
    const res = await app.request("/store/my-shop/order", {
      method: "POST",
      headers: {
        "cookie": "session_id=admin-session-xyz",
        "content-type": "application/json",
      },
      body: JSON.stringify({ customerPhone: "+919876543210", items: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("CSRF middleware allows POST /store/:slug/identify under the same exemption — the identify endpoint sits behind the same auth-less, Turnstile-gated contract as /order", async () => {
    const app = new Hono();
    app.use("*", createCsrfMiddleware({ skipPathPrefixes: ["/api/trpc/", "/store/"] }));
    app.all("/store/:slug/identify", (c) => c.json({ ok: true }));

    const res = await app.request("/store/my-shop/identify", {
      method: "POST",
      headers: {
        "cookie": "session_id=admin-session-xyz",
        "content-type": "application/json",
      },
      body: JSON.stringify({ phone: "+919876543210", turnstileToken: "t" }),
    });

    expect(res.status).toBe(200);
  });

  it("CSRF middleware still rejects POST on non-exempt paths when the /store/ skip is configured — regression guard so widening the skip list doesn't accidentally open /api/foo or similar", async () => {
    const app = new Hono();
    app.use("*", createCsrfMiddleware({ skipPathPrefixes: ["/api/trpc/", "/store/"] }));
    app.all("/api/foo", (c) => c.json({ ok: true }));

    const res = await app.request("/api/foo", {
      method: "POST",
      headers: {
        "cookie": "session_id=real-browser-session",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "CSRF validation failed" });
  });
});

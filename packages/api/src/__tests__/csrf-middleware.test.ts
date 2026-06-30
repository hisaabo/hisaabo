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

import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { createCsrfMiddleware, isOriginAllowedForBearer, CSRF_TAURI_ORIGINS } from "../lib/csrf-middleware.js";

/**
 * Build a minimal Hono app that mounts the CSRF middleware followed by
 * a catch-all route that returns `{ok: true}` so a passing test returns
 * 200 and a blocked test returns whatever status the middleware set.
 *
 * By default we disable the tRPC path skip so the tests can exercise
 * both Hono-scope (non-tRPC) and tRPC-scope behaviours on the same
 * instance.
 */
// Default allowedBearerOrigins used throughout these tests — deterministic,
// env-var independent. Mirrors a minimal CORS_ORIGINS config for a deployed
// web app plus the Tauri desktop origins baked into the middleware.
const TEST_CORS_ORIGINS = ["http://localhost:5173", "https://app.hisaabo.in"];

function buildTestApp(
  opts: { skipPathPrefixes?: string[]; allowedBearerOrigins?: readonly string[] } = {},
) {
  const app = new Hono();
  app.use(
    "*",
    createCsrfMiddleware({
      skipPathPrefixes: opts.skipPathPrefixes ?? [],
      // Provide an explicit list so tests are independent of CORS_ORIGINS env var.
      allowedBearerOrigins: opts.allowedBearerOrigins ?? TEST_CORS_ORIGINS,
    }),
  );
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
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: ["/api/trpc/", "/store/"],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
      }),
    );
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

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — P1 #7: Bearer + Origin allowlist (defense-in-depth)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — CSRF middleware Bearer-auth Origin allowlist (P1 #7 defense-in-depth)", () => {
  /**
   * WHY THIS BLOCK EXISTS:
   * A stolen Bearer token replayed from a hostile browser page will carry an
   * Origin header that does not match the allowlist. The check fires ONLY when
   * Origin is present — mobile apps, CLIs, and server-to-server callers never
   * send Origin and must not be affected.
   *
   * Each test names the invariant it protects so a future regression is
   * immediately identifiable from the failing test title.
   */

  // Pure-function tests for isOriginAllowedForBearer — fast and env-independent.
  describe("isOriginAllowedForBearer — pure-function unit tests", () => {
    const corsOrigins = ["http://localhost:5173", "https://app.hisaabo.in"];

    it("returns true for an empty origin string — mobile / server-to-server callers omit Origin and must never be blocked", () => {
      expect(isOriginAllowedForBearer("", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for an exact match against a configured CORS origin — web app on localhost is a first-party client", () => {
      expect(isOriginAllowedForBearer("http://localhost:5173", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for https://app.hisaabo.in — exact CORS origins list match", () => {
      expect(isOriginAllowedForBearer("https://app.hisaabo.in", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for https://billing.hisaabo.in — *.hisaabo.in wildcard covers all first-party subdomains", () => {
      expect(isOriginAllowedForBearer("https://billing.hisaabo.in", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for http://tauri.localhost — Tauri desktop app on Linux/WSL must not be blocked by the allowlist", () => {
      expect(isOriginAllowedForBearer("http://tauri.localhost", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for https://tauri.localhost — Tauri desktop app on Windows/macOS default asset scheme", () => {
      expect(isOriginAllowedForBearer("https://tauri.localhost", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns true for tauri://localhost — legacy Tauri custom protocol kept for backward compatibility", () => {
      expect(isOriginAllowedForBearer("tauri://localhost", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(true);
    });

    it("returns false for https://evil.com — unrecognised origin is an indicator of stolen-token replay from a hostile page", () => {
      expect(isOriginAllowedForBearer("https://evil.com", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(false);
    });

    it("returns false for https://notreallyhisaabo.in.evil.com — subdomain spoofing attempt must not match the hisaabo.in regex", () => {
      expect(isOriginAllowedForBearer("https://notreallyhisaabo.in.evil.com", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(false);
    });

    it("returns false for https://hisaabo.in.evil.com — another subdomain-spoofing variant that anchors '.in' mid-string", () => {
      expect(isOriginAllowedForBearer("https://hisaabo.in.evil.com", corsOrigins, CSRF_TAURI_ORIGINS)).toBe(false);
    });
  });

  // Integration tests: full Hono middleware stack, verifying the correct HTTP
  // response is returned for each scenario.
  describe("Hono middleware integration — Bearer + Origin header combinations", () => {
    it("Bearer + allowlisted browser Origin (http://localhost:5173) → request passes through to the handler — web app running locally must continue to work", async () => {
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer desktop-session-token",
          "origin": "http://localhost:5173",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("Bearer + http://tauri.localhost Origin → request passes — Tauri desktop app is a first-party client that authenticates via Bearer", async () => {
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer tauri-desktop-token",
          "origin": "http://tauri.localhost",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("Bearer + https://app.hisaabo.in Origin → request passes — production web app origin must not be blocked", async () => {
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer web-app-token",
          "origin": "https://app.hisaabo.in",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("Bearer + https://billing.hisaabo.in Origin → request passes — *.hisaabo.in wildcard allows any first-party subdomain", async () => {
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer subdomain-token",
          "origin": "https://billing.hisaabo.in",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(200);
    });

    it("Bearer + https://evil.com Origin → rejected with 403 and the specific error message — stolen token replayed from a hostile page must be blocked", async () => {
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer stolen-token",
          "origin": "https://evil.com",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Origin not permitted for Bearer-authenticated request");
    });

    it("Bearer + NO Origin header (mobile / server-to-server) → request passes — React Native fetch and curl never send Origin and must not be blocked", async () => {
      const app = buildTestApp();

      // This is the highest regression-risk path: previously the Bearer bypass
      // called next() unconditionally; if the new check mistakenly required
      // Origin to be present, every mobile POST would break.
      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "authorization": "Bearer mobile-token",
          "cookie": "session_id=stale-from-native-jar",
          "content-type": "application/json",
        },
        body: "{}",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("Cookie auth + no Bearer + https://evil.com Origin → existing cookie-path handling (CSRF validation) unchanged — the Bearer Origin check must not tighten the cookie path", async () => {
      // This test verifies that the new check is ONLY on the Bearer branch.
      // A cookie-authenticated request with a hostile Origin and no X-Requested-With
      // header must still be rejected by the pre-existing CSRF check, NOT by the
      // new Bearer-Origin check (which should not have run at all).
      const app = buildTestApp();

      const res = await app.request("/api/store/order", {
        method: "POST",
        headers: {
          "cookie": "session_id=real-browser-session",
          "origin": "https://evil.com",
          "content-type": "application/json",
          // Deliberately no Authorization header and no X-Requested-With
        },
        body: "{}",
      });

      // Must be rejected by the existing CSRF check, not by the new Bearer-Origin check.
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("CSRF validation failed");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onReject callback — fail2ban integration hook
// ─────────────────────────────────────────────────────────────────────────────
describe("CSRF middleware — onReject callback (fail2ban integration)", () => {
  /**
   * WHY THIS BLOCK EXISTS:
   * server.ts wires onReject to logSecurityEvent so fail2ban can ban
   * IPs that repeatedly trip CSRF or origin rejection. The middleware
   * must NOT call onReject on the allowed paths, and must call it
   * with the right kind on each rejection branch. The test asserts the
   * contract without depending on the logger module — we pass a vi.fn().
   */
  it("calls onReject(\"csrf_fail\", c) when a cookie-authed POST is missing the X-Requested-With header — fail2ban needs the IP from c at this exact moment", async () => {
    const onReject = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: [],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        onReject,
      }),
    );
    app.all("/api/store/order", (c) => c.json({ ok: true }));

    await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "cookie": "session_id=real-browser-session",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0][0]).toBe("csrf_fail");
    // Second argument is the Hono Context — narrow check, just confirm it carries the path.
    expect((onReject.mock.calls[0][1] as { req: { path: string } }).req.path).toBe("/api/store/order");
  });

  it("calls onReject(\"origin_block\", c) when a Bearer request comes from a non-allowlisted Origin — distinct event type so the operator can tune fail2ban thresholds separately", async () => {
    const onReject = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: [],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        onReject,
      }),
    );
    app.all("/api/store/order", (c) => c.json({ ok: true }));

    await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "authorization": "Bearer stolen-token",
        "origin": "https://evil.com",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0][0]).toBe("origin_block");
  });

  it("does NOT call onReject when the request is allowed — mobile Bearer POST with no Origin (the highest-traffic path) must not generate spurious fail2ban events", async () => {
    const onReject = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: [],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        onReject,
      }),
    );
    app.all("/api/store/order", (c) => c.json({ ok: true }));

    const res = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "authorization": "Bearer mobile-token",
        "cookie": "session_id=stale-from-native-jar",
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("does NOT call onReject for side-effect-free GET — even when a cookie is present without X-Requested-With, the middleware must not log the request as a CSRF failure", async () => {
    const onReject = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: [],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        onReject,
      }),
    );
    app.all("/api/store/order", (c) => c.json({ ok: true }));

    await app.request("/api/store/order", {
      method: "GET",
      headers: { "cookie": "session_id=real-browser-session" },
    });

    expect(onReject).not.toHaveBeenCalled();
  });

  it("does NOT call onReject for requests on a skipped path — /api/trpc/* and /store/* are gated by different layers and must not double-log", async () => {
    const onReject = vi.fn();
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: ["/api/trpc/", "/store/"],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        onReject,
      }),
    );
    app.all("/api/trpc/auth.login", (c) => c.json({ ok: true }));
    app.all("/store/foo/order", (c) => c.json({ ok: true }));

    // Cookie POST without X-Requested-With would otherwise trip csrf_fail.
    await app.request("/api/trpc/auth.login", {
      method: "POST",
      headers: { "cookie": "session_id=real-browser-session" },
      body: "{}",
    });
    // Bearer POST from a hostile origin would otherwise trip origin_block.
    await app.request("/store/foo/order", {
      method: "POST",
      headers: {
        "authorization": "Bearer stolen-token",
        "origin": "https://evil.com",
      },
      body: "{}",
    });

    expect(onReject).not.toHaveBeenCalled();
  });

  it("is optional — middleware works without onReject provided (no crash, default rejection paths still return 403)", async () => {
    const app = new Hono();
    app.use(
      "*",
      createCsrfMiddleware({
        skipPathPrefixes: [],
        allowedBearerOrigins: TEST_CORS_ORIGINS,
        // onReject deliberately omitted
      }),
    );
    app.all("/api/store/order", (c) => c.json({ ok: true }));

    const csrfRes = await app.request("/api/store/order", {
      method: "POST",
      headers: { "cookie": "session_id=real-browser-session" },
      body: "{}",
    });
    expect(csrfRes.status).toBe(403);

    const originRes = await app.request("/api/store/order", {
      method: "POST",
      headers: {
        "authorization": "Bearer stolen-token",
        "origin": "https://evil.com",
      },
      body: "{}",
    });
    expect(originRes.status).toBe(403);
  });
});

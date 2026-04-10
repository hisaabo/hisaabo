/**
 * csrf-middleware.ts — CSRF protection for non-tRPC (Hono) routes.
 *
 * WHY THIS FILE EXISTS:
 * State-changing requests authenticated via cookies must carry the
 * `X-Requested-With: hisaabo` header. This blocks cross-origin form
 * submissions and navigation-based CSRF attacks on cookie-authenticated
 * endpoints (web app, desktop).
 *
 * WHY BEARER-AUTHENTICATED CALLS ARE EXEMPT:
 * An `Authorization: Bearer …` token is not vulnerable to CSRF — an
 * attacker on a hostile origin cannot read the token (it lives in the
 * mobile app's SecureStore / a CLI's environment, not in cookies the
 * browser attaches automatically) and therefore cannot forge a request
 * that carries it. The whole purpose of `X-Requested-With` is to block
 * cookie-based drive-by POSTs, which is a separate threat model.
 *
 * WHY THE COOKIE-PRESENCE CHECK STILL MATTERS FOR BEARER CLIENTS:
 * React Native's native HTTP stack (URLSession on iOS, OkHttp on
 * Android) maintains a per-app cookie jar by default. When the API
 * sets `Set-Cookie: session_id=…` on `auth.verifyMagicLink`, that
 * cookie is persisted at the native layer and replayed on every
 * subsequent request from the app — even though the JS tRPC client
 * never sets it. If we only checked for the cookie's presence we
 * would reject every mobile POST. The Bearer bypass below is what
 * makes the mobile flow work.
 *
 * TRPC ROUTES ARE NOT HANDLED HERE:
 * This middleware is scoped to non-`/api/trpc/*` paths. tRPC requests
 * are gated by a matching tRPC-level middleware (`csrfCheck` in
 * `trpc.ts`) which throws a real `TRPCError` so the client receives
 * a parseable superjson error envelope instead of a Hono
 * `{error: "…"}` blob. Keeping the Hono shape for non-tRPC routes
 * (store REST endpoints, health probes, etc.) preserves backwards
 * compatibility for those clients.
 */

import type { Context, Next } from "hono";

export interface CsrfMiddlewareOptions {
  /**
   * Paths that should be skipped by this middleware because a
   * different layer handles CSRF for them. Matching is prefix-based.
   *
   * Default: `["/api/trpc/"]` — tRPC routes are gated by the
   * `csrfCheck` tRPC middleware in `trpc.ts`.
   */
  skipPathPrefixes?: string[];
}

/**
 * Build a Hono middleware that enforces the `X-Requested-With: hisaabo`
 * CSRF header on state-changing, cookie-authenticated requests.
 *
 * Pulled out of `server.ts` so it can be unit-tested in isolation
 * without booting the full API (which has import-time side effects
 * like setIntervals and DB client construction).
 */
export function createCsrfMiddleware(options: CsrfMiddlewareOptions = {}) {
  const skipPathPrefixes = options.skipPathPrefixes ?? ["/api/trpc/"];

  return async function csrfMiddleware(c: Context, next: Next) {
    // Side-effect-free methods are exempt by HTTP convention.
    if (
      c.req.method === "GET" ||
      c.req.method === "HEAD" ||
      c.req.method === "OPTIONS"
    ) {
      return next();
    }

    // tRPC routes are handled by a tRPC-level middleware that produces
    // a proper TRPCError envelope. Skip here so we don't double-gate.
    const path = c.req.path;
    for (const prefix of skipPathPrefixes) {
      if (path.startsWith(prefix)) {
        return next();
      }
    }

    // Bearer-authenticated clients (mobile, CLI, server-to-server) are
    // not vulnerable to CSRF — the token lives in client-controlled
    // storage, not cookies, so cross-origin form posts cannot forge it.
    // Bypass BEFORE the cookie check because React Native's native HTTP
    // stack maintains a cookie jar that replays stale `session_id`
    // cookies on every request even when the JS tRPC client never set
    // them.
    const authHeader = c.req.header("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      return next();
    }

    // Only enforce for cookie-based auth — if no session cookie, the
    // request is unauthenticated and CSRF has nothing to protect.
    const hasCookie = c.req.header("cookie")?.includes("session_id=");
    if (!hasCookie) {
      return next();
    }

    // Cookie-authenticated state-changing request → require CSRF header.
    const xrw = c.req.header("x-requested-with");
    if (xrw !== "hisaabo") {
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
}

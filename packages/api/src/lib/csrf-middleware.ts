/**
 * csrf-middleware.ts — CSRF protection for non-tRPC (Hono) routes.
 *
 * WHY THIS FILE EXISTS:
 * State-changing requests authenticated via cookies must carry the
 * `X-Requested-With: hisaabo` header. This blocks cross-origin form
 * submissions and navigation-based CSRF attacks on cookie-authenticated
 * endpoints (web app, desktop).
 *
 * WHY BEARER-AUTHENTICATED CALLS ARE EXEMPT FROM CSRF:
 * An `Authorization: Bearer …` token is not vulnerable to CSRF — an
 * attacker on a hostile origin cannot read the token (it lives in the
 * mobile app's SecureStore / a CLI's environment, not in cookies the
 * browser attaches automatically) and therefore cannot forge a request
 * that carries it. The whole purpose of `X-Requested-With` is to block
 * cookie-based drive-by POSTs, which is a separate threat model.
 *
 * DEFENSE-IN-DEPTH: ORIGIN ALLOWLIST ON THE BEARER PATH (P1 #7):
 * Even though Bearer is not CSRF-vulnerable in the classical sense, a
 * stolen token replayed from an unexpected browser origin is still a
 * signal worth blocking. When an `Origin` header IS present (browsers
 * always send it on cross-origin requests) and it does not match the
 * allowlist (CORS_ORIGINS + *.hisaabo.in + Tauri desktop origins), we
 * reject with 403. Mobile apps, CLIs, and server-to-server callers
 * never send Origin, so they are unaffected — this only tightens the
 * attack surface for browser-based Bearer usage.
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

/**
 * Tauri desktop webview origins. These are first-party, shipped-app
 * origins that authenticate via Bearer (not cookies). Duplicated here
 * so this module is self-contained and does not import server.ts (which
 * has import-time side effects: setIntervals, DB client construction).
 *
 * Keep in sync with TAURI_DESKTOP_ORIGINS in server.ts.
 */
export const CSRF_TAURI_ORIGINS = [
  "http://tauri.localhost",   // Linux / WSL
  "https://tauri.localhost",  // Windows / macOS default asset scheme
  "tauri://localhost",        // Legacy custom protocol (kept for compat)
] as const;

/**
 * Return true if `origin` is on the Bearer-auth allowlist:
 *   1. Empty origin (mobile / server-to-server callers do not send Origin).
 *   2. Exact match against one of the configured CORS origins.
 *   3. Any *.hisaabo.in subdomain (matches the regex used in isSameOrigin).
 *   4. Any of the Tauri desktop origins.
 *
 * This is a pure function that accepts the allowlists as parameters so
 * it can be unit-tested without environment variables.
 */
export function isOriginAllowedForBearer(
  origin: string,
  corsOrigins: readonly string[],
  tauriOrigins: readonly string[],
): boolean {
  if (!origin) return true;
  if (corsOrigins.some((allowed) => origin === allowed)) return true;
  if (/^https?:\/\/([a-z0-9-]+\.)?hisaabo\.in$/i.test(origin)) return true;
  if (tauriOrigins.includes(origin)) return true;
  return false;
}

export interface CsrfMiddlewareOptions {
  /**
   * Paths that should be skipped by this middleware because a
   * different layer handles CSRF for them. Matching is prefix-based.
   *
   * Default: `["/api/trpc/"]` — tRPC routes are gated by the
   * `csrfCheck` tRPC middleware in `trpc.ts`.
   */
  skipPathPrefixes?: string[];

  /**
   * Origins that are allowed to make Bearer-authenticated requests from
   * a browser context. Requests that carry an `Origin` header NOT in
   * this list are rejected 403 (defense-in-depth, P1 #7).
   *
   * When omitted the middleware reads `CORS_ORIGINS` from the environment
   * at call time and appends CSRF_TAURI_ORIGINS, matching the behaviour
   * of `isSameOrigin` in server.ts.
   *
   * Pass an explicit list in tests to avoid depending on env vars.
   */
  allowedBearerOrigins?: readonly string[];

  /**
   * Called when a request is rejected. Server wires this to the
   * security-event logger so fail2ban can ban repeat offenders.
   * Kept as an injected callback so this middleware does not depend
   * on the logger module (keeps the unit tests fast and isolated).
   */
  onReject?: (kind: "csrf_fail" | "origin_block", c: Context) => void;
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

  // Resolve the Bearer-origin allowlist once at middleware-construction time.
  // If the caller supplied an explicit list (e.g. in tests), use it directly.
  // Otherwise read CORS_ORIGINS from the environment — this mirrors isSameOrigin
  // in server.ts and avoids duplicating the env-parse logic at request time.
  const corsOrigins: readonly string[] =
    options.allowedBearerOrigins !== undefined
      ? options.allowedBearerOrigins
      : (process.env.CORS_ORIGINS || "http://localhost:5173")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);

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
      // Defense-in-depth (P1 #7): if the request comes from a browser,
      // an Origin header will be present. A legitimate first-party client
      // will always be on the allowlist; an unexpected origin is a signal
      // that a stolen token is being replayed from a hostile page.
      //
      // IMPORTANT: no Origin header = allow. Mobile apps (React Native
      // fetch), server-to-server calls, and curl never send Origin. We
      // must NOT require it — this check fires ONLY when Origin IS present.
      const origin = c.req.header("origin") ?? "";
      if (!isOriginAllowedForBearer(origin, corsOrigins, CSRF_TAURI_ORIGINS)) {
        options.onReject?.("origin_block", c);
        return c.json(
          { error: "Origin not permitted for Bearer-authenticated request" },
          403,
        );
      }
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
      options.onReject?.("csrf_fail", c);
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
}

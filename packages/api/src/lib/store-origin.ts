/**
 * store-origin.ts — Origin/Referer allow-list check for public `/store/*`
 * POST endpoints.
 *
 * WHY THIS FILE EXISTS:
 * The global CSRF middleware (`csrf-middleware.ts`) intentionally skips
 * `/store/*` because those routes are auth-less — they resolve a business
 * by slug and identify the customer by a Turnstile-gated phone number,
 * never by cookie. A same-origin admin `session_id` cookie would
 * otherwise trip the CSRF gate on real customer checkouts.
 *
 * Exempting `/store/*` from CSRF is correct, but we still want a
 * cross-origin backstop so a hostile page cannot drive-by-submit orders
 * from a victim's browser. This helper is that backstop.
 *
 * PROTECTION LAYERS ON `/store/*` POSTs:
 *   1. Cloudflare Turnstile token (server-side verified).
 *   2. Per-phone rate limit (5/min on `order`).
 *   3. Per-IP rate limit (20/min on both endpoints).
 *   4. Origin/Referer allow-list (this file).
 *
 * RESIDUAL RISK — missing Origin AND Referer:
 * Many mobile browsers and in-app webviews strip both headers. Rejecting
 * such requests would break legitimate customers using Instagram/WhatsApp
 * in-app browsers, JioPages, and several Android WebView embeds. We
 * accept those requests because Turnstile + rate-limit + strict input
 * validation remain in place. Document this trade-off in the code below
 * — do not silently change it without re-evaluating the threat model.
 */

import type { Context } from "hono";
import { logger } from "./logger.js";

export interface StoreOriginOptions {
  /** Explicit allow-list of exact origins (e.g., `https://store.hisaabo.in`). */
  allowedOrigins: string[];
  /** Subdomain wildcards — an entry `hisaabo.in` allows any `*.hisaabo.in` host. */
  allowedSubdomainsOf?: string[];
  /** When true, allow any `http://localhost:*` origin (dev / self-hosted). */
  allowLocalhost?: boolean;
}

/**
 * Parse an `Origin` or `Referer` value into a normalized `scheme://host[:port]`
 * string. Returns `null` when the value is absent, malformed, or uses a
 * scheme other than `http`/`https` (e.g., `file://`, `data:`, `null`).
 */
export function parseOriginLike(value: string | undefined | null): string | null {
  if (!value) return null;
  // `null` appears when a cross-origin request comes from a sandboxed iframe.
  // Treat it as if the header were missing — downstream logic will apply the
  // "both missing → allow" residual-risk branch.
  if (value.trim().toLowerCase() === "null") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // `URL` normalizes host casing and drops trailing slashes on the origin.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Explicit subdomain-match helper. Accepts `host` and a `parent` domain
 * (e.g., `hisaabo.in`). Returns true only when `host` is exactly `parent`
 * OR a sub-label of `parent`. Critically, `example.com.attacker.com` does
 * NOT match `example.com` because we require `host` to END with
 * `.${parent}` and NOT contain a stray label after `parent`.
 */
export function isSubdomainOf(host: string, parent: string): boolean {
  const h = host.toLowerCase();
  const p = parent.toLowerCase();
  if (!h || !p) return false;
  if (h === p) return true;
  // The dot is the label separator — `a.example.com` ends with `.example.com`
  // while `example.com.attacker.com` does NOT (it ends with `.attacker.com`).
  return h.endsWith(`.${p}`);
}

/**
 * Low-level predicate — given an origin string like `https://store.hisaabo.in`
 * and a config, decide whether it is allow-listed.
 */
export function isOriginAllowed(
  origin: string,
  opts: StoreOriginOptions,
): boolean {
  // Exact match against configured allow-list (CORS_ORIGINS etc.).
  if (opts.allowedOrigins.includes(origin)) return true;

  // Subdomain-wildcard allow-list.
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname;

  for (const parent of opts.allowedSubdomainsOf ?? []) {
    if (isSubdomainOf(host, parent)) return true;
  }

  // Non-production: allow any `http://localhost:*`.
  if (opts.allowLocalhost && u.protocol === "http:" && host === "localhost") {
    return true;
  }

  return false;
}

/**
 * Hono-level check: inspect the request's `Origin` (falling back to
 * `Referer`) and return `true` when the caller is trusted.
 *
 * Behaviour:
 *   - Both `Origin` and `Referer` missing → TRUE (documented residual risk;
 *     many mobile browsers strip these).
 *   - `Origin` present and allow-listed → TRUE.
 *   - `Origin` present and NOT allow-listed → FALSE (reject).
 *   - `Origin` missing, `Referer` present → use parsed Referer origin.
 */
export function isAllowedStoreOrigin(
  c: Context,
  opts?: Partial<StoreOriginOptions>,
): boolean {
  const allowedOrigins = opts?.allowedOrigins ?? deriveAllowedOriginsFromEnv();
  const allowedSubdomainsOf = opts?.allowedSubdomainsOf ?? deriveAllowedSubdomainsFromEnv();
  const allowLocalhost = opts?.allowLocalhost ?? (process.env.NODE_ENV !== "production");

  const config: StoreOriginOptions = {
    allowedOrigins,
    allowedSubdomainsOf,
    allowLocalhost,
  };

  const originHeader = c.req.header("origin");
  const refererHeader = c.req.header("referer") ?? c.req.header("referrer");

  const parsedOrigin = parseOriginLike(originHeader) ?? parseOriginLike(refererHeader);

  // Residual-risk branch — both headers stripped. See file header for why
  // we do NOT reject these. Turnstile + rate limits + input validation are
  // the last line of defence.
  if (!parsedOrigin) {
    return true;
  }

  return isOriginAllowed(parsedOrigin, config);
}

/**
 * Read `CORS_ORIGINS` (comma-separated) and `STORE_ALLOWED_ORIGINS`
 * (optional, comma-separated) and merge them into an exact-match list.
 * Both vars may list full origins (e.g., `https://store.hisaabo.in`).
 */
function deriveAllowedOriginsFromEnv(): string[] {
  const out: string[] = [];
  const cors = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const store = (process.env.STORE_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  out.push(...cors, ...store);
  return out;
}

/**
 * `STORE_ALLOWED_SUBDOMAINS_OF` — comma-separated parent domains that
 * accept any subdomain (e.g., `hisaabo.in` covers custom-domain
 * storefronts mapped under the SaaS zone).
 */
function deriveAllowedSubdomainsFromEnv(): string[] {
  return (process.env.STORE_ALLOWED_SUBDOMAINS_OF || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Convenience wrapper used by the route handlers — logs a warning with
 * the offending origin + IP on rejection so abuse is observable.
 */
export function assertAllowedStoreOrigin(
  c: Context,
  clientIp: string,
): { ok: true } | { ok: false; origin: string | null } {
  if (isAllowedStoreOrigin(c)) return { ok: true };
  const origin = c.req.header("origin") ?? c.req.header("referer") ?? null;
  logger.warn(
    { origin, ip: clientIp, path: c.req.path },
    "store origin rejected by allow-list",
  );
  return { ok: false, origin };
}

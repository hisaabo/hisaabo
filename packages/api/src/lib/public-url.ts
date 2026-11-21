/**
 * Resolution of the API's public base URL (used for absolute links embedded in
 * PDFs and store share metadata).
 *
 * `API_PUBLIC_URL` was introduced after v0.9.0 and made mandatory in
 * production. Self-hosted installs upgrading by only pulling the new image keep
 * their old `.env.prod` (which has no such variable), so a missing value must
 * never abort startup. Instead we fall back to the best value we can derive
 * and log a loud WARN once at boot (see `describeApiPublicUrlFallback`).
 *
 * Resolution order:
 *   1. `API_PUBLIC_URL`              — explicit, always wins when set and valid.
 *   2. request origin                — ONLY when the caller opts in with
 *      `trustRequestOrigin` AND (non-production OR the caller is an
 *      authenticated, uncached route). v0.9.0 built the `/pay/upi` link in
 *      invoice/ledger PDFs from `new URL(c.req.url).origin`, so this keeps
 *      those links byte-for-byte compatible. The Host header is attacker
 *      controlled, so public/cacheable routes (store OG image, SEO shell) never
 *      opt in: a poisoned value there could be cached and served to others.
 *   3. `APP_URL`                     — configured by every v0.9.0 install (magic
 *      links). Correct only when the web app and the API share one origin; the
 *      Docker images ship the API alone and the web app is normally hosted
 *      separately, so this usually points at the frontend (only share-preview
 *      metadata is affected).
 *   4. first valid `CORS_ORIGINS` entry — required since v0.9.0, so always
 *      present; same caveat as APP_URL.
 *   5. `http://localhost:<PORT>`     — last resort, never useful in production.
 */

import { logger } from "./logger.js";

export type ApiPublicUrlSource =
  | "API_PUBLIC_URL"
  | "request"
  | "APP_URL"
  | "CORS_ORIGINS"
  | "localhost";

export interface ApiPublicUrl {
  url: string;
  source: ApiPublicUrlSource;
}

export interface ResolveApiPublicUrlOptions {
  /**
   * Origin of the current request (`new URL(c.req.url).origin` or a
   * forwarded-header equivalent). Only consulted when `trustRequestOrigin` is
   * true. See the module comment for when that is acceptable.
   */
  requestOrigin?: string;
  /** Caller vouches the route is authenticated + uncached (or non-production). */
  trustRequestOrigin?: boolean;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/** First comma-separated `CORS_ORIGINS` entry that is a valid http(s) URL. */
function firstCorsOrigin(): string | undefined {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return undefined;
  for (const part of raw.split(",")) {
    const candidate = part.trim();
    if (candidate && isValidHttpUrl(candidate)) return stripTrailingSlashes(candidate);
  }
  return undefined;
}

/**
 * Pure resolver (no logging). Never throws: an invalid `API_PUBLIC_URL` is
 * ignored here — `validateEnv()` is what rejects it in production.
 */
export function resolveApiPublicUrl(opts: ResolveApiPublicUrlOptions = {}): ApiPublicUrl {
  const explicit = process.env.API_PUBLIC_URL?.trim();
  if (explicit && isValidHttpUrl(explicit)) {
    return { url: stripTrailingSlashes(explicit), source: "API_PUBLIC_URL" };
  }

  if (opts.trustRequestOrigin && opts.requestOrigin && isValidHttpUrl(opts.requestOrigin)) {
    return { url: stripTrailingSlashes(opts.requestOrigin), source: "request" };
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && isValidHttpUrl(appUrl)) {
    return { url: stripTrailingSlashes(appUrl), source: "APP_URL" };
  }

  const cors = firstCorsOrigin();
  if (cors) return { url: cors, source: "CORS_ORIGINS" };

  return { url: `http://localhost:${process.env.PORT || "3000"}`, source: "localhost" };
}

let warnedLocalhost = false;

/**
 * The single entry point for consumers. Returns a URL without a trailing slash.
 * Warns (once per process) if it had to fall all the way back to localhost.
 */
export function getApiPublicUrl(opts: ResolveApiPublicUrlOptions = {}): string {
  const resolved = resolveApiPublicUrl(opts);
  if (resolved.source === "localhost" && process.env.NODE_ENV === "production" && !warnedLocalhost) {
    warnedLocalhost = true;
    logger.warn(
      "API_PUBLIC_URL, APP_URL and CORS_ORIGINS are all unset/invalid; absolute links fall back to localhost. Set API_PUBLIC_URL to the API's public https URL.",
    );
  }
  return resolved.url;
}

/**
 * Startup diagnostic for production installs that never set `API_PUBLIC_URL`
 * (every v0.9.0 -> current upgrade without an `.env.prod` edit). Returns the
 * WARN text, or null when `API_PUBLIC_URL` is set.
 */
export function describeApiPublicUrlFallback(): string | null {
  if (process.env.API_PUBLIC_URL?.trim()) return null;
  const { url, source } = resolveApiPublicUrl();
  const fallback =
    source === "localhost"
      ? "http://localhost (APP_URL and CORS_ORIGINS are also unset/invalid, so absolute links will be wrong)"
      : `${url} (from ${source})`;
  return (
    `API_PUBLIC_URL is not set. Falling back to ${fallback}; PDF payment links use the request origin. ` +
    "This works for single-origin deployments but links will be wrong when the API is on a different host than the app. " +
    "Set API_PUBLIC_URL=https://<your-api-host> in your env file (e.g. .env.prod) to silence this warning."
  );
}

/** Test hook: reset the one-shot warning latch. */
export function _resetPublicUrlWarningsForTests(): void {
  warnedLocalhost = false;
}

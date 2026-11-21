/**
 * cors.ts — CORS + cross-origin-policy headers for the API, with a separate
 * public, credential-less policy for the read-only storefront endpoints.
 *
 * Two policies, chosen per request and never layered:
 *
 *  1. Everything else (tRPC, /api/*, store POSTs, the store HTML shell):
 *     credentialed CORS restricted to the operator's own app origins
 *     (`CORS_ORIGINS` + the first-party Tauri webview origins). Unchanged.
 *
 *  2. Public store reads (GET/HEAD/OPTIONS on catalog.json, meta.json, logo,
 *     og.png and item images): `Access-Control-Allow-Origin: *`, no
 *     credentials, whatever the Origin. These responses are public data, so a
 *     third-party website (a business's own site on another domain) can read
 *     the catalog and embed the images from the browser. Operators must NOT
 *     add such a site to `CORS_ORIGINS`: that would grant it credentialed
 *     access to the whole tRPC API.
 *
 * The public policy is a *replacement* for the credentialed middleware on
 * those paths, not an addition. Running both would let the credentialed one
 * echo the Origin and set `Access-Control-Allow-Credentials: true` (and
 * `Vary: Origin`) next to a wildcard. Because the credentialed middleware
 * never runs on a public store read, none of those headers can appear there:
 * the response is identical for every Origin (including none), so shared
 * caches need no `Vary: Origin`.
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

/**
 * The public, read-only store endpoints. Keep this an explicit allow-list: a
 * new route under `/store/*` is credentialed-CORS (i.e. not cross-origin
 * readable) until it is added here on purpose.
 *
 *   /store/:slug/catalog.json
 *   /store/:slug/meta.json
 *   /store/:slug/logo
 *   /store/:slug/og.png
 *   /store/:slug/items/:itemId/images/:imageId
 *
 * `/store/:slug` (the HTML shell) and every POST route are deliberately absent.
 */
const PUBLIC_STORE_READ_PATH =
  /^\/store\/[^/]+\/(?:catalog\.json|meta\.json|logo|og\.png|items\/[^/]+\/images\/[^/]+)$/;

/**
 * Safe methods only; a POST/PUT/etc. to these paths never gets the public
 * policy. The comparison is exact (no case folding), like Hono's own
 * `=== "OPTIONS"` preflight check inside `cors()`, so the two can never
 * disagree about whether a request is a preflight. (The Fetch API already
 * normalises GET/HEAD/OPTIONS to upper case.)
 */
export function isPublicStoreReadRequest(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD" || method === "OPTIONS") && PUBLIC_STORE_READ_PATH.test(path);
}

const publicStoreCors = cors({
  origin: "*",
  // No `credentials`: `*` plus credentials is invalid and would be unsafe.
  allowMethods: ["GET", "HEAD", "OPTIONS"],
  // Pinned, not reflected from Access-Control-Request-Headers: a preflight must
  // not be able to ask for (and be granted) Authorization, x-business-id, etc.
  // These are the only non-safelisted headers a read-only client needs.
  allowHeaders: ["Content-Type", "If-None-Match"],
  maxAge: 86400,
});

/**
 * The global API CORS middleware. `allowedOrigins` is the operator's own app
 * origins; they keep credentialed access everywhere except the public store
 * reads, which get the wildcard policy instead (see file header).
 */
export function createApiCors(allowedOrigins: string[]): MiddlewareHandler {
  const credentialedCors = cors({
    origin: allowedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "x-business-id", "Authorization", "X-Requested-With", "X-Hisaabo-Client"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  });
  return (c: Context, next: Next) =>
    isPublicStoreReadRequest(c.req.method, c.req.path) ? publicStoreCors(c, next) : credentialedCors(c, next);
}

/**
 * Default security headers for the API, except that public store reads are
 * `Cross-Origin-Resource-Policy: cross-origin`. Hono's `secureHeaders()` sets
 * CORP to `same-origin` *after* the handler runs, overriding any value the
 * handler chose, so the exception has to be made here for logo / item-image /
 * og.png bytes to be embeddable (`<img>`) from another site.
 */
export function createApiSecureHeaders(): MiddlewareHandler {
  const defaultHeaders = secureHeaders();
  const publicStoreHeaders = secureHeaders({ crossOriginResourcePolicy: "cross-origin" });
  return (c: Context, next: Next) =>
    isPublicStoreReadRequest(c.req.method, c.req.path) ? publicStoreHeaders(c, next) : defaultHeaders(c, next);
}

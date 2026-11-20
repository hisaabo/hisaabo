/**
 * bearer-client.ts — decides whether a sign-in request comes from a native
 * (non-browser) client that will hold the session as a Bearer token.
 *
 * WHY THIS GATE EXISTS
 * `auth.login | register | verifyMagicLink` mint a session. Browsers get an
 * HttpOnly cookie and must NEVER also receive the raw session id in the JSON
 * body: any script running on the page (XSS, a malicious extension) could read
 * and exfiltrate it, defeating HttpOnly. Native clients (desktop, mobile, CLI)
 * have no cookie jar they control, so for them the token is returned in the
 * body ("bearer client").
 *
 * The decision only selects the session type and whether `sessionToken` is
 * returned. It never relaxes any other check (Turnstile included).
 *
 * TWO SIGNALS
 * 1. Current clients send `X-Hisaabo-Client: desktop | mobile | cli`.
 * 2. DEPRECATED legacy signature (v0.9.0 clients). v0.9.0 returned
 *    `sessionToken` unconditionally, and the v0.9.0 mobile app never sent
 *    `X-Hisaabo-Client`; it sends only `X-Requested-With: hisaabo` (+ Bearer
 *    once signed in) and reads `data.sessionToken`. Requiring the new header
 *    would lock every installed v0.9.0 Android app out of sign-in until the
 *    user updates. So a request is ALSO treated as a native client when ALL of:
 *      - `X-Requested-With: hisaabo`  (what the old app sends), and
 *      - no `Origin` header, and
 *      - none of the `Sec-Fetch-*` headers.
 *
 * WHY THE LEGACY SIGNATURE CANNOT BE PRODUCED BY BROWSER JS
 * - `Origin` and `Sec-Fetch-*` are forbidden header names: page script cannot
 *   set, remove or spoof them; the browser attaches them itself.
 * - Every tRPC mutation (all three procedures above) is a POST, and browsers
 *   always send `Origin` on POST — cross-origin or same-origin, fetch/XHR/form/
 *   beacon — even under `Referrer-Policy: no-referrer` (it is then the literal
 *   string "null", still present). Sec-Fetch-Site/Mode/Dest are sent by every
 *   current browser as well, so a browser has to be missing BOTH to match, which
 *   it never is. Native stacks (OkHttp, NSURLSession, Node fetch, curl) send
 *   neither.
 * - Anyone who can craft such a request outside a browser (curl) already holds
 *   the credential being exchanged (magic-link token / password) — they receive
 *   only their own session. The gate protects against browser-resident scripts,
 *   not against a caller who is the user.
 * - This does not touch CSRF: the CSRF check keys on the cookie / Bearer
 *   `Authorization` header and `X-Requested-With`, none of which this changes.
 *   A request matching the legacy signature authenticates by Bearer token, which
 *   is not an ambient credential. (The cookie path stays protected: a browser
 *   always carries Origin, so it never reaches the bearer branch.)
 *
 * DEPRECATION: remove the legacy signature (`isLegacyV09NativeClient` and its
 * use in `isBearerClient`) in 0.11.0, once v0.9.x apps are no longer supported.
 */

import { logger } from "./logger.js";

const NATIVE_CLIENT_HEADER_VALUES = new Set(["desktop", "mobile", "cli"]);

const BROWSER_ONLY_HEADERS = [
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
] as const;

/**
 * @deprecated v0.9.0 compatibility — remove in 0.11.0.
 * True for the header signature the v0.9.0 mobile app sends (see file comment).
 */
export function isLegacyV09NativeClient(req: Request): boolean {
  const h = req.headers;
  if (h.get("x-requested-with") !== "hisaabo") return false;
  for (const name of BROWSER_ONLY_HEADERS) {
    if (h.has(name)) return false;
  }
  return true;
}

let loggedLegacyClient = false;

/**
 * Returns true when the session being minted will be consumed as a Bearer
 * token rather than a cookie (and `sessionToken` should be returned in the body).
 */
export function isBearerClient(req: Request): boolean {
  const client = req.headers.get("x-hisaabo-client");
  if (client !== null && NATIVE_CLIENT_HEADER_VALUES.has(client)) return true;

  if (isLegacyV09NativeClient(req)) {
    if (!loggedLegacyClient) {
      loggedLegacyClient = true;
      logger.info(
        "Sign-in from a legacy (v0.9.x) native client without X-Hisaabo-Client; treating it as a bearer client. " +
          "This compatibility path is deprecated and will be removed in 0.11.0 — ask users to update the app.",
      );
    }
    return true;
  }
  return false;
}

/** Test hook: reset the one-shot log latch. */
export function _resetLegacyClientLogForTests(): void {
  loggedLegacyClient = false;
}

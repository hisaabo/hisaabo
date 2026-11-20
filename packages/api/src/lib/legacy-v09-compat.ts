/**
 * legacy-v09-compat.ts — compatibility for installed v0.9.x native clients.
 *
 * @deprecated v0.9.0 compatibility. Remove this file, its callers and the
 * `LEGACY_V09_CLIENT_COMPAT` switch in 0.11.0.
 *
 * WHAT BREAKS WITHOUT IT
 * v0.9.0 never required a Cloudflare Turnstile token on `auth.sendMagicLink`
 * (it only verified one when sent), and the v0.9.0 mobile app and the Tauri
 * desktop webview cannot solve a Turnstile challenge. Main requires a token on
 * every `sendMagicLink` whenever `TURNSTILE_SECRET_KEY` is set, which is what
 * `.env.prod.example` ships, so those apps could not request a sign-in link at
 * all after a plain image upgrade. The magic-link email also has to hand the
 * link back to the app (`source=mobile|desktop` on /auth/verify) as v0.9.0 did.
 *
 * WHY THE EXEMPTION IS NARROW
 * A header-based exemption is spoofable by anything that can send HTTP, so it
 * is not a bot defence. It is limited to what v0.9.0 apps could always do and
 * is bounded by server-side limits at the call site (auth.sendMagicLink): only
 * for existing or invited users, at most 10 links per address per 24h, plus the
 * existing per-email (5 / 15 min) and per-IP limits. A browser can never match
 * the exemption: it always sends `Origin` (and `Sec-Fetch-*`), and the Tauri
 * webview's `Origin` is a fixed first-party value that a web page cannot send.
 *
 * KILL SWITCH
 * `LEGACY_V09_CLIENT_COMPAT=false` turns every legacy path off at once: the
 * bearer-client signature, the Turnstile exemption and the handoff `source`.
 */

import { CSRF_TAURI_ORIGINS } from "./csrf-middleware.js";

/** On by default; set `LEGACY_V09_CLIENT_COMPAT=false` to disable all v0.9.x compatibility. */
export function legacyV09CompatEnabled(): boolean {
  return process.env.LEGACY_V09_CLIENT_COMPAT !== "false";
}

const BROWSER_ONLY_HEADERS = [
  "origin",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "sec-fetch-user",
] as const;

/**
 * True for the header signature the v0.9.0 mobile app sends: `X-Requested-With:
 * hisaabo` and none of the headers a browser always attaches (see
 * bearer-client.ts for why browser script cannot produce this). Not gated by
 * the kill switch; callers decide.
 */
export function isLegacyV09NativeClient(req: Request): boolean {
  const h = req.headers;
  if (h.get("x-requested-with") !== "hisaabo") return false;
  for (const name of BROWSER_ONLY_HEADERS) {
    if (h.has(name)) return false;
  }
  return true;
}

/**
 * The v0.9.0 Tauri desktop webview: it sends `X-Hisaabo-Client: desktop` and its
 * `Origin` is one of the fixed first-party webview origins.
 */
export function isTauriDesktopRequest(req: Request): boolean {
  if (req.headers.get("x-hisaabo-client") !== "desktop") return false;
  const origin = req.headers.get("origin");
  return origin !== null && (CSRF_TAURI_ORIGINS as readonly string[]).includes(origin);
}

/** May this tokenless request skip the Turnstile requirement on `sendMagicLink`? */
export function isLegacyCaptchaExempt(req: Request): boolean {
  return legacyV09CompatEnabled() && (isLegacyV09NativeClient(req) || isTauriDesktopRequest(req));
}

/**
 * The `source` to put on the emailed /auth/verify link so the web page can hand
 * the sign-in back to the app: the requested `mobile` | `desktop`, or `desktop`
 * for the Tauri webview (which does not always send it). Null = no suffix.
 */
export function legacyHandoffSource(req: Request, inputSource: string | undefined): "mobile" | "desktop" | null {
  if (!legacyV09CompatEnabled()) return null;
  if (inputSource === "mobile" || inputSource === "desktop") return inputSource;
  if (isTauriDesktopRequest(req)) return "desktop";
  return null;
}

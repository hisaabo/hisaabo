/**
 * Desktop session token bridge — wraps the Tauri IPC commands in
 * `src-tauri/src/session.rs`. Kept deliberately small; the only job is
 * to mirror mobile's `expo-secure-store` API shape (`getTokenSync`,
 * `setToken`, `clearToken`) so the tRPC client can read a Bearer token
 * synchronously on every request without ever touching localStorage.
 *
 * WHY BEARER INSTEAD OF COOKIES ON DESKTOP:
 * The Tauri webview serves the bundled app from `tauri.localhost` and
 * the API lives at `https://api.hisaabo.in` — a different site. The
 * server's `session_id` cookie uses `SameSite=Lax`, which blocks
 * cross-site XHR cookie replay. Relaxing it to `SameSite=None` would
 * expose the web app to CSRF. Bearer tokens sidestep the whole issue:
 * the CSRF middleware already exempts Bearer-authed requests because
 * cross-origin JS cannot forge an `Authorization` header.
 *
 * WHY NOT localStorage:
 * An XSS in the bundle could exfiltrate a token from JS-readable
 * storage. By keeping the canonical copy in the OS keychain (behind the
 * Rust boundary) and only holding an in-memory cache on the JS side,
 * an attacker needs to *also* exploit the IPC layer to get lasting
 * access after the tab reloads.
 *
 * TWO-TOKEN FLOW (desktop only):
 * - Refresh token (session_id): long-lived (7-day sliding / 30-day cap).
 *   Stored in the OS keychain. Only sent to `auth.issueAccessToken`.
 * - Access token (at_*): short-lived (15 min TTL). Held in JS memory only.
 *   Sent as Bearer for every normal API call.
 *
 * `getTokenSync()` returns the cached access token (or null if not yet
 * issued / expired). The tRPC client calls `ensureAccessToken()` before
 * each request to guarantee a fresh access token is in the cache.
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./isDesktop";

// ── Refresh token (long-lived, lives in OS keychain) ──────────────────────

// Synchronous cache so the refresh client can read the token without
// awaiting. Kept as `null` until `hydrateDesktopSession()` populates it
// on app boot (or `setToken` writes a fresh one).
let cachedRefresh: string | null = null;

// ── Access token (short-lived, JS-memory only) ────────────────────────────

// Cached access token with expiry (epoch ms). Null until first issuance.
let cachedAccess: { token: string; expiresAt: number } | null = null;

// In-flight issuance promise — coalesces concurrent ensureAccessToken() calls
// into a single HTTP request.
let inFlightIssuance: Promise<string | null> | null = null;

// Slack before expiry at which we proactively refresh (30 seconds)
const ACCESS_TOKEN_REFRESH_SLACK_MS = 30_000;

/** True iff a refresh token is cached in memory right now. */
export function hasCachedToken(): boolean {
  return cachedRefresh !== null;
}

/**
 * Return the cached ACCESS token synchronously, or `null` if none.
 *
 * Changed semantics vs. the original implementation:
 * - On desktop: returns the SHORT-LIVED access token (at_*), not the
 *   long-lived refresh token. The tRPC client should call
 *   `ensureAccessToken()` before each request to keep this populated.
 * - On web: unchanged — returns null (web uses HttpOnly cookies).
 *
 * Name mirrors `apps/mobile/src/lib/auth.ts::getTokenSync` on purpose —
 * the tRPC header construction path in both apps must be cheap and sync.
 */
export function getTokenSync(): string | null {
  if (!isDesktop()) return null;
  if (!cachedAccess) return null;
  // Return access token if it hasn't expired yet (including slack window)
  if (Date.now() < cachedAccess.expiresAt) {
    return cachedAccess.token;
  }
  return null;
}

/**
 * Load the refresh token from the OS keychain into the in-memory cache.
 * MUST be awaited during app boot before the first authenticated
 * request, otherwise the initial `auth.me` will fire without a token
 * and the user will be bounced to /login despite having a valid session.
 *
 * Non-desktop environments are a no-op — the web app keeps cookies.
 * A keychain failure (e.g. no libsecret on Linux) is swallowed: the
 * user is treated as logged-out and re-authenticates, which matches
 * the "never silently downgrade to plaintext" security posture.
 */
export async function hydrateDesktopSession(): Promise<void> {
  if (!isDesktop()) return;
  try {
    const token = await invoke<string | null>("get_session_token");
    cachedRefresh = token ?? null;
  } catch {
    // Keychain unavailable (headless Linux, locked vault, etc.) —
    // behave as though no token is stored. User will log in again.
    cachedRefresh = null;
  }
}

/**
 * Persist a fresh refresh (session) token. Updates the cache synchronously
 * so the very next tRPC request already carries the Bearer header, then
 * writes through to the OS keychain in the background.
 *
 * If the keychain write fails we still keep the in-memory copy so the
 * current session remains usable; it simply won't survive an app
 * restart. We log to console so a developer can notice.
 *
 * Also clears any stale access token cache since the refresh token changed.
 */
export async function saveDesktopToken(token: string): Promise<void> {
  if (!isDesktop()) return;
  cachedRefresh = token;
  // A new refresh token invalidates any previously issued access token
  cachedAccess = null;
  inFlightIssuance = null;
  try {
    await invoke("save_session_token", { token });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to persist session token to keychain:", err);
  }
}

/**
 * Remove the token both from the cache and the keychain. Used on
 * explicit logout. Errors are swallowed — the user's intent (remove
 * the token) is satisfied by clearing the cache even if the keychain
 * delete fails; the stale row will get overwritten on next login.
 */
export async function clearDesktopToken(): Promise<void> {
  if (!isDesktop()) return;
  cachedRefresh = null;
  cachedAccess = null;
  inFlightIssuance = null;
  try {
    await invoke("clear_session_token");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to clear session token from keychain:", err);
  }
}

// ── Access token management ───────────────────────────────────────────────

/**
 * A separate raw-fetch client that calls `auth.issueAccessToken` using the
 * REFRESH token (from the keychain), not the access token. This avoids the
 * circular dependency: the main tRPC client calls `getTokenSync()` for its
 * Bearer header — which returns the access token — but `issueAccessToken`
 * needs to be called with the refresh token. Using a plain `fetch` here
 * completely decouples the two.
 *
 * Token-source separation: the refresh client reads `cachedRefresh` directly
 * (the keychain-backed long-lived token), never `cachedAccess`.
 */
async function callIssueAccessToken(): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const refreshToken = cachedRefresh;
  if (!refreshToken) return null;

  const TRPC_URL = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_URL
    ? `${(import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL}/api/trpc`
    : "/api/trpc";

  try {
    const response = await fetch(`${TRPC_URL}/auth.issueAccessToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${refreshToken}`,
        "X-Requested-With": "hisaabo",
        "X-Hisaabo-Client": "desktop",
      },
      credentials: "omit",
      body: JSON.stringify({ "0": { json: null } }),
    });

    if (!response.ok) return null;

    const envelope = await response.json() as {
      result?: { data?: { json?: { accessToken: string; expiresAt: string } } };
    };
    const result = envelope?.result?.data?.json;
    if (!result?.accessToken) return null;

    return {
      accessToken: result.accessToken,
      expiresAt: new Date(result.expiresAt),
    };
  } catch {
    return null;
  }
}

/**
 * Ensure a valid access token is cached and return it. This is the key
 * method the tRPC client's async headers() calls before every request.
 *
 * Logic:
 *   1. If cached access token has >30s left, return it (no network call).
 *   2. Otherwise, call `auth.issueAccessToken` using the refresh token.
 *   3. Concurrent calls coalesce into a single HTTP request via promise
 *      memoization (inFlightIssuance).
 *   4. On failure, return null — the tRPC request will proceed without
 *      a token (resulting in a 401 that the error handler can retry).
 */
export async function ensureAccessToken(): Promise<string | null> {
  if (!isDesktop()) return null;
  if (!cachedRefresh) return null;

  // Check if cached access token is still fresh (with slack)
  if (cachedAccess && Date.now() < cachedAccess.expiresAt - ACCESS_TOKEN_REFRESH_SLACK_MS) {
    return cachedAccess.token;
  }

  // Coalesce concurrent callers — only one issuance request in flight at a time
  if (inFlightIssuance) {
    return inFlightIssuance;
  }

  inFlightIssuance = callIssueAccessToken().then((result) => {
    inFlightIssuance = null;
    if (!result) {
      cachedAccess = null;
      return null;
    }
    cachedAccess = {
      token: result.accessToken,
      expiresAt: result.expiresAt.getTime(),
    };
    return result.accessToken;
  }).catch(() => {
    inFlightIssuance = null;
    cachedAccess = null;
    return null;
  });

  return inFlightIssuance;
}

// Exposed for testing only — resets module-level state between tests
export function _resetForTests(): void {
  cachedRefresh = null;
  cachedAccess = null;
  inFlightIssuance = null;
}

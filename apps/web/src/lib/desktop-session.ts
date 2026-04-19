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
 */

import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./isDesktop";

// Synchronous cache so `tRPC.headers()` can read the token without
// awaiting. Kept as `null` until `hydrateDesktopSession()` populates it
// on app boot (or `setToken` writes a fresh one).
let cached: string | null = null;

/** True iff a session token is cached in memory right now. */
export function hasCachedToken(): boolean {
  return cached !== null;
}

/**
 * Return the cached token synchronously, or `null` if none.
 * Name mirrors `apps/mobile/src/lib/auth.ts::getTokenSync` on purpose —
 * the tRPC header construction path in both apps must be cheap and sync.
 */
export function getTokenSync(): string | null {
  return cached;
}

/**
 * Load the token from the OS keychain into the in-memory cache.
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
    cached = token ?? null;
  } catch {
    // Keychain unavailable (headless Linux, locked vault, etc.) —
    // behave as though no token is stored. User will log in again.
    cached = null;
  }
}

/**
 * Persist a fresh session token. Updates the cache synchronously so
 * the very next tRPC request already carries the Bearer header, then
 * writes through to the OS keychain in the background.
 *
 * If the keychain write fails we still keep the in-memory copy so the
 * current session remains usable; it simply won't survive an app
 * restart. We log to console so a developer can notice.
 */
export async function saveDesktopToken(token: string): Promise<void> {
  if (!isDesktop()) return;
  cached = token;
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
  cached = null;
  try {
    await invoke("clear_session_token");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Failed to clear session token from keychain:", err);
  }
}

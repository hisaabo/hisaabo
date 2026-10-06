/**
 * Hand-off state for the browser sign-in flow used by native clients.
 *
 * `/auth/native?request=<id>` may need the visitor to sign in first, which
 * navigates away (and, for magic links, can open a different tab). The pending
 * request id is therefore kept in sessionStorage, mirrored to localStorage
 * with a short expiry so a magic link opened in a new tab can resume it.
 */

const KEY = "nativeAuthRequest";
const MAX_AGE_MS = 10 * 60 * 1000;
const REQUEST_ID_RE = /^[0-9a-fA-F-]{32,40}$/;

export function isValidNativeRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

export function stashNativeRequest(requestId: string): void {
  if (!isValidNativeRequestId(requestId)) return;
  try {
    sessionStorage.setItem(KEY, requestId);
  } catch {
    // storage unavailable
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ id: requestId, at: Date.now() }));
  } catch {
    // storage unavailable
  }
}

export function peekNativeRequest(): string | null {
  try {
    const fromSession = sessionStorage.getItem(KEY);
    if (isValidNativeRequestId(fromSession)) return fromSession;
  } catch {
    // storage unavailable
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (
      isValidNativeRequestId(parsed.id) &&
      typeof parsed.at === "number" &&
      Date.now() - parsed.at < MAX_AGE_MS
    ) {
      return parsed.id;
    }
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable or malformed
  }
  return null;
}

export function clearNativeRequest(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

/** Request id from `?request=` on the current URL, when well-formed. */
export function nativeRequestFromUrl(search: string): string | null {
  const value = new URLSearchParams(search).get("request");
  return isValidNativeRequestId(value) ? value : null;
}

/** Only loopback or https redirects are ever followed. */
export function isSafeNativeRedirect(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1:\d{4,5}\//.test(url) || /^https:\/\/[^/@\s]+\//.test(url);
}

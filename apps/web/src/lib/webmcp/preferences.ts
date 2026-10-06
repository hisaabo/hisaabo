/**
 * User-level switch for browser-agent (WebMCP) access.
 *
 * Default OFF (opt-in): the browser's AI agent sees Hisaabo tools only after
 * the user turns it on in Settings → Account. Only an explicit "on" (or the
 * legacy "true") counts; a missing key, the old "off" marker, or any other
 * value means disabled, so users who never enabled it are migrated to off.
 * Stored per browser in localStorage; wrapped in try/catch because storage
 * can be unavailable (private mode, blocked site data).
 */

export const WEBMCP_PREF_KEY = "hisaabo-webmcp";
export const WEBMCP_PREF_EVENT = "hisaabo:webmcp-preference";

export function isAgentAccessEnabled(): boolean {
  try {
    const stored = localStorage.getItem(WEBMCP_PREF_KEY);
    return stored === "on" || stored === "true";
  } catch {
    return false;
  }
}

export function setAgentAccessEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(WEBMCP_PREF_KEY, "on");
    else localStorage.removeItem(WEBMCP_PREF_KEY);
  } catch {
    // storage unavailable — in-memory listeners still get the event
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WEBMCP_PREF_EVENT, { detail: { enabled } }));
  }
}

/** Subscribe to preference changes; returns an unsubscribe function. */
export function subscribeAgentAccess(listener: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(isAgentAccessEnabled());
  window.addEventListener(WEBMCP_PREF_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(WEBMCP_PREF_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/**
 * User-level switch for browser-agent (WebMCP) access.
 *
 * Default ON: once signed in, the browser's AI agent can see Hisaabo tools.
 * The user can turn it off in Settings → Account. Stored per browser in
 * localStorage (same pattern as the theme preference); wrapped in try/catch
 * because storage can be unavailable (private mode, blocked site data).
 */

export const WEBMCP_PREF_KEY = "hisaabo-webmcp";
export const WEBMCP_PREF_EVENT = "hisaabo:webmcp-preference";

export function isAgentAccessEnabled(): boolean {
  try {
    return localStorage.getItem(WEBMCP_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAgentAccessEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(WEBMCP_PREF_KEY);
    else localStorage.setItem(WEBMCP_PREF_KEY, "off");
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

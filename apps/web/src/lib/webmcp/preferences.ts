/**
 * User-level switch for browser-agent (WebMCP) access.
 *
 * Default OFF (opt-in): the browser's AI agent sees Hisaabo tools only after the
 * user turns it on in Settings → Account.
 *
 * SCOPE. The switch belongs to a person in an organization, not to a browser
 * profile: it is stored under `hisaabo-webmcp:<userId>:<tenantId>`. A second
 * person who signs in on the same browser (a shared office PC, a family laptop)
 * therefore starts with it OFF, and so does the same person in another
 * organization. Without a scope (not signed in) it is always off.
 *
 * MIGRATION. Earlier builds stored one key, `hisaabo-webmcp`, per
 * browser. Whoever turned it on was the "owner" of nothing in particular, so
 * that value is NOT carried over: the legacy key is deleted the first time the
 * preference is read and everyone starts from off. Only an explicit "on" under
 * the scoped key counts; a missing key, "off" or anything else is off.
 *
 * Wrapped in try/catch throughout because storage can be unavailable (private
 * mode, blocked site data); that fails closed.
 */

import { resetWriteBudget } from "./budget";

/** The browser-wide key earlier builds used. Never read as a preference; only removed. */
export const LEGACY_WEBMCP_PREF_KEY = "hisaabo-webmcp";
export const WEBMCP_PREF_PREFIX = "hisaabo-webmcp:";
export const WEBMCP_PREF_EVENT = "hisaabo:webmcp-preference";

/** Who the preference belongs to. `tenantId` is null only before an organization is selected. */
export interface AgentPreferenceScope {
  userId: string;
  tenantId: string | null;
}

/** The localStorage key for one person in one organization. */
export function agentPreferenceKey(scope: AgentPreferenceScope): string {
  return `${WEBMCP_PREF_PREFIX}${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.tenantId ?? "-")}`;
}

/** Delete the browser-wide key of earlier versions. Idempotent; the legacy value is deliberately not honoured. */
function retireLegacyPreference(): void {
  try {
    if (localStorage.getItem(LEGACY_WEBMCP_PREF_KEY) !== null) localStorage.removeItem(LEGACY_WEBMCP_PREF_KEY);
  } catch {
    // storage unavailable: nothing to retire, and nothing can be read as "on" either
  }
}

export function isAgentAccessEnabled(scope: AgentPreferenceScope | null | undefined): boolean {
  if (!scope) return false;
  retireLegacyPreference();
  try {
    return localStorage.getItem(agentPreferenceKey(scope)) === "on";
  } catch {
    return false;
  }
}

export function setAgentAccessEnabled(scope: AgentPreferenceScope | null | undefined, enabled: boolean): void {
  if (!scope) return;
  retireLegacyPreference();
  // Turning it on is the deliberate act that starts a fresh write budget.
  if (enabled) resetWriteBudget();
  try {
    if (enabled) localStorage.setItem(agentPreferenceKey(scope), "on");
    else localStorage.removeItem(agentPreferenceKey(scope));
  } catch {
    // storage unavailable: in-memory listeners still get the event
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WEBMCP_PREF_EVENT, { detail: { enabled } }));
  }
}

/** Subscribe to changes of one scope's preference (this tab's toggles and other tabs' writes); returns an unsubscribe function. */
export function subscribeAgentAccess(
  scope: AgentPreferenceScope | null | undefined,
  listener: (enabled: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(isAgentAccessEnabled(scope));
  window.addEventListener(WEBMCP_PREF_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(WEBMCP_PREF_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

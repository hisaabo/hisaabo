/**
 * Browser AI agents (WebMCP) — user switch.
 *
 * Kept free of tRPC so it can be rendered from AccountTab and tested in
 * isolation: the caller passes who is signed in and whether the operator or the
 * organization owner has turned the feature off. The preference itself lives in
 * `@/lib/webmcp/preferences`, stored per person per organization in localStorage
 * (a second person on the same browser starts from off); the WebMCP runtime
 * subscribes to the same event and registers/unregisters tools when this flips.
 *
 * Two outside switches override the personal one:
 *   - the operator's `WEBMCP_DISABLED` environment variable (the whole server), and
 *   - the organization owner's setting (see OrgBrowserAgentPolicy).
 * When either is set the switch is shown off and cannot be turned on, and says why.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { isDesktop } from "@/lib/isDesktop";
import {
  isAgentAccessEnabled,
  setAgentAccessEnabled,
  type AgentPreferenceScope,
} from "@/lib/webmcp/preferences";
import { isWebMcpAvailable } from "@/lib/webmcp/runtime";

interface BrowserAgentSectionProps {
  /** The signed-in person and organization; null while the session is loading. */
  scope: AgentPreferenceScope | null;
  /** The operator turned agents off for this server (`WEBMCP_DISABLED=true`). */
  operatorDisabled?: boolean;
  /** The organization's owner turned agents off for everyone in it. */
  orgDisabled?: boolean;
}

export function BrowserAgentSection({ scope, operatorDisabled = false, orgDisabled = false }: BrowserAgentSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const desktop = isDesktop();

  const userId = scope?.userId ?? null;
  const tenantId = scope?.tenantId ?? null;

  // Read after mount: localStorage and document.modelContext are browser-only,
  // and starting from a fixed value keeps the first paint stable. Re-read when the
  // person or organization changes: the value is theirs, not the browser's.
  useEffect(() => {
    setEnabled(isAgentAccessEnabled(userId ? { userId, tenantId } : null));
    setSupported(isWebMcpAvailable());
  }, [userId, tenantId]);

  const blocked = operatorDisabled || orgDisabled || desktop || !scope;
  const shownOn = enabled && !blocked;

  function handleToggle() {
    if (blocked) return;
    const next = !enabled;
    setEnabled(next);
    setAgentAccessEnabled(scope, next);
  }

  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Browser AI agents</h3>
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <label
            htmlFor="webmcp-toggle"
            className={cn("text-sm font-medium text-text-primary", blocked ? "cursor-not-allowed" : "cursor-pointer")}
          >
            Allow this browser&rsquo;s AI agent to use Hisaabo
          </label>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            Off by default. When on, AI features built into Chrome or Edge can read your data
            and create invoices, parties, items, payments and expenses on your behalf, with the
            same permissions as your account. Every action that changes data asks for your
            confirmation first. Stored for your account in this browser, so someone else who
            signs in here starts with it off.
          </p>
          {operatorDisabled && (
            <p className="text-xs text-text-tertiary mt-2" role="note">
              Browser AI agents are turned off for this server by its administrator.
            </p>
          )}
          {!operatorDisabled && orgDisabled && (
            <p className="text-xs text-text-tertiary mt-2" role="note">
              Browser AI agents are turned off for your organization by its owner.
            </p>
          )}
          {desktop && (
            <p className="text-xs text-text-tertiary mt-2" role="note">
              Browser AI agents are not available in the desktop app. Use the web app in a supported browser.
            </p>
          )}
          {!supported && !desktop && (
            <p className="text-xs text-text-tertiary mt-2">
              Your browser does not support WebMCP yet.
            </p>
          )}
        </div>
        <button
          id="webmcp-toggle"
          type="button"
          role="switch"
          aria-checked={shownOn}
          aria-disabled={blocked || undefined}
          disabled={blocked}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors",
            blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            shownOn ? "bg-brand-600" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5",
              shownOn ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

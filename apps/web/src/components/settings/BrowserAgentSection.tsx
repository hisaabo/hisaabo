/**
 * Browser AI agents (WebMCP) — user switch.
 *
 * Kept as its own component (no tRPC, no props) so it can be rendered from
 * AccountTab and tested in isolation. The preference itself lives in
 * `@/lib/webmcp/preferences` and is stored per browser in localStorage; the
 * WebMCP runtime subscribes to the same event and registers/unregisters tools
 * when this flips.
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { isAgentAccessEnabled, setAgentAccessEnabled } from "@/lib/webmcp/preferences";

/** True when this browser exposes the WebMCP API on either known surface. */
function detectWebMcpSupport(): boolean {
  if (typeof document === "undefined") return false;
  if (document.modelContext) return true;
  return typeof navigator !== "undefined" && !!navigator.modelContext;
}

export function BrowserAgentSection() {
  const [enabled, setEnabled] = useState(true);
  const [supported, setSupported] = useState(true);

  // Read after mount: localStorage and document.modelContext are browser-only,
  // and starting from a fixed value keeps the first paint stable.
  useEffect(() => {
    setEnabled(isAgentAccessEnabled());
    setSupported(detectWebMcpSupport());
  }, []);

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    setAgentAccessEnabled(next);
  }

  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Browser AI agents</h3>
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <label
            htmlFor="webmcp-toggle"
            className="text-sm font-medium text-text-primary cursor-pointer"
          >
            Allow this browser&rsquo;s AI agent to use Hisaabo
          </label>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            When on, AI features built into Chrome or Edge can read your data and create
            invoices, parties, items, payments and expenses on your behalf, with the same
            permissions as your account. Actions that change data ask for your confirmation.
            Stored per browser.
          </p>
          {!supported && (
            <p className="text-xs text-text-tertiary mt-2">
              Your browser does not support WebMCP yet.
            </p>
          )}
        </div>
        <button
          id="webmcp-toggle"
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors cursor-pointer",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            enabled ? "bg-brand-600" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5",
              enabled ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

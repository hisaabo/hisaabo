/**
 * Browser AI agents — the organization owner's switch.
 *
 * Turning it off means the web app never registers WebMCP tools for ANYONE in the
 * organization, whatever their personal preference says. Only owners see it; the
 * API refuses everyone else (tenant.setWebMcpDisabled). Presentational on purpose:
 * AccountTab owns the query and the mutation.
 */

import { cn } from "@/lib/utils";

interface OrgBrowserAgentPolicyProps {
  /** True when agents are currently turned off for the whole organization. */
  disabled: boolean;
  /** True while the change is being saved. */
  saving?: boolean;
  /** The operator turned agents off for the whole server, so this switch has no effect. */
  operatorDisabled?: boolean;
  onChange: (disabled: boolean) => void;
}

export function OrgBrowserAgentPolicy({ disabled, saving = false, operatorDisabled = false, onChange }: OrgBrowserAgentPolicyProps) {
  const allowed = !disabled;
  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Browser AI agents for your organization</h3>
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1 min-w-0">
          <label htmlFor="webmcp-org-toggle" className="text-sm font-medium text-text-primary cursor-pointer">
            Allow members to use browser AI agents
          </label>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">
            Each member still chooses for themselves, and every change an agent makes still asks them to
            confirm first. Turn this off to stop the web app offering Hisaabo to anyone&rsquo;s browser AI
            agent in this organization. Only the owner can change it.
          </p>
          {operatorDisabled && (
            <p className="text-xs text-text-tertiary mt-2" role="note">
              This server&rsquo;s administrator has turned browser AI agents off for everyone, so this
              setting has no effect for now.
            </p>
          )}
        </div>
        <button
          id="webmcp-org-toggle"
          type="button"
          role="switch"
          aria-checked={allowed}
          disabled={saving}
          onClick={() => onChange(allowed)}
          className={cn(
            "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors cursor-pointer",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
            saving && "opacity-60",
            allowed ? "bg-brand-600" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5",
              allowed ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

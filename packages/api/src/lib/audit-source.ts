/**
 * Where an audited change came from, when it was not a person at the UI.
 *
 *   webmcp  a browser AI agent acting through WebMCP in the user's own tab
 *           (apps/web sends `x-hisaabo-agent: webmcp` on those calls only)
 *   mcp     the `@hisaabo/mcp` server (it sends `x-client-type: mcp`)
 *
 * IMPORTANT: this is ATTRIBUTION, not authorisation. Both headers are supplied
 * by the client, so a caller can claim to be an agent (or not). That is fine for
 * what the column is for, telling the owner "this one was the agent's doing" in
 * the activity log, and it is the reason nothing in the API grants, withholds or
 * rate-limits anything on the strength of an audit source: permissions come from
 * the session role and the business membership, exactly as for a click.
 *
 * Deliberately NOT `x-hisaabo-client`: that header has meaning for auth (it lets
 * the desktop app skip Turnstile) and must not double as an attribution label.
 */

export const AGENT_HEADER = "x-hisaabo-agent";

export type AuditSource = "webmcp" | "mcp";

/** The headers we read, in the case-insensitive form `Headers#get` accepts. */
type HeaderReader = { get(name: string): string | null };

export function auditSourceFromHeaders(headers: HeaderReader): AuditSource | null {
  if (headers.get(AGENT_HEADER)?.trim().toLowerCase() === "webmcp") return "webmcp";
  if (headers.get("x-client-type")?.trim().toLowerCase() === "mcp") return "mcp";
  return null;
}

/** True when the request says it was made by a browser AI agent (drives the separate rate-limit bucket). */
export function isAgentRequest(headers: HeaderReader): boolean {
  return headers.get(AGENT_HEADER)?.trim().toLowerCase() === "webmcp";
}

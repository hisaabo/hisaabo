/**
 * Operator-level control of browser AI agent (WebMCP) access.
 *
 * `WEBMCP_DISABLED=true` is the operator's kill switch: the web app is told
 * (system.config -> `webmcpDisabled`) never to register agent tools for anyone on
 * this server, and the API additionally refuses requests that identify themselves
 * as browser-agent calls (`x-hisaabo-agent: webmcp`, see lib/audit-source.ts).
 *
 * The refusal is a second layer, not the boundary: the marker is client-supplied,
 * so a caller can omit it, and an agent-less caller is just a signed-in user. The
 * real boundaries are the session, the role and the business membership, which
 * apply to every call whatever it says about itself. What the kill switch really
 * controls is whether the web app exposes the tools to a browser agent at all.
 *
 * The per-organization switch (tenants.webmcp_disabled, set by the owner) is
 * enforced by the web app the same way, via auth.me.
 */

import { isAgentRequest } from "./audit-source.js";

export function isWebMcpDisabledByOperator(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test((env.WEBMCP_DISABLED ?? "").trim());
}

export const WEBMCP_DISABLED_MESSAGE = "Browser AI agent access is disabled on this server";

/**
 * True when the request must be refused because the operator switched browser
 * agents off AND the request says it is a browser-agent call. Requests that do not
 * carry the marker are never affected: they are ordinary signed-in clients.
 */
export function shouldRefuseAgentRequest(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isWebMcpDisabledByOperator(env) && isAgentRequest(headers);
}

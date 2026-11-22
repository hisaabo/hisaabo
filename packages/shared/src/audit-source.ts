/**
 * Where an audited change came from, when it was not a person at the UI:
 *   webmcp  a browser AI agent (header x-hisaabo-agent: webmcp)
 *   mcp     the MCP server (header x-client-type: mcp)
 * Attribution only, never authorisation; see packages/api/src/lib/audit-source.ts.
 * The list lives here so the API, the audit column and the self-export row schema
 * share one definition.
 */
export const auditSources = ["webmcp", "mcp"] as const;
export type AuditSource = (typeof auditSources)[number];

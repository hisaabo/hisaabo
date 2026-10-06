/**
 * Tool exposure policy — which tiers of tools this server instance registers.
 *
 *   HISAABO_MCP_MODE          readonly (default) | write | admin
 *   HISAABO_MCP_ENABLE_ADMIN  must be "1" in addition to mode=admin to expose admin-tier tools
 */

export const MCP_MODES = ["readonly", "write", "admin"] as const;
export type McpMode = (typeof MCP_MODES)[number];

export interface ToolPolicy {
  mode: McpMode;
  adminEnabled: boolean;
}

export function resolvePolicy(env: NodeJS.ProcessEnv = process.env): ToolPolicy {
  const raw = (env.HISAABO_MCP_MODE ?? "readonly").trim().toLowerCase();
  if (!(MCP_MODES as readonly string[]).includes(raw)) {
    throw new Error(`HISAABO_MCP_MODE must be one of ${MCP_MODES.join(", ")} (got "${raw}").`);
  }
  const mode = raw as McpMode;
  return { mode, adminEnabled: mode === "admin" && env.HISAABO_MCP_ENABLE_ADMIN === "1" };
}

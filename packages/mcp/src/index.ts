#!/usr/bin/env node
/**
 * Hisaabo MCP Server
 *
 * Exposes Hisaabo invoicing data and operations as MCP tools and resources.
 * Designed for use with Claude Desktop, OpenClaw, and any MCP-compatible host.
 *
 * Required environment variables:
 *   HISAABO_API_URL     — Base URL of the Hisaabo API (default: http://localhost:3000)
 *   HISAABO_API_KEY     — API key (hisaabo_key_...) used as the Bearer token
 *   HISAABO_TENANT_ID   — Tenant (organization) UUID
 *   HISAABO_BUSINESS_ID — Active business UUID
 *
 * Optional environment variables:
 *   HISAABO_MCP_MODE          — readonly (default) | write | admin
 *   HISAABO_MCP_ENABLE_ADMIN  — "1" to expose admin-tier tools (with mode=admin)
 *   HISAABO_ALLOW_INSECURE    — "1" to allow plain http:// to a non-loopback host
 *   HISAABO_ALLOW_SESSION_TOKEN — "1" to accept a non-API-key session token
 *   HISAABO_MCP_MAX_FIELD_LENGTH — max chars per string field in results (default 500)
 *
 * Usage in Claude Desktop claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "hisaabo": {
 *         "command": "npx",
 *         "args": ["@hisaabo/mcp"],
 *         "env": {
 *           "HISAABO_API_URL": "http://localhost:3000",
 *           "HISAABO_API_KEY": "<hisaabo_key_...>",
 *           "HISAABO_TENANT_ID": "<tenant-uuid>",
 *           "HISAABO_BUSINESS_ID": "<business-uuid>"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HisaaboClient } from "./client.js";
import { registerTools } from "./server.js";
import { validateApiUrl, validateToken } from "./lib/config.js";
import { resolvePolicy } from "./lib/policy.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    process.stderr.write(
      `[hisaabo-mcp] Error: Required environment variable "${name}" is not set.\n` +
      `[hisaabo-mcp] Run "hisaabo whoami --json" to get all required values.\n`
    );
    process.exit(1);
  }
  return val;
}

function fail(message: string): never {
  process.stderr.write(`[hisaabo-mcp] Error: ${message}\n`);
  process.exit(1);
}

function load<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

const config = {
  apiUrl: load(() => validateApiUrl(process.env.HISAABO_API_URL ?? "http://localhost:3000")),
  token: load(() => validateToken(requireEnv("HISAABO_API_KEY"))),
  tenantId: requireEnv("HISAABO_TENANT_ID"),
  businessId: requireEnv("HISAABO_BUSINESS_ID"),
};
const policy = load(() => resolvePolicy());

declare const __MCP_VERSION__: string | undefined;
const mcpVersion = typeof __MCP_VERSION__ !== "undefined" ? __MCP_VERSION__ : "dev";

const client = new HisaaboClient(config);
const server = new McpServer({
  name: "hisaabo",
  version: mcpVersion,
});

const registry = registerTools(server, client, policy);
process.stderr.write(
  `[hisaabo-mcp] mode=${policy.mode}${policy.mode === "admin" && !policy.adminEnabled ? " (admin tools disabled: set HISAABO_MCP_ENABLE_ADMIN=1)" : ""}, ` +
  `${registry.registered.length} tools registered, ${registry.skipped.length} withheld.\n`,
);

const transport = new StdioServerTransport();
await server.connect(transport);

// Graceful shutdown — close MCP connection before exiting
const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

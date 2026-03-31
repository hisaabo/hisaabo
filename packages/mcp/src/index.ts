#!/usr/bin/env node
/**
 * Hisaabo MCP Server
 *
 * Exposes Hisaabo invoicing data and operations as MCP tools and resources.
 * Designed for use with Claude Desktop, OpenClaw, and any MCP-compatible host.
 *
 * Required environment variables:
 *   HISAABO_API_URL     — Base URL of the Hisaabo API (default: http://localhost:3000)
 *   HISAABO_API_KEY       — Session ID obtained from `hisaabo login` (Bearer token)
 *   HISAABO_TENANT_ID   — Tenant (organization) UUID
 *   HISAABO_BUSINESS_ID — Active business UUID
 *
 * Usage in Claude Desktop claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "hisaabo": {
 *         "command": "npx",
 *         "args": ["@hisaabo/mcp"],
 *         "env": {
 *           "HISAABO_API_URL": "http://localhost:3000",
 *           "HISAABO_API_KEY": "<session-id-from-hisaabo-login>",
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

const config = {
  apiUrl: process.env.HISAABO_API_URL ?? "http://localhost:3000",
  token: requireEnv("HISAABO_API_KEY"),
  tenantId: requireEnv("HISAABO_TENANT_ID"),
  businessId: requireEnv("HISAABO_BUSINESS_ID"),
};

const client = new HisaaboClient(config);
const server = new McpServer({
  name: "hisaabo",
  version: "0.1.0",
});

registerTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);

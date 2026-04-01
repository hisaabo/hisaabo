/**
 * API key tools — manage programmatic access credentials.
 *
 * Tools registered:
 *   api_key_list   — list all API keys for the current user
 *   api_key_create — create a new API key (shown exactly once)
 *   api_key_revoke — permanently revoke an API key
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerApiKeyTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "api_key_list",
    [
      "List all API keys belonging to the current user within the active tenant.",
      "Returns display-safe metadata only — never the full key or its hash.",
      "Use keyPrefix to identify which key is which. Check expiresAt to find keys that need renewal.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const result = await client.apiKey.list();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "api_key_create",
    [
      "Create a new API key for programmatic access to the Hisaabo API.",
      "The full key is returned exactly once in this response — it is never stored in plain text and cannot be retrieved again.",
      "Save the key immediately after creation. API keys are available on paid plans only.",
      "Optionally set an expiry date (ISO 8601) to create a time-limited key.",
    ].join(" "),
    {
      name: z.string().min(1).max(100)
        .describe("Descriptive name to identify this key, e.g. 'CI/CD Pipeline', 'Accounting Bot'."),
      expires_at: z.string().datetime().optional()
        .describe("Optional expiry date for the key (ISO 8601). Omit to create a non-expiring key."),
    },
    wrapTool(async (input) => {
      const result = await client.apiKey.create({
        name: input.name,
        expiresAt: input.expires_at,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...result,
            warning: "Save this key immediately — it will not be shown again.",
          }, null, 2),
        }],
      };
    })
  );

  server.tool(
    "api_key_revoke",
    [
      "Permanently revoke (delete) an API key by its ID.",
      "Revoked keys stop working immediately. This action cannot be undone.",
      "Use api_key_list to find the ID of the key you want to revoke.",
    ].join(" "),
    {
      key_id: z.string().uuid()
        .describe("UUID of the API key to revoke. Use api_key_list to find key IDs."),
    },
    wrapTool(async (input) => {
      const result = await client.apiKey.revoke(input.key_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}

/**
 * Session tools — view and manage active browser/API sessions.
 *
 * Tools registered:
 *   session_list   — list active or expired sessions for the current user
 *   session_revoke — terminate a specific session by ID
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerSessionTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "session_list",
    [
      "List active browser/API sessions for the current user.",
      "Shows device info, IP address, last activity time, and whether it is the current session.",
      "Set expired to true to list expired/old sessions instead of active ones.",
    ].join(" "),
    {
      expired: z.boolean().default(false)
        .describe("Set to true to list expired/old sessions instead of active ones."),
    },
    wrapTool(async (input) => {
      const sessions = await client.auth.listSessions(input.expired);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(sessions, null, 2),
        }],
      };
    })
  );

  server.tool(
    "session_revoke",
    [
      "Revoke/terminate a specific session by its ID.",
      "Cannot revoke the current session.",
      "Use session_list to find session IDs.",
    ].join(" "),
    {
      session_id: z.string().min(1)
        .describe("The session ID to revoke. Use session_list to find session IDs."),
    },
    wrapTool(async (input) => {
      await client.auth.revokeSession(input.session_id);
      return {
        content: [{
          type: "text" as const,
          text: "Session revoked successfully.",
        }],
      };
    })
  );
}

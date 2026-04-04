/**
 * Audit trail tools — query the activity log for the current business.
 *
 * Tools registered:
 *   business_audit_trail — paginated activity/audit log with optional date filters
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerAuditTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "business_audit_trail",
    [
      "Query the activity/audit log for the current business.",
      "Returns actions like invoice creation, payment recording, party updates, etc. with the user who performed each action.",
      "Supports pagination and optional date range filtering.",
    ].join(" "),
    {
      page: z.number().int().min(1).default(1)
        .describe("Page number (starts at 1)."),
      limit: z.number().int().min(1).max(100).default(50)
        .describe("Items per page (max 100)."),
      from_date: z.string().datetime().optional()
        .describe("Filter: only entries after this ISO 8601 datetime."),
      to_date: z.string().datetime().optional()
        .describe("Filter: only entries before this ISO 8601 datetime."),
    },
    wrapTool(async (input) => {
      const result = await client.business.auditTrail({
        page: input.page,
        limit: input.limit,
        fromDate: input.from_date,
        toDate: input.to_date,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}

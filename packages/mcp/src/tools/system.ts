/**
 * System tools — check maintenance status and system health.
 *
 * Tools registered:
 *   system_maintenance_status — check if the API is under maintenance
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerSystemTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "system_maintenance_status",
    [
      "Check if the Hisaabo API is currently under maintenance.",
      "Returns maintenance status including whether it is active, the operator message, and estimated end time.",
      "When maintenance is active, all data operations will be unavailable — retry after the estimated end time.",
    ].join(" "),
    {},
    wrapTool(async () => {
      const status = await client.system.maintenanceStatus();

      if (status.enabled) {
        // Return as error so the AI agent knows the service is unavailable (503 equivalent)
        const parts = ["503 Service Unavailable: System is under maintenance."];
        if (status.message) parts.push(status.message);
        if (status.endsAt) parts.push(`Estimated end: ${new Date(status.endsAt).toISOString()}`);
        parts.push("All data operations are blocked. Retry after maintenance ends.");

        return {
          isError: true,
          content: [{
            type: "text" as const,
            text: parts.join("\n"),
          }],
        };
      }

      // Not under maintenance — return status info
      const info: Record<string, unknown> = {
        status: "operational",
        maintenance: false,
      };

      if (status.startsAt && new Date(status.startsAt) > new Date()) {
        info.status = "scheduled_maintenance";
        info.scheduledAt = status.startsAt;
        info.message = status.message;
        if (status.endsAt) info.estimatedEnd = status.endsAt;
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(info, null, 2),
        }],
      };
    })
  );
}

/**
 * Tool and resource registration aggregator.
 *
 * All tool and resource registrations flow through here so that index.ts
 * stays minimal and individual tool files stay focused on their domain.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "./client.js";
import { registerInvoiceTools } from "./tools/invoice.js";
import { registerPartyTools } from "./tools/party.js";
import { registerItemTools } from "./tools/item.js";
import { registerPaymentTools } from "./tools/payment.js";
import { registerExpenseTools } from "./tools/expense.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerGstTools } from "./tools/gst.js";
import { registerResources } from "./resources/index.js";

export function registerTools(server: McpServer, client: HisaaboClient): void {
  // Core business operations
  registerInvoiceTools(server, client);
  registerPartyTools(server, client);
  registerItemTools(server, client);
  registerPaymentTools(server, client);
  registerExpenseTools(server, client);

  // Analytics and reporting
  registerDashboardTools(server, client);
  registerGstTools(server, client);

  // Read-only context resources
  registerResources(server, client);
}

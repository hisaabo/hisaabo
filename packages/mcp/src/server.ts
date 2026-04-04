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
import { registerShipmentTools } from "./tools/shipment.js";
import { registerBankAccountTools } from "./tools/bankAccount.js";
import { registerReportTools } from "./tools/reports.js";
import { registerStoreTools } from "./tools/store.js";
import { registerTargetTools } from "./tools/target.js";
import { registerImportTools } from "./tools/import.js";
import { registerTenantTools } from "./tools/tenant.js";
import { registerDocumentTools } from "./tools/document.js";
import { registerApiKeyTools } from "./tools/apiKey.js";
import { registerAutomatedInvoiceTools } from "./tools/automatedInvoice.js";
import { registerSessionTools } from "./tools/session.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

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
  registerReportTools(server, client);

  // Logistics
  registerShipmentTools(server, client);

  // Financial accounts
  registerBankAccountTools(server, client);

  // Online store
  registerStoreTools(server, client);

  // Sales targets
  registerTargetTools(server, client);

  // Data import
  registerImportTools(server, client);

  // Organization management
  registerTenantTools(server, client);

  // Document types (quotation, credit note, etc.) and conversion
  registerDocumentTools(server, client);

  // API key management
  registerApiKeyTools(server, client);

  // Automated / recurring invoices
  registerAutomatedInvoiceTools(server, client);

  // Session management
  registerSessionTools(server, client);

  // Audit trail
  registerAuditTools(server, client);

  // Read-only context resources
  registerResources(server, client);

  // Prompt templates for guided workflows
  registerPrompts(server);
}

import { Command } from "commander";
import { fatalError } from "../output.js";

import { registerAuthCommands } from "./registrars/auth.js";
import { registerDashboardCommands } from "./registrars/dashboard.js";
import { registerInvoiceCommands } from "./registrars/invoice.js";
import { registerPartyCommands } from "./registrars/party.js";
import { registerItemCommands } from "./registrars/item.js";
import { registerPaymentCommands } from "./registrars/payment.js";
import { registerExpenseCommands } from "./registrars/expense.js";
import { registerGstCommands } from "./registrars/gst.js";
import { registerReportCommands } from "./registrars/report.js";
import { registerBankCommands } from "./registrars/bank.js";
import { registerShipmentCommands } from "./registrars/shipment.js";
import { registerTargetCommands } from "./registrars/target.js";
import { registerStoreCommands } from "./registrars/store.js";
import { registerImportCommands } from "./registrars/import.js";
import { registerAutomatedInvoiceCommands } from "./registrars/automated-invoice.js";
import { registerBusinessCommands } from "./registrars/business.js";
import { registerDocumentCommands } from "./registrars/document.js";
import { registerTenantCommands } from "./registrars/tenant.js";
import { registerApiKeyCommands } from "./registrars/api-key.js";

// ── Program ───────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("hisaabo")
  .description("Hisaabo CLI — Invoicing and business management")
  .version("0.1.0");

// ── Register all command groups ───────────────────────────────────────────

registerAuthCommands(program);
registerDashboardCommands(program);
registerInvoiceCommands(program);
registerPartyCommands(program);
registerItemCommands(program);
registerPaymentCommands(program);
registerExpenseCommands(program);
registerGstCommands(program);
registerReportCommands(program);
registerBankCommands(program);
registerShipmentCommands(program);
registerTargetCommands(program);
registerStoreCommands(program);
registerImportCommands(program);
registerAutomatedInvoiceCommands(program);
registerBusinessCommands(program);
registerDocumentCommands(program);
registerTenantCommands(program);
registerApiKeyCommands(program);

// ── Run ────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  fatalError(String(err instanceof Error ? err.message : err));
});

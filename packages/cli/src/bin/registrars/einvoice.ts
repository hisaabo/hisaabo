import { Command } from "commander";
import {
  eInvoiceDashboardCommand,
  eInvoiceGenerateCommand,
  eInvoiceCancelCommand,
  eInvoiceRetryCommand,
} from "../../commands/einvoice/index.js";

export function registerEInvoiceCommands(program: Command): void {
  const einvoice = program.command("einvoice").description("E-Invoice (IRP) management");

  einvoice
    .command("dashboard")
    .description("E-invoice generation summary")
    .option("--json", "JSON output")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .action(async (opts) => {
      await eInvoiceDashboardCommand(opts);
    });

  einvoice
    .command("generate <invoiceId>")
    .description("Generate an e-invoice (get IRN from IRP)")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await eInvoiceGenerateCommand(invoiceId, { json: opts.json });
    });

  einvoice
    .command("cancel <invoiceId>")
    .description("Cancel an e-invoice")
    .option("--json", "JSON output")
    .option("--reason <code>", "Cancel reason code (1-4)")
    .action(async (invoiceId: string, opts) => {
      await eInvoiceCancelCommand(invoiceId, { json: opts.json, reason: opts.reason });
    });

  einvoice
    .command("retry <invoiceId>")
    .description("Retry a failed e-invoice generation")
    .option("--json", "JSON output")
    .action(async (invoiceId: string, opts) => {
      await eInvoiceRetryCommand(invoiceId, { json: opts.json });
    });
}

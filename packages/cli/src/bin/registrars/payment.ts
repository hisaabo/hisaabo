import { Command } from "commander";
import { paymentListCommand } from "../../commands/payment/list.js";
import { paymentCreateCommand } from "../../commands/payment/create.js";
import { paymentDeleteCommand } from "../../commands/payment/delete.js";

export function registerPaymentCommands(program: Command): void {
  // ── payment ───────────────────────────────────────────────────────────────

  const payment = program.command("payment").description("Payment recording");

  payment
    .command("list")
    .description("List payments")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--party-id <id>", "Filter by party")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await paymentListCommand(opts);
    });

  payment
    .command("create")
    .description("Record a payment")
    .option("--json", "JSON output")
    .option("--party-id <id>", "Party UUID")
    .option("--party <name>", "Party name")
    .option("--amount <amount>", "Payment amount")
    .option("--mode <mode>", "cash/bank/upi/cheque/other")
    .option("--invoice-id <id>", "Link to invoice")
    .option("--reference <ref>", "Reference number")
    .option("--date <date>", "Payment date")
    .option("--notes <text>", "Notes")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
      await paymentCreateCommand({
        json: opts.json,
        partyId: opts.partyId,
        party: opts.party,
        amount: opts.amount,
        mode: opts.mode,
        invoiceId: opts.invoiceId,
        reference: opts.reference,
        date: opts.date,
        notes: opts.notes,
        yes: opts.yes,
      });
    });

  payment
    .command("delete <id>")
    .description("Delete a payment")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await paymentDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });

  payment
    .command("get <id>")
    .description("Get payment details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { paymentGetCommand } = await import("../../commands/payment/get.js");
      await paymentGetCommand(id, { json: opts.json });
    });

  payment
    .command("update <id>")
    .description("Update a payment")
    .option("--amount <amount>", "New amount")
    .option("--mode <mode>", "Payment mode: cash, upi, bank, cheque, other")
    .option("--date <YYYY-MM-DD>", "Payment date")
    .option("--reference <ref>", "Reference number (empty string to clear)")
    .option("--notes <text>", "Notes (empty string to clear)")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { paymentUpdateCommand } = await import("../../commands/payment/update.js");
      await paymentUpdateCommand(id, {
        json: opts.json,
        amount: opts.amount,
        mode: opts.mode,
        date: opts.date,
        reference: opts.reference,
        notes: opts.notes,
      });
    });

  payment
    .command("unpaid-invoices <partyId>")
    .description("List unpaid invoices for a party")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (partyId, opts) => {
      const { paymentUnpaidInvoicesCommand } = await import("../../commands/payment/unpaid-invoices.js");
      await paymentUnpaidInvoicesCommand(partyId, { json: opts.json, format: opts.format });
    });

  payment
    .command("untracked")
    .description("List payments not linked to a bank account")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { paymentUntrackedCommand } = await import("../../commands/payment/untracked.js");
      await paymentUntrackedCommand({
        json: opts.json,
        format: opts.format,
        page: opts.page,
        limit: opts.limit,
      });
    });

  payment
    .command("default-account")
    .description("Show recommended bank account for payments")
    .option("--party-id <id>", "Party UUID to scope recommendation")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { paymentDefaultAccountCommand } = await import("../../commands/payment/default-account.js");
      await paymentDefaultAccountCommand({ json: opts.json, partyId: opts.partyId });
    });
}

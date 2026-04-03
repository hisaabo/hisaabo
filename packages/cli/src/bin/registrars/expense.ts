import { Command } from "commander";
import { expenseListCommand } from "../../commands/expense/list.js";
import { expenseCreateCommand } from "../../commands/expense/create.js";
import { expenseDeleteCommand } from "../../commands/expense/delete.js";

export function registerExpenseCommands(program: Command): void {
  // ── expense ───────────────────────────────────────────────────────────────

  const expense = program.command("expense").description("Expense tracking");

  expense
    .command("list")
    .description("List expenses")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--category <cat>", "Filter by category")
    .option("--from <date>", "From date")
    .option("--to <date>", "To date")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await expenseListCommand(opts);
    });

  expense
    .command("create")
    .description("Create a new expense")
    .option("--json", "JSON output")
    .option("--category <cat>", "Expense category")
    .option("--amount <amount>", "Amount")
    .option("--mode <mode>", "cash/bank/upi/cheque/other")
    .option("--description <text>", "Description")
    .option("--date <date>", "Expense date")
    .option("--reference <ref>", "Reference number")
    .action(async (opts) => {
      await expenseCreateCommand({
        json: opts.json,
        category: opts.category,
        amount: opts.amount,
        mode: opts.mode,
        description: opts.description,
        date: opts.date,
        reference: opts.reference,
      });
    });

  expense
    .command("delete <id>")
    .description("Delete an expense")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await expenseDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });

  expense
    .command("update <id>")
    .description("Update an expense")
    .option("--amount <amount>", "New amount")
    .option("--category <cat>", "Expense category")
    .option("--date <YYYY-MM-DD>", "Expense date")
    .option("--description <text>", "Description")
    .option("--payment-mode <mode>", "Payment mode: cash, upi, bank, cheque, other")
    .option("--reference <ref>", "Reference number")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { expenseUpdateCommand } = await import("../../commands/expense/update.js");
      await expenseUpdateCommand(id, {
        json: opts.json,
        amount: opts.amount,
        category: opts.category,
        date: opts.date,
        description: opts.description,
        paymentMode: opts.paymentMode,
        reference: opts.reference,
      });
    });

  expense
    .command("categories")
    .description("List all expense categories")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { expenseCategoriesCommand } = await import("../../commands/expense/categories.js");
      await expenseCategoriesCommand({ json: opts.json });
    });
}

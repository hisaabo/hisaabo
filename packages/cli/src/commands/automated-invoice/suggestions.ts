import { HisaaboClient, HisaaboApiError, type RecurringInvoiceSuggestion } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, type ColumnDef } from "../../output.js";
import chalk from "chalk";

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Every 6 Months",
  yearly: "Yearly",
  custom: "Custom",
};

interface SuggestionsOpts {
  json?: boolean;
}

export async function automatedInvoiceSuggestionsCommand(opts: SuggestionsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.recurringInvoice.suggestions();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    if (result.length === 0) {
      console.log("\n No recurring invoice suggestions yet.\n");
      console.log("  Suggestions appear after patterns are detected in your invoice history.\n");
      return;
    }

    console.log(`\n Recurring Invoice Suggestions  ${result.length} found\n`);

    const cols: ColumnDef<RecurringInvoiceSuggestion>[] = [
      { key: "partyName", header: "Party", width: 24 },
      { key: "suggestedFrequency", header: "Suggested Frequency", width: 20, format: (v) => FREQUENCY_LABELS[String(v ?? "")] ?? String(v ?? "") },
      { key: "invoiceCount", header: "Invoices", width: 10, align: "right" },
      { key: "medianAmount", header: "Median ₹", width: 14, align: "right" },
      { key: "medianIntervalDays", header: "Interval (days)", width: 16, align: "right" },
    ];

    outputTable(result, cols);

    console.log();
    console.log(`  Tip: run ${chalk.cyan("hisaabo automated-invoice create --party-id <id>")} to set up a template.\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

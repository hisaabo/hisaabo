import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import chalk from "chalk";

const FREE_PLAN_LIMIT = 5;
const BAR_WIDTH = 20;

function usageBar(used: number, limit: number): string {
  const pct = limit > 0 ? Math.min(used / limit, 1) : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const filledChar = "█".repeat(filled);
  const emptyChar = "░".repeat(empty);

  if (!hasColor()) return `[${filledChar}${emptyChar}]`;

  const bar = pct >= 1
    ? chalk.red(filledChar)
    : pct >= 0.8
      ? chalk.yellow(filledChar)
      : chalk.green(filledChar);

  return `[${bar}${chalk.dim(emptyChar)}]`;
}

interface UsageOpts {
  json?: boolean;
}

export async function automatedInvoiceUsageCommand(opts: UsageOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.recurringInvoice.planUsage();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const limit = FREE_PLAN_LIMIT;
    const pct = limit > 0 ? Math.round((result.runsThisMonth / limit) * 100) : 0;

    console.log("\n Plan Usage — Recurring Invoices\n");
    console.log(`  Templates:   ${result.totalTemplates}`);
    console.log(`  Runs/month:  ${result.runsThisMonth} / ${limit}  ${usageBar(result.runsThisMonth, limit)}  ${pct}%`);

    if (result.runsThisMonth >= limit) {
      const msg = "  Monthly run limit reached. Upgrade your plan for unlimited runs.";
      console.log(hasColor() ? chalk.red(msg) : msg);
    } else {
      const remaining = limit - result.runsThisMonth;
      console.log(`  Remaining:   ${remaining} run${remaining !== 1 ? "s" : ""} this month`);
    }

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

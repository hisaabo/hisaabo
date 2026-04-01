import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, termWidth, hasColor } from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";
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

function statusBadge(status: string): string {
  const map: Record<string, (s: string) => string> = {
    active: (s) => chalk.green(s),
    paused: (s) => chalk.yellow(s),
    completed: (s) => chalk.dim(s),
    expired: (s) => chalk.red(s),
  };
  const label = `[${status.toUpperCase()}]`;
  if (!hasColor()) return label;
  const colorFn = map[status];
  return colorFn ? colorFn(label) : label;
}

export async function automatedInvoiceGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const tmpl = await client.recurringInvoice.getById(id);

    if (opts.json) {
      outputJSON(tmpl);
      return;
    }

    const w = Math.min(termWidth() - 2, 68);
    const inner = w - 2;

    function line(left: string, right?: string): void {
      if (right !== undefined) {
        const pad = Math.max(1, inner - left.length - right.length - 2);
        process.stdout.write(`| ${left}${" ".repeat(pad)}${right} |\n`);
      } else {
        const vis = left.length;
        const pad = Math.max(0, inner - vis);
        process.stdout.write(`| ${left}${" ".repeat(pad)} |\n`);
      }
    }

    function divider(): void {
      process.stdout.write(`+${"~".repeat(inner + 2)}+\n`);
    }

    const title = `RECURRING INVOICE  ${tmpl.name}`;
    const badge = statusBadge(tmpl.status);
    // eslint-disable-next-line no-control-regex
    const topPad = Math.max(1, inner - title.length - badge.replace(/\x1b\[[0-9;]*m/g, "").length);

    process.stdout.write(`\n +${"~".repeat(inner + 2)}+\n`);
    process.stdout.write(`| ${hasColor() ? chalk.bold(title) : title}${" ".repeat(topPad)}${badge} |\n`);
    divider();
    line(`Party:      ${tmpl.partyName}`);
    line(`Type:       ${tmpl.type === "sale" ? "Sale" : "Purchase"}`);
    line(`Frequency:  ${FREQUENCY_LABELS[tmpl.frequency] ?? tmpl.frequency}`);
    if (tmpl.frequency === "custom" && tmpl.customIntervalDays) {
      line(`Interval:   Every ${tmpl.customIntervalDays} days`);
    }
    line(`Start:      ${formatDate(tmpl.startDate)}`);
    if (tmpl.endDate) line(`End:        ${formatDate(tmpl.endDate)}`);
    if (tmpl.nextRunDate) line(`Next Run:   ${formatDate(tmpl.nextRunDate)}`);
    if (tmpl.lastRunDate) line(`Last Run:   ${formatDate(tmpl.lastRunDate)}`);
    line(`Runs:       ${tmpl.totalRuns}${tmpl.maxRuns ? ` / ${tmpl.maxRuns}` : ""}`);
    divider();

    // Line items
    process.stdout.write(`|${"".padEnd(inner + 2)}|\n`);
    process.stdout.write(`|   #  ${"Item".padEnd(18)} ${"Qty".padStart(5)} ${"Rate".padStart(10)} ${"Tax%".padStart(5)} |\n`);
    process.stdout.write(`|  ${"--".padEnd(2)} ${"~".repeat(18)} ${"~".repeat(5)} ${"~".repeat(10)} ${"~".repeat(5)} |\n`);

    tmpl.lineItems.forEach((item, i) => {
      const idx = String(i + 1).padStart(2);
      const desc = item.description.slice(0, 18).padEnd(18);
      const qty = item.quantity.padStart(5);
      const rate = formatAmount(item.unitPrice).padStart(10);
      const tax = item.taxPercent ? `${item.taxPercent}%`.padStart(5) : "    -";
      process.stdout.write(`|   ${idx}  ${desc} ${qty} ${rate} ${tax} |\n`);
    });

    process.stdout.write(`|${"".padEnd(inner + 2)}|\n`);

    if (tmpl.notes) {
      divider();
      line(`Notes: ${tmpl.notes}`);
    }

    process.stdout.write(` +${"~".repeat(inner + 2)}+\n\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Recurring invoice template not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

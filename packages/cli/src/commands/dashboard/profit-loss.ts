import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor, termWidth } from "../../output.js";
import { formatINR, formatDate, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import chalk from "chalk";

interface ProfitLossOpts {
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  json?: boolean;
}

function plLine(
  label: string,
  value: string,
  innerW: number,
  opts: { bold?: boolean; dim?: boolean; separator?: boolean; indent?: number } = {}
): string {
  const indent = opts.indent ?? 0;
  const indentStr = " ".repeat(indent * 2);
  const fullLabel = indentStr + label;
  const rightPad = 2;
  const maxValueLen = 18;
  const labelWidth = innerW - maxValueLen - rightPad;
  const truncLabel = fullLabel.length > labelWidth ? fullLabel.slice(0, labelWidth - 1) + "…" : fullLabel;
  const paddedLabel = truncLabel.padEnd(labelWidth);
  const paddedValue = value.padStart(maxValueLen - rightPad) + " ".repeat(rightPad);

  let line = `│ ${paddedLabel}${paddedValue}│`;

  if (!hasColor()) return line;
  if (opts.bold) line = line.replace(paddedLabel, chalk.bold(truncLabel.padEnd(labelWidth)));
  if (opts.dim) line = chalk.dim(line);
  return line;
}

function plSeparator(innerW: number): string {
  // Right-aligned dashes inside the box
  const dashLen = 18;
  const leftPad = innerW - dashLen;
  const line = `│ ${" ".repeat(leftPad - 1)}${"─".repeat(dashLen)} │`;
  return hasColor() ? chalk.dim(line) : line;
}

function plBlank(innerW: number): string {
  return `│ ${" ".repeat(innerW)} │`;
}

function plBorder(innerW: number, char: "┌" | "└"): string {
  const side = char === "┌" ? "┐" : "┘";
  return char + "─".repeat(innerW) + side;
}

function plTitle(title: string, innerW: number): string {
  const pad = Math.max(0, innerW - title.length - 2);
  const line = `│ ${hasColor() ? chalk.bold(title) : title}${" ".repeat(pad)} │`;
  return line;
}

function formatPL(amount: number): string {
  if (amount < 0) return `(${formatINR(Math.abs(amount))})`;
  return formatINR(amount);
}

function colorPL(formatted: string, isProfit: boolean): string {
  if (!hasColor()) return formatted;
  const num = parseFloat(formatted.replace(/[₹,()]/g, ""));
  if (isNaN(num) || num === 0) return chalk.dim(formatted);
  return isProfit ? chalk.green(formatted) : chalk.red(formatted);
}

export async function dashboardProfitLossCommand(opts: ProfitLossOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let fromDate = opts.from ?? fyStart();
  let toDate = opts.to ?? todayISO();
  if (opts.thisMonth) { fromDate = monthStart(); toDate = monthEnd(); }
  else if (opts.thisFy) { fromDate = fyStart(); toDate = todayISO(); }

  try {
    const data = await client.dashboard.profitAndLoss({ fromDate: apiFrom(fromDate), toDate: apiTo(toDate) });

    if (opts.json) {
      outputJSON(data);
      return;
    }

    const revenue      = parseFloat(data.revenue);
    const cogs         = parseFloat(data.cogs);
    const grossProfit  = parseFloat(data.grossProfit);
    const opex         = parseFloat(data.totalExpenses);
    const netProfit    = parseFloat(data.netProfit);

    const grossMargin = revenue > 0 ? `${data.grossMarginPercent}%` : "-";
    const netMargin   = revenue > 0 ? `${data.netMarginPercent}%` : "-";

    const width = Math.min(termWidth() - 2, 52);
    const innerW = width - 2;

    const lines: string[] = [];

    lines.push(plBorder(innerW, "┌"));
    lines.push(plTitle("PROFIT & LOSS STATEMENT", innerW));
    lines.push(plTitle(`${formatDate(fromDate)} – ${formatDate(toDate)}`, innerW));
    lines.push(`├${"─".repeat(innerW)}┤`);
    lines.push(plBlank(innerW));

    lines.push(plLine("Revenue", formatPL(revenue), innerW, { bold: true }));
    lines.push(plLine("Cost of Goods Sold", formatPL(-cogs), innerW));
    lines.push(plSeparator(innerW));

    const gpFormatted = formatPL(grossProfit);
    lines.push(plLine("Gross Profit", colorPL(gpFormatted, grossProfit >= 0), innerW, { bold: true }));
    lines.push(plLine("Gross Margin", grossMargin, innerW, { dim: true }));
    lines.push(plBlank(innerW));

    lines.push(plLine("Operating Expenses", formatPL(-opex), innerW));
    lines.push(plSeparator(innerW));

    const npFormatted = formatPL(netProfit);
    lines.push(plLine("Net Profit", colorPL(npFormatted, netProfit >= 0), innerW, { bold: true }));
    lines.push(plLine("Net Margin", netMargin, innerW, { dim: true }));
    lines.push(plBlank(innerW));

    lines.push(plBorder(innerW, "└"));

    process.stdout.write("\n");
    for (const l of lines) {
      process.stdout.write("  " + l + "\n");
    }
    process.stdout.write("\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

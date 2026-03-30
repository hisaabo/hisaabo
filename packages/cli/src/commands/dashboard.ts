import { HisaaboClient, HisaaboApiError } from "../client.js";
import { requireAuth } from "../config.js";
import { fatalError, outputJSON, EXIT, hasColor, termWidth } from "../output.js";
import { formatAmount, formatStatus, formatRelativeDate, currentFY, fyStart, todayISO } from "../format.js";
import chalk from "chalk";

function box(title: string, lines: string[], width: number): string[] {
  const innerW = width - 2;
  const titleStr = `─ ${title} `;
  const border = "┌" + titleStr + "─".repeat(Math.max(1, innerW - titleStr.length)) + "┐";
  const bottom = "└" + "─".repeat(innerW) + "┘";
  const padded = lines.map((l) => {
    const vis = l.length;
    const pad = Math.max(0, innerW - vis - 1);
    return "│ " + l + " ".repeat(pad) + "│";
  });
  return [border, ...padded, bottom];
}

function colorMoney(amount: string, good = true): string {
  if (!hasColor()) return formatAmount(amount);
  const num = parseFloat(amount);
  if (isNaN(num) || num === 0) return chalk.dim(formatAmount(amount));
  if (good) return chalk.green(formatAmount(amount));
  return chalk.red(formatAmount(amount));
}

export async function dashboardCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const from = fyStart();
  const to = todayISO();

  try {
    const summary = await client.dashboard.summary({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(summary);
      return;
    }

    const width = Math.min(termWidth() - 2, 70);
    const fy = currentFY();

    console.log();
    console.log(` Hisaabo Dashboard` + " ".repeat(Math.max(2, width - 30)) + (cfg.businessName ?? ""));
    console.log(` FY ${fy} (01 Apr ${fy.split("-")[0]} - 31 Mar 20${fy.split("-")[1]})`);
    console.log(` ${"═".repeat(width)}`);
    console.log();

    // Revenue / Expenses boxes
    const halfW = Math.floor((width - 3) / 2);
    const revLines = [
      `Sales    ${formatAmount(summary.totalSales).padStart(12)}`,
      `Cash In  ${formatAmount(summary.cashInHand).padStart(12)}`,
    ];
    const expLines = [
      `Purchases ${formatAmount(summary.totalPurchases).padStart(11)}`,
      `Expenses  ${formatAmount(summary.totalExpenses).padStart(11)}`,
    ];

    const revBox = box("Revenue", revLines, halfW);
    const expBox = box("Expenses", expLines, halfW);

    for (let i = 0; i < Math.max(revBox.length, expBox.length); i++) {
      const l = (revBox[i] ?? "").padEnd(halfW);
      const r = expBox[i] ?? "";
      console.log(` ${l}  ${r}`);
    }
    console.log();

    // Outstanding box
    const net = parseFloat(summary.receivable) - parseFloat(summary.payable);
    const netLabel = net >= 0 ? "receivable" : "payable";
    const outLines = [
      `Receivable  ${colorMoney(summary.receivable)}`,
      `Payable     ${colorMoney(summary.payable, false)}`,
      `Net Position ${colorMoney(String(Math.abs(net)))}  ${netLabel}`,
    ];
    const outBox = box("Outstanding", outLines, width);
    outBox.forEach((l) => console.log(` ${l}`));
    console.log();

    // Recent invoices box
    const recentLines = summary.recentInvoices.slice(0, 5).map((inv) => {
      const num = inv.invoiceNumber.padEnd(10);
      const party = inv.partyName.slice(0, 16).padEnd(18);
      const amt = formatAmount(inv.totalAmount).padStart(12);
      const status = formatStatus(inv.status).padEnd(10);
      const rel = formatRelativeDate(inv.invoiceDate).padEnd(7);
      return `${num} ${party} ${amt}  ${status} ${rel}`;
    });
    const recentBox = box("Recent Invoices", recentLines, width);
    recentBox.forEach((l) => console.log(` ${l}`));
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

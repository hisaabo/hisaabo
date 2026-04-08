import { HisaaboClient, HisaaboApiError, type DaybookEntry } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatStatus, todayISO, fyStart, monthStart, monthEnd } from "../../format.js";

interface ReportOpts {
  json?: boolean;
  format?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
}

function resolveRange(opts: ReportOpts): { from: string; to: string } {
  if (opts.thisFy) return { from: fyStart(), to: todayISO() };
  if (opts.thisMonth) return { from: monthStart(), to: monthEnd() };
  return { from: opts.from ?? fyStart(), to: opts.to ?? todayISO() };
}

export async function reportDaybookCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.daybook({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Daybook Report   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(70)}\n`);

    const cols: ColumnDef<DaybookEntry>[] = [
      { key: "time", header: "Time", width: 20, format: (v) => formatDate(String(v ?? "")) },
      { key: "entryType", header: "Type", width: 10 },
      { key: "number", header: "#", width: 12, format: (v) => String(v ?? "-") },
      { key: "partyOrCategory", header: "Party / Category", width: 22 },
      { key: "debit", header: "Debit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "credit", header: "Credit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
    ];

    if (opts.format === "tsv") outputTSV(result.entries, cols);
    else if (opts.format === "csv") outputCSV(result.entries, cols);
    else {
      outputTable(result.entries, cols);

      const s = result.summary;
      console.log(`\n  Sales Invoiced:     ${formatAmount(s.totalSalesInvoiced).padStart(14)}`);
      console.log(`  Purchases Invoiced: ${formatAmount(s.totalPurchaseInvoiced).padStart(14)}`);
      console.log(`  Payments Received:  ${formatAmount(s.totalPaymentsReceived).padStart(14)}`);
      console.log(`  Payments Made:      ${formatAmount(s.totalPaymentsMade).padStart(14)}`);
      console.log(`  Expenses:           ${formatAmount(s.totalExpenses).padStart(14)}`);
      console.log(`  Net Cash Movement:  ${formatAmount(s.netCashMovement).padStart(14)}\n`);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function reportOutstandingCommand(opts: ReportOpts & { type?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.reports.outstanding({
      type: opts.type as "receivable" | "payable" | "both" | undefined ?? "both",
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log("\n Outstanding Report\n");
    console.log(" " + "═".repeat(60) + "\n");

    if (result.receivables && Array.isArray(result.receivables)) {
      console.log("  Receivables:");
      (result.receivables as Array<Record<string, unknown>>).forEach((row) => {
        console.log(`    ${String(row["partyName"] ?? "").padEnd(25)} ${formatAmount(String(row["balance"] ?? "0")).padStart(14)}`);
      });
    }
    if (result.payables && Array.isArray(result.payables)) {
      console.log("\n  Payables:");
      (result.payables as Array<Record<string, unknown>>).forEach((row) => {
        console.log(`    ${String(row["partyName"] ?? "").padEnd(25)} ${formatAmount(String(row["balance"] ?? "0")).padStart(14)}`);
      });
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

export async function reportTaxSummaryCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.taxSummary({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Tax Summary   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(60) + "\n");

    if (Array.isArray(result.rows)) {
      (result.rows as Array<Record<string, unknown>>).forEach((row) => {
        const rate = String(row["taxPercent"] ?? row["rate"] ?? "-");
        const taxable = formatAmount(String(row["taxableAmount"] ?? "0"));
        const tax = formatAmount(String(row["taxAmount"] ?? "0"));
        console.log(`  ${rate.padEnd(6)}%  Taxable: ${taxable.padStart(14)}  Tax: ${tax.padStart(12)}`);
      });
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

export async function reportItemSalesCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.itemSales({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Item Sales   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(70) + "\n");

    if (Array.isArray(result.rows)) {
      (result.rows as Array<Record<string, unknown>>).slice(0, 50).forEach((row) => {
        const name = String(row["itemName"] ?? row["name"] ?? "-").padEnd(25);
        const qty = String(row["totalQuantity"] ?? row["qty"] ?? "-").padStart(8);
        const rev = formatAmount(String(row["totalRevenue"] ?? row["revenue"] ?? "0")).padStart(14);
        console.log(`  ${name} ${qty}  ${rev}`);
      });
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

export async function reportStockSummaryCommand(opts: { json?: boolean; category?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.reports.stockSummary({ category: opts.category });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log("\n Stock Summary\n");
    console.log(" " + "═".repeat(60) + "\n");

    if (Array.isArray(result.rows)) {
      (result.rows as Array<Record<string, unknown>>).forEach((row) => {
        const name = String(row["itemName"] ?? row["name"] ?? "-").padEnd(25);
        const stock = String(row["stockQuantity"] ?? row["stock"] ?? "-").padStart(10);
        const val = formatAmount(String(row["stockValue"] ?? row["value"] ?? "0")).padStart(14);
        console.log(`  ${name} ${stock}  ${val}`);
      });
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

// ── Sales Register ─────────────────────────────────────────────────────────

interface RegisterRow {
  date?: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  number?: string;
  partyName?: string;
  party?: string;
  subtotal?: string;
  taxAmount?: string;
  tax?: string;
  total?: string;
  totalAmount?: string;
  status?: string;
  [key: string]: unknown;
}

export async function reportSalesRegisterCommand(
  opts: ReportOpts & { partyId?: string },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.salesRegister({ fromDate: from, toDate: to, partyId: opts.partyId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Sales Register   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(80)}\n`);

    const rows: RegisterRow[] = Array.isArray(result) ? result
      : Array.isArray(result.rows) ? result.rows
      : Array.isArray(result.invoices) ? result.invoices
      : [];

    const cols: ColumnDef<RegisterRow>[] = [
      { key: "date",          header: "Date",       width: 13, format: (v, r) => formatDate(String(r.date ?? r.invoiceDate ?? v ?? "")) },
      { key: "invoiceNumber", header: "Invoice #",  width: 14, format: (v, r) => String(r.invoiceNumber ?? r.number ?? v ?? "-") },
      { key: "partyName",     header: "Party",      width: 22, format: (v, r) => String(r.partyName ?? r.party ?? v ?? "-") },
      { key: "subtotal",      header: "Subtotal (₹)", align: "right", width: 14, format: (v, r) => formatAmount(String(r.subtotal ?? v ?? "0")) },
      { key: "taxAmount",     header: "Tax (₹)",    align: "right", width: 12, format: (v, r) => formatAmount(String(r.taxAmount ?? r.tax ?? v ?? "0")) },
      { key: "total",         header: "Total (₹)",  align: "right", width: 14, format: (v, r) => formatAmount(String(r.total ?? r.totalAmount ?? v ?? "0")) },
      { key: "status",        header: "Status",     width: 10, format: (v, r) => formatStatus(String(r.status ?? v ?? "")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (rows.length > 0 && opts.format !== "tsv" && opts.format !== "csv") {
      const total = rows.reduce((sum, r) => sum + parseFloat(String(r.total ?? r.totalAmount ?? "0")), 0);
      console.log(`\n  Total: ${formatAmount(String(total)).padStart(14)}\n`);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── Purchase Register ──────────────────────────────────────────────────────

export async function reportPurchaseRegisterCommand(
  opts: ReportOpts & { partyId?: string },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.purchaseRegister({ fromDate: from, toDate: to, partyId: opts.partyId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Purchase Register   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(80)}\n`);

    const rows: RegisterRow[] = Array.isArray(result) ? result
      : Array.isArray(result.rows) ? result.rows
      : Array.isArray(result.invoices) ? result.invoices
      : [];

    const cols: ColumnDef<RegisterRow>[] = [
      { key: "date",          header: "Date",       width: 13, format: (v, r) => formatDate(String(r.date ?? r.invoiceDate ?? v ?? "")) },
      { key: "invoiceNumber", header: "Invoice #",  width: 14, format: (v, r) => String(r.invoiceNumber ?? r.number ?? v ?? "-") },
      { key: "partyName",     header: "Party",      width: 22, format: (v, r) => String(r.partyName ?? r.party ?? v ?? "-") },
      { key: "subtotal",      header: "Subtotal (₹)", align: "right", width: 14, format: (v, r) => formatAmount(String(r.subtotal ?? v ?? "0")) },
      { key: "taxAmount",     header: "Tax (₹)",    align: "right", width: 12, format: (v, r) => formatAmount(String(r.taxAmount ?? r.tax ?? v ?? "0")) },
      { key: "total",         header: "Total (₹)",  align: "right", width: 14, format: (v, r) => formatAmount(String(r.total ?? r.totalAmount ?? v ?? "0")) },
      { key: "status",        header: "Status",     width: 10, format: (v, r) => formatStatus(String(r.status ?? v ?? "")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (rows.length > 0 && opts.format !== "tsv" && opts.format !== "csv") {
      const total = rows.reduce((sum, r) => sum + parseFloat(String(r.total ?? r.totalAmount ?? "0")), 0);
      console.log(`\n  Total: ${formatAmount(String(total)).padStart(14)}\n`);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── Party Statement ────────────────────────────────────────────────────────

interface StatementRow {
  date?: string;
  type?: string;
  entryType?: string;
  number?: string;
  invoiceNumber?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  runningBalance?: string;
  [key: string]: unknown;
}

export async function reportPartyStatementCommand(
  partyId: string,
  opts: ReportOpts,
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.partyStatement({ partyId, fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const res = result as Record<string, unknown>;
    const partyName = String(res["partyName"] ?? res["party"] ?? partyId);
    console.log(`\n Party Statement — ${partyName}   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(75)}\n`);

    const openingBalance = String(res["openingBalance"] ?? "0");
    console.log(`  Opening Balance:  ${formatAmount(openingBalance).padStart(14)}\n`);

    const rows: StatementRow[] = Array.isArray(res["entries"]) ? res["entries"] as StatementRow[]
      : Array.isArray(res["rows"]) ? res["rows"] as StatementRow[]
      : [];

    const cols: ColumnDef<StatementRow>[] = [
      { key: "date",    header: "Date",    width: 13, format: (v, r) => formatDate(String(r.date ?? v ?? "")) },
      { key: "type",    header: "Type",    width: 12, format: (v, r) => String(r.type ?? r.entryType ?? v ?? "-") },
      { key: "number",  header: "Number",  width: 14, format: (v, r) => String(r.number ?? r.invoiceNumber ?? v ?? "-") },
      { key: "debit",   header: "Debit (₹)",  align: "right", width: 13, format: (v, r) => parseFloat(String(r.debit ?? v ?? "0")) !== 0 ? formatAmount(String(r.debit ?? v)) : "-" },
      { key: "credit",  header: "Credit (₹)", align: "right", width: 13, format: (v, r) => parseFloat(String(r.credit ?? v ?? "0")) !== 0 ? formatAmount(String(r.credit ?? v)) : "-" },
      { key: "balance", header: "Balance (₹)", align: "right", width: 14, format: (v, r) => formatAmount(String(r.balance ?? r.runningBalance ?? v ?? "0")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (opts.format !== "tsv" && opts.format !== "csv") {
      const closingBalance = String(res["closingBalance"] ?? res["balance"] ?? "0");
      console.log(`\n  Closing Balance:  ${formatAmount(closingBalance).padStart(14)}\n`);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── Payment Summary ────────────────────────────────────────────────────────

export async function reportPaymentSummaryCommand(
  opts: ReportOpts & { type?: string },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.paymentSummary({
      fromDate: from,
      toDate: to,
      type: opts.type as "received" | "made" | "both" | undefined ?? "both",
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const res = result as Record<string, unknown>;
    console.log(`\n Payment Summary   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(60) + "\n");

    const received = String(res["totalReceived"] ?? res["received"] ?? "0");
    const made = String(res["totalMade"] ?? res["made"] ?? "0");
    const net = String(res["net"] ?? res["netCash"] ?? "0");

    console.log(`  Total Received:  ${formatAmount(received).padStart(14)}`);
    console.log(`  Total Made:      ${formatAmount(made).padStart(14)}`);
    console.log(`  Net:             ${formatAmount(net).padStart(14)}`);

    const breakdown = res["breakdown"] ?? res["byMode"] ?? res["modes"];
    if (breakdown && Array.isArray(breakdown)) {
      console.log(`\n  By Payment Mode:\n`);
      (breakdown as Array<Record<string, unknown>>).forEach((row) => {
        const mode = String(row["mode"] ?? row["paymentMode"] ?? "-").padEnd(18);
        const amount = formatAmount(String(row["amount"] ?? row["total"] ?? "0")).padStart(14);
        console.log(`    ${mode} ${amount}`);
      });
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

// ── Cash Flow Forecast ─────────────────────────────────────────────────────

export async function reportCashFlowCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.reports.cashFlowForecast();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const res = result as Record<string, unknown>;
    console.log("\n Cash Flow Forecast\n");
    console.log(" " + "═".repeat(60) + "\n");

    const currentBalance = String(res["currentBalance"] ?? res["balance"] ?? "0");
    const avgDailyExpenses = String(res["avgDailyExpenses"] ?? res["dailyBurn"] ?? "0");

    console.log(`  Current Balance:        ${formatAmount(currentBalance).padStart(14)}`);
    console.log(`  Avg Daily Expenses:     ${formatAmount(avgDailyExpenses).padStart(14)}`);

    const forecasts = res["forecasts"] ?? res["forecast"];
    if (forecasts && Array.isArray(forecasts)) {
      console.log(`\n  Forecast:\n`);
      (forecasts as Array<Record<string, unknown>>).forEach((f) => {
        const days = String(f["days"] ?? f["day"] ?? "-");
        const balance = formatAmount(String(f["balance"] ?? f["amount"] ?? "0")).padStart(14);
        console.log(`    ${`${days}d`.padEnd(6)} ${balance}`);
      });
    } else {
      // Fall back to computing from balance and daily burn if no forecasts array
      const current = parseFloat(currentBalance);
      const daily = parseFloat(avgDailyExpenses);
      if (!isNaN(current) && !isNaN(daily)) {
        console.log(`\n  Forecast:\n`);
        for (const days of [7, 14, 30]) {
          const projected = current - daily * days;
          console.log(`    ${`${days}d`.padEnd(6)} ${formatAmount(String(projected)).padStart(14)}`);
        }
      }
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

// ── Trial Balance ──────────────────────────────────────────────────────────

export async function reportTrialBalanceCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from: _from, to } = resolveRange(opts);

  try {
    const result = await client.reports.trialBalance({ asOfDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Trial Balance   as of ${to}\n`);
    console.log(` ${"═".repeat(70)}\n`);

    const rows = Array.isArray(result?.accounts) ? result.accounts
      : Array.isArray(result?.rows) ? result.rows
      : Array.isArray(result) ? result
      : [];

    for (const row of rows as Array<Record<string, unknown>>) {
      const name = String(row["accountName"] ?? row["name"] ?? "-").padEnd(30);
      const debit = String(row["debit"] ?? "0");
      const credit = String(row["credit"] ?? "0");
      const dr = parseFloat(debit) !== 0 ? formatAmount(debit) : "-";
      const cr = parseFloat(credit) !== 0 ? formatAmount(credit) : "-";
      console.log(`  ${name}  ${dr.padStart(14)}  ${cr.padStart(14)}`);
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

// ── Balance Sheet ──────────────────────────────────────────────────────────

export async function reportBalanceSheetCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { to } = resolveRange(opts);

  try {
    const result = await client.reports.balanceSheet({ asOfDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log(`\n Balance Sheet   as of ${to}\n`);
    console.log(` ${"═".repeat(60)}\n`);

    const assets = String(r["totalAssets"] ?? r["assets"] ?? "0");
    const liabilities = String(r["totalLiabilities"] ?? r["liabilities"] ?? "0");
    const equity = String(r["totalEquity"] ?? r["equity"] ?? "0");

    console.log(`  Total Assets:       ${formatAmount(assets).padStart(14)}`);
    console.log(`  Total Liabilities:  ${formatAmount(liabilities).padStart(14)}`);
    console.log(`  Total Equity:       ${formatAmount(equity).padStart(14)}`);
    console.log();
    console.log("  Use --json for full balance sheet breakdown.\n");

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── Cash Flow Statement ────────────────────────────────────────────────────

export async function reportCashFlowStatementCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.cashFlowStatement({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log(`\n Cash Flow Statement   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(60)}\n`);

    const operating = String(r["operatingActivities"] ?? r["operations"] ?? "0");
    const investing = String(r["investingActivities"] ?? r["investing"] ?? "0");
    const financing = String(r["financingActivities"] ?? r["financing"] ?? "0");
    const net = String(r["netCashFlow"] ?? r["net"] ?? "0");

    console.log(`  Operating Activities:  ${formatAmount(operating).padStart(14)}`);
    console.log(`  Investing Activities:  ${formatAmount(investing).padStart(14)}`);
    console.log(`  Financing Activities:  ${formatAmount(financing).padStart(14)}`);
    console.log(`  Net Cash Flow:         ${formatAmount(net).padStart(14)}`);
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

// ── General Ledger ─────────────────────────────────────────────────────────

export async function reportGeneralLedgerCommand(accountId: string, opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.generalLedger({ accountId, fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    const accountName = String(r["accountName"] ?? r["account"] ?? accountId);
    console.log(`\n General Ledger — ${accountName}   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(75)}\n`);

    const opening = String(r["openingBalance"] ?? "0");
    console.log(`  Opening Balance:  ${formatAmount(opening).padStart(14)}\n`);

    const entries = Array.isArray(r["entries"]) ? r["entries"]
      : Array.isArray(r["rows"]) ? r["rows"]
      : [];

    for (const entry of entries as Array<Record<string, unknown>>) {
      const date = formatDate(String(entry["date"] ?? "")).padEnd(13);
      const narration = String(entry["narration"] ?? entry["description"] ?? "-").slice(0, 25).padEnd(25);
      const debit = parseFloat(String(entry["debit"] ?? "0")) !== 0 ? formatAmount(String(entry["debit"])) : "-";
      const credit = parseFloat(String(entry["credit"] ?? "0")) !== 0 ? formatAmount(String(entry["credit"])) : "-";
      const balance = formatAmount(String(entry["balance"] ?? "0"));
      console.log(`  ${date} ${narration}  ${debit.padStart(12)}  ${credit.padStart(12)}  ${balance.padStart(14)}`);
    }

    const closing = String(r["closingBalance"] ?? r["balance"] ?? "0");
    console.log(`\n  Closing Balance:  ${formatAmount(closing).padStart(14)}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── Collection Efficiency ──────────────────────────────────────────────────

export async function reportCollectionEfficiencyCommand(opts: ReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const { from, to } = resolveRange(opts);

  try {
    const result = await client.reports.collectionEfficiency({ fromDate: from, toDate: to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const res = result as Record<string, unknown>;
    console.log(`\n Collection Efficiency   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(60) + "\n");

    const rate = String(res["collectionRate"] ?? res["rate"] ?? "0");
    const dso = String(res["dso"] ?? res["daysSalesOutstanding"] ?? "-");
    const paidOnTime = String(res["paidOnTime"] ?? res["onTimeCount"] ?? "-");
    const totalInvoiced = String(res["totalInvoiced"] ?? res["invoiced"] ?? "-");

    console.log(`  Collection Rate:   ${(parseFloat(rate)).toFixed(1).padStart(8)}%`);
    console.log(`  DSO (Days):        ${dso.padStart(8)}`);
    console.log(`  Paid On Time:      ${paidOnTime.padStart(8)}`);
    if (totalInvoiced !== "-") {
      console.log(`  Total Invoiced:    ${formatAmount(totalInvoiced).padStart(14)}`);
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

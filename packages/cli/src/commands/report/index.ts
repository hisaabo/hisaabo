import { HisaaboClient, HisaaboApiError, type DaybookEntry } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatStatus, todayISO, fyStart, monthStart, monthEnd, toApiDateTime } from "../../format.js";
import type { OutputOf } from "../../api-types.js";

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
      { key: "time", header: "Time", width: 20, format: (v) => formatDate(v as Date | null) },
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

    if (result.receivables) {
      console.log("  Receivables:");
      result.receivables.parties.forEach((row) => {
        console.log(`    ${row.partyName.padEnd(25)} ${formatAmount(row.total).padStart(14)}`);
      });
    }
    if (result.payables) {
      console.log("\n  Payables:");
      result.payables.parties.forEach((row) => {
        console.log(`    ${row.partyName.padEnd(25)} ${formatAmount(row.total).padStart(14)}`);
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

    const printBreakdown = (label: string, rows: typeof result.salesBreakdown): void => {
      console.log(`  ${label}:`);
      rows.forEach((row) => {
        const taxable = formatAmount(row.taxableAmount);
        const tax = formatAmount(row.taxAmount);
        console.log(`  ${row.taxPercent.padEnd(6)}%  Taxable: ${taxable.padStart(14)}  Tax: ${tax.padStart(12)}`);
      });
    };
    printBreakdown("Sales", result.salesBreakdown);
    printBreakdown("Purchases", result.purchaseBreakdown);
    console.log(`\n  Tax collected: ${formatAmount(result.summary.totalTaxCollected).padStart(14)}`);
    console.log(`  Tax paid:      ${formatAmount(result.summary.totalTaxPaid).padStart(14)}`);
    console.log(`  Net liability: ${formatAmount(result.summary.netTaxLiability).padStart(14)}`);
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

    result.rows.slice(0, 50).forEach((row) => {
      const name = row.itemName.padEnd(25);
      const qty = row.soldQty.padStart(8);
      const rev = formatAmount(row.totalRevenue).padStart(14);
      console.log(`  ${name} ${qty}  ${rev}`);
    });
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

    result.simpleItems.forEach((row) => {
      const name = row.itemName.padEnd(25);
      const stock = row.currentStock.padStart(10);
      const val = formatAmount(row.stockValue).padStart(14);
      console.log(`  ${name} ${stock}  ${val}`);
    });
    result.variantItems.forEach((row) => {
      const name = row.itemName.padEnd(25);
      const stock = row.totalStock.padStart(10);
      const val = formatAmount(row.totalValue).padStart(14);
      console.log(`  ${name} ${stock}  ${val}`);
    });
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

type SalesRegisterRow = OutputOf<"reports.salesRegister">["rows"][number];
type PurchaseRegisterRow = OutputOf<"reports.purchaseRegister">["rows"][number];

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

    const rows = result.rows;

    const cols: ColumnDef<SalesRegisterRow>[] = [
      { key: "invoiceDate",   header: "Date",       width: 13, format: (v) => formatDate(v as Date | null) },
      { key: "invoiceNumber", header: "Invoice #",  width: 14 },
      { key: "customerName",  header: "Party",      width: 22 },
      { key: "subtotal",      header: "Subtotal (₹)", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "taxAmount",     header: "Tax (₹)",    align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "totalAmount",   header: "Total (₹)",  align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status",        header: "Status",     width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (rows.length > 0 && opts.format !== "tsv" && opts.format !== "csv") {
      console.log(`\n  Total: ${formatAmount(result.summary.totalAmount).padStart(14)}\n`);
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

    const rows = result.rows;

    const cols: ColumnDef<PurchaseRegisterRow>[] = [
      { key: "invoiceDate",   header: "Date",       width: 13, format: (v) => formatDate(v as Date | null) },
      { key: "invoiceNumber", header: "Invoice #",  width: 14 },
      { key: "supplierName",  header: "Party",      width: 22 },
      { key: "subtotal",      header: "Subtotal (₹)", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "taxAmount",     header: "Tax (₹)",    align: "right", width: 12, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "totalAmount",   header: "Total (₹)",  align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status",        header: "Status",     width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (rows.length > 0 && opts.format !== "tsv" && opts.format !== "csv") {
      console.log(`\n  Total: ${formatAmount(result.summary.totalAmount).padStart(14)}\n`);
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

type StatementRow = NonNullable<OutputOf<"reports.partyStatement">>["entries"][number];

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

    if (!result) fatalError(`Party not found: ${partyId}`, EXIT.NOT_FOUND);
    console.log(`\n Party Statement — ${result.party.name}   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(75)}\n`);

    console.log(`  Opening Balance:  ${formatAmount(result.party.openingBalance).padStart(14)}\n`);

    const rows = result.entries;

    const cols: ColumnDef<StatementRow>[] = [
      { key: "date",    header: "Date",    width: 13, format: (v) => formatDate(v as Date | null) },
      { key: "type",    header: "Type",    width: 12 },
      { key: "number",  header: "Number",  width: 14 },
      { key: "debit",   header: "Debit (₹)",  align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "credit",  header: "Credit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "runningBalance", header: "Balance (₹)", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
    ];

    if (opts.format === "tsv") outputTSV(rows, cols);
    else if (opts.format === "csv") outputCSV(rows, cols);
    else outputTable(rows, cols);

    if (opts.format !== "tsv" && opts.format !== "csv") {
      console.log(`\n  Closing Balance:  ${formatAmount(result.summary.closingBalance).padStart(14)}\n`);
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

    console.log(`\n Payment Summary   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(60) + "\n");

    console.log(`  Total Received:  ${formatAmount(result.summary.totalReceived).padStart(14)}`);
    console.log(`  Total Made:      ${formatAmount(result.summary.totalMade).padStart(14)}`);
    console.log(`  Net:             ${formatAmount(result.summary.netCashMovement).padStart(14)}`);

    console.log(`\n  By Payment Mode:\n`);
    result.byMode.forEach((row) => {
      const mode = row.mode.padEnd(18);
      const amount = formatAmount(row.totalAmount).padStart(14);
      console.log(`    ${mode} ${amount}`);
    });
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
    const result = await client.reports.cashFlowForecast({});

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log("\n Cash Flow Forecast\n");
    console.log(" " + "═".repeat(60) + "\n");

    console.log(`  Current Balance:        ${formatAmount(result.currentBankBalance).padStart(14)}`);
    console.log(`  Avg Daily Expenses:     ${formatAmount(result.avgDailyExpenses).padStart(14)}`);

    console.log(`\n  Forecast (expected):\n`);
    result.forecast.forEach((f) => {
      console.log(`    ${`${f.days}d`.padEnd(6)} ${formatAmount(f.expected).padStart(14)}`);
    });
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
    const result = await client.reports.trialBalance({ asOfDate: toApiDateTime(to, "end") });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Trial Balance   as of ${to}\n`);
    console.log(` ${"═".repeat(70)}\n`);

    for (const row of result.accounts) {
      const name = row.accountName.padEnd(30);
      const debit = row.debit;
      const credit = row.credit;
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
    const result = await client.reports.balanceSheet({ asOfDate: toApiDateTime(to, "end") });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Balance Sheet   as of ${to}\n`);
    console.log(` ${"═".repeat(60)}\n`);

    const assets = result.totalAssets;
    const liabilities = result.totalLiabilities;
    const equity = result.totalEquity;

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
    const result = await client.reports.cashFlowStatement({ fromDate: toApiDateTime(from, "start"), toDate: toApiDateTime(to, "end") });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n Cash Flow Statement   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(60)}\n`);

    const operating = result.operating.totalOperating;
    const investing = result.investing.totalInvesting;
    const financing = result.financing.totalFinancing;
    const net = result.netCashFlow;

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
    const result = await client.reports.generalLedger({ accountId, fromDate: toApiDateTime(from, "start"), toDate: toApiDateTime(to, "end") });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n General Ledger — ${result.accountName}   ${from} → ${to}\n`);
    console.log(` ${"═".repeat(75)}\n`);

    for (const entry of result.entries) {
      const date = formatDate(entry.date).padEnd(13);
      const narration = (entry.narration || "-").slice(0, 25).padEnd(25);
      const debit = parseFloat(entry.debit) !== 0 ? formatAmount(entry.debit) : "-";
      const credit = parseFloat(entry.credit) !== 0 ? formatAmount(entry.credit) : "-";
      const balance = formatAmount(entry.balance);
      console.log(`  ${date} ${narration}  ${debit.padStart(12)}  ${credit.padStart(12)}  ${balance.padStart(14)}`);
    }

    console.log(`\n  Closing Balance:  ${formatAmount(result.closingBalance).padStart(14)}\n`);

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

    console.log(`\n Collection Efficiency   ${from} → ${to}\n`);
    console.log(" " + "═".repeat(60) + "\n");

    const ce = result.collectionEfficiency;
    const dso = result.dso.dsoDays ?? "-";

    console.log(`  On-Time Rate:      ${(parseFloat(ce.onTimeRate)).toFixed(1).padStart(8)}%`);
    console.log(`  DSO (Days):        ${dso.padStart(8)}`);
    console.log(`  Paid On Time:      ${String(ce.paidOnTime).padStart(8)}`);
    console.log(`  Paid Late:         ${String(ce.paidLate).padStart(8)}`);
    console.log(`  Total Invoices:    ${String(ce.totalInvoices).padStart(8)}`);
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

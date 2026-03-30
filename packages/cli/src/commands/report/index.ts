import { HisaaboClient, HisaaboApiError, type DaybookEntry } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, todayISO, fyStart, monthStart, monthEnd } from "../../format.js";

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

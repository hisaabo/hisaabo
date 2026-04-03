import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, fyStart, todayISO, monthStart, monthEnd } from "../../format.js";

interface LedgerReportOpts {
  json?: boolean;
  format?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
}

interface LedgerReportEntry {
  date: string;
  type: string;
  number: string;
  debit: string;
  credit: string;
  balance: string;
}

export async function partyLedgerReportCommand(partyId: string, opts: LedgerReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let from = opts.from;
  let to = opts.to;
  if (opts.thisFy) { from = fyStart(); to = todayISO(); }
  else if (opts.thisMonth) { from = monthStart(); to = monthEnd(); }

  try {
    const result = await client.party.ledgerReport({ partyId, from, to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: LedgerReportEntry[] = Array.isArray(result?.entries) ? result.entries : (Array.isArray(result) ? result : []);

    console.log(`\n  Ledger Report: ${result?.partyName ?? partyId}`);
    if (from || to) {
      console.log(`  Period: ${from ?? "start"} → ${to ?? "today"}`);
    }
    console.log("  " + "═".repeat(72) + "\n");

    const cols: ColumnDef<LedgerReportEntry>[] = [
      { key: "date", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "type", header: "Type", width: 12 },
      { key: "number", header: "Number", width: 14 },
      { key: "debit", header: "Debit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "credit", header: "Credit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "balance", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
    ];

    if (opts.format === "tsv") outputTSV(entries, cols);
    else if (opts.format === "csv") outputCSV(entries, cols);
    else outputTable(entries, cols);

    if (result?.summary) {
      console.log();
      console.log(`  Total Debit:  ₹${formatAmount(String(result.summary.totalDebit ?? "0"))}`);
      console.log(`  Total Credit: ₹${formatAmount(String(result.summary.totalCredit ?? "0"))}`);
      console.log(`  Net Balance:  ₹${formatAmount(String(result.summary.netBalance ?? "0"))}\n`);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found: ${partyId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

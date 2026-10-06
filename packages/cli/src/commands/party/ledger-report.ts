import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, fyStart, todayISO, monthStart, monthEnd, apiFrom, apiTo } from "../../format.js";
import type { OutputOf } from "../../api-types.js";

interface LedgerReportOpts {
  json?: boolean;
  format?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
}

type LedgerReportEntry = NonNullable<OutputOf<"party.ledgerReport">>["entries"][number];

export async function partyLedgerReportCommand(partyId: string, opts: LedgerReportOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let from = opts.from;
  let to = opts.to;
  if (opts.thisFy) { from = fyStart(); to = todayISO(); }
  else if (opts.thisMonth) { from = monthStart(); to = monthEnd(); }

  try {
    const result = await client.party.ledgerReport({ partyId, fromDate: apiFrom(from), toDate: apiTo(to) });
    if (!result) fatalError(`Party not found: ${partyId}`, EXIT.NOT_FOUND);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries: LedgerReportEntry[] = result.entries;

    console.log(`\n  Ledger Report: ${result.party.name}`);
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
      { key: "runningBalance", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
    ];

    if (opts.format === "tsv") outputTSV(entries, cols);
    else if (opts.format === "csv") outputCSV(entries, cols);
    else outputTable(entries, cols);

    console.log();
    console.log(`  Total Debit:  ₹${formatAmount(result.summary.totalDebit)}`);
    console.log(`  Total Credit: ₹${formatAmount(result.summary.totalCredit)}`);
    console.log(`  Closing Balance: ₹${formatAmount(result.summary.closingBalance)}\n`);

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

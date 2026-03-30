import { HisaaboClient, HisaaboApiError, type LedgerEntry } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatINR } from "../../format.js";

interface LedgerOpts {
  json?: boolean;
  format?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function partyLedgerCommand(partyId: string, opts: LedgerOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.party.ledger(partyId, {
      fromDate: opts.from,
      toDate: opts.to,
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n  Ledger: ${result.partyName} (${result.partyType})`);
    console.log("  " + "═".repeat(60));
    console.log(`  Opening Balance: ${formatINR(result.openingBalance)}\n`);

    const cols: ColumnDef<LedgerEntry>[] = [
      { key: "date", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "description", header: "Description", width: 25 },
      { key: "debit", header: "Debit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "credit", header: "Credit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "balance", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "referenceType", header: "Type", width: 10 },
    ];

    if (opts.format === "tsv") outputTSV(result.entries, cols);
    else if (opts.format === "csv") outputCSV(result.entries, cols);
    else outputTable(result.entries, cols);

    console.log(`\n  Closing Balance: ${formatINR(result.closingBalance)}\n`);

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

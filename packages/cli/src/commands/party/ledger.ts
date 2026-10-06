import { HisaaboClient, HisaaboApiError } from "../../client.js";
import type { OutputOf } from "../../api-types.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatINR, apiFrom, apiTo } from "../../format.js";

type LedgerEntry = OutputOf<"party.ledger">["data"][number];

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
      fromDate: apiFrom(opts.from),
      toDate: apiTo(opts.to),
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n  Ledger: ${partyId}`);
    console.log("  " + "═".repeat(60));
    console.log(`  Opening Balance: ${formatINR(result.openingBalance)}\n`);

    const cols: ColumnDef<LedgerEntry>[] = [
      { key: "date", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "documentNumber", header: "Number", width: 25 },
      { key: "debit", header: "Debit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "credit", header: "Credit (₹)", align: "right", width: 13, format: (v) => parseFloat(String(v ?? "0")) !== 0 ? formatAmount(String(v)) : "-" },
      { key: "runningBalance", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "type", header: "Type", width: 10 },
    ];

    if (opts.format === "tsv") outputTSV(result.data, cols);
    else if (opts.format === "csv") outputCSV(result.data, cols);
    else outputTable(result.data, cols);

    const closingBalance = result.data[result.data.length - 1]?.runningBalance ?? result.openingBalance;
    console.log(`\n  Closing Balance: ${formatINR(closingBalance)}\n`);

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

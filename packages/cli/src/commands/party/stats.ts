import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatINR } from "../../format.js";

interface StatsOpts {
  json?: boolean;
}

export async function partyStatsCommand(id: string, opts: StatsOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.party.getStats({ partyId: id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n  Party Stats: ${result?.partyName ?? id}`);
    console.log("  " + "─".repeat(40));
    console.log(`  Invoices:    ${result?.invoiceCount ?? 0}`);
    console.log(`  Payments:    ${result?.paymentCount ?? 0}`);
    console.log(`  Invoiced:    ${formatINR(String(result?.totalInvoiced ?? "0"))}`);
    console.log(`  Paid:        ${formatINR(String(result?.totalPaid ?? "0"))}`);
    console.log(`  Outstanding: ${formatINR(String(result?.outstanding ?? "0"))}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

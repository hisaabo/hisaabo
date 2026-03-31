import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatINR } from "../../format.js";

export async function partyGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const party = await client.party.get(id);

    if (opts.json) {
      outputJSON(party);
      return;
    }

    console.log(`\n  ${party.name} (${party.type.toUpperCase()})`);
    console.log("  " + "─".repeat(50));
    if (party.phone) console.log(`  Phone:    ${party.phone}`);
    if (party.email) console.log(`  Email:    ${party.email}`);
    if (party.gstin) console.log(`  GSTIN:    ${party.gstin}`);
    if (party.pan) console.log(`  PAN:      ${party.pan}`);
    if (party.billingAddress) console.log(`  Address:  ${party.billingAddress}`);
    if (party.city) console.log(`  City:     ${party.city}`);
    if (party.state) console.log(`  State:    ${party.state}`);
    if (party.category) console.log(`  Category: ${party.category}`);
    if (party.creditPeriodDays) console.log(`  Credit Period: ${party.creditPeriodDays} days`);
    if (party.creditLimit && parseFloat(party.creditLimit) > 0) console.log(`  Credit Limit: ${formatINR(party.creditLimit)}`);
    console.log(`  Balance:  ${formatINR(party.balance)}`);
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

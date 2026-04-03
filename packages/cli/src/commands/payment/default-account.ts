import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

interface DefaultAccountOpts {
  json?: boolean;
  partyId?: string;
}

export async function paymentDefaultAccountCommand(opts: DefaultAccountOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const input = opts.partyId ? { partyId: opts.partyId } : undefined;
    const result = await client.payment.defaultAccount(input);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    if (!result) {
      console.log("\n  No recommended bank account found.\n");
      return;
    }

    const sep = "─".repeat(48);

    console.log(`\n  Recommended Bank Account`);
    console.log(`  ${sep}`);

    if (typeof result === "object" && result !== null) {
      const acct = result as Record<string, unknown>;
      if (acct["id"]) console.log(`  ID          : ${acct["id"]}`);
      if (acct["accountName"]) console.log(`  Account     : ${acct["accountName"]}`);
      if (acct["bankName"]) console.log(`  Bank        : ${acct["bankName"]}`);
      if (acct["accountNumber"]) console.log(`  Number      : ${acct["accountNumber"]}`);
      if (acct["ifsc"]) console.log(`  IFSC        : ${acct["ifsc"]}`);
    } else {
      console.log(`  ${String(result)}`);
    }

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError("No bank account configured.", EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

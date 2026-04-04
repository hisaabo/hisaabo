import { HisaaboClient, HisaaboApiError, type GatewayChargeRate } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, outputTable, EXIT, type ColumnDef } from "../../output.js";

function formatChargeRate(rate: GatewayChargeRate | undefined): string {
  if (!rate) return "-";
  return rate.type === "percentage" ? `${rate.value}%` : `Flat ${rate.value}`;
}

export async function bankGatewayConfigCommand(
  accountId: string,
  opts: { json?: boolean },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const config = await client.bankAccount.getGatewayConfig(accountId);

    if (!config) {
      fatalError(`No gateway configuration found for account: ${accountId}`, EXIT.NOT_FOUND);
    }

    if (opts.json) {
      outputJSON(config);
      return;
    }

    console.log(`\n  Gateway Configuration`);
    console.log("  " + "\u2500".repeat(45));
    console.log(`  Account:            ${accountId}`);
    console.log(`  Settlement Account: ${config.settlementAccountId}`);
    console.log(`  Expense Category:   ${config.expenseCategory}`);
    console.log(`  Auto Settle:        ${config.autoSettle ? "Yes" : "No"}`);
    console.log(`  Active:             ${config.isActive ? "Yes" : "No"}`);
    console.log();

    const modes = ["credit_card", "debit_card", "upi", "net_banking", "wallet", "default"] as const;
    const rows = modes.map((mode) => ({
      mode,
      rate: formatChargeRate(config.chargeConfig[mode]),
    }));

    const cols: ColumnDef<{ mode: string; rate: string }>[] = [
      { key: "mode", header: "Payment Mode", width: 18 },
      { key: "rate", header: "Charge Rate", width: 16 },
    ];

    console.log("  Charge Rates:\n");
    outputTable(rows, cols);
    console.log();
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "not_found") fatalError(`Bank account not found: ${accountId}`, EXIT.NOT_FOUND);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

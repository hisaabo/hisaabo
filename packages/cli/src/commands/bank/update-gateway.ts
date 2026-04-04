import { HisaaboClient, HisaaboApiError, type GatewayChargeConfig } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

export interface UpdateGatewayOpts {
  json?: boolean;
  chargeCreditCard?: string;
  chargeDebitCard?: string;
  chargeUpi?: string;
  chargeNetBanking?: string;
  chargeWallet?: string;
  chargeDefault?: string;
  settlementAccount?: string;
}

function parseChargeRate(value: string): { type: "percentage" | "flat"; value: string } {
  // If value starts with "flat:" treat as flat amount, otherwise percentage
  if (value.toLowerCase().startsWith("flat:")) {
    return { type: "flat", value: value.slice(5) };
  }
  return { type: "percentage", value };
}

export async function bankUpdateGatewayCommand(
  accountId: string,
  opts: UpdateGatewayOpts,
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    // Fetch existing config to merge with updates
    const existing = await client.bankAccount.getGatewayConfig(accountId);

    const chargeConfig: GatewayChargeConfig = existing?.chargeConfig ?? {};

    if (opts.chargeCreditCard !== undefined) {
      chargeConfig.credit_card = parseChargeRate(opts.chargeCreditCard);
    }
    if (opts.chargeDebitCard !== undefined) {
      chargeConfig.debit_card = parseChargeRate(opts.chargeDebitCard);
    }
    if (opts.chargeUpi !== undefined) {
      chargeConfig.upi = parseChargeRate(opts.chargeUpi);
    }
    if (opts.chargeNetBanking !== undefined) {
      chargeConfig.net_banking = parseChargeRate(opts.chargeNetBanking);
    }
    if (opts.chargeWallet !== undefined) {
      chargeConfig.wallet = parseChargeRate(opts.chargeWallet);
    }
    if (opts.chargeDefault !== undefined) {
      chargeConfig.default = parseChargeRate(opts.chargeDefault);
    }

    const settlementAccountId = opts.settlementAccount ?? existing?.settlementAccountId;
    if (!settlementAccountId) {
      fatalError("--settlement-account is required when creating a new gateway config", EXIT.USAGE);
    }

    const result = await client.bankAccount.upsertGatewayConfig({
      bankAccountId: accountId,
      settlementAccountId,
      chargeConfig,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Gateway configuration updated for account: ${accountId}`);
    console.log(`  Settlement Account: ${result.settlementAccountId}\n`);
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "not_found") fatalError(`Bank account not found: ${accountId}`, EXIT.NOT_FOUND);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount } from "../../format.js";

interface ItcOpts {
  json?: boolean;
  from?: string;
  to?: string;
}

function handleError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function itcDashboardCommand(opts: ItcOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.dashboard({ fromDate: opts.from, toDate: opts.to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log("\n ITC Dashboard\n");
    console.log(` ${"═".repeat(50)}\n`);

    const eligible = String(r["totalEligible"] ?? r["eligible"] ?? "0");
    const blocked = String(r["totalBlocked"] ?? r["blocked"] ?? "0");
    const utilized = String(r["totalUtilized"] ?? r["utilized"] ?? "0");
    const available = String(r["availableBalance"] ?? r["available"] ?? "0");

    console.log(`  Eligible ITC:     ${formatAmount(eligible).padStart(14)}`);
    console.log(`  Blocked ITC:      ${formatAmount(blocked).padStart(14)}`);
    console.log(`  Utilized ITC:     ${formatAmount(utilized).padStart(14)}`);
    console.log(`  Available Balance:${formatAmount(available).padStart(14)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function itcLedgerCommand(opts: ItcOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.ledger({ fromDate: opts.from, toDate: opts.to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : Array.isArray(result?.entries) ? result.entries
      : [];

    console.log("\n ITC Ledger\n");
    console.log(` ${"═".repeat(70)}\n`);

    for (const entry of entries as Array<Record<string, unknown>>) {
      const date = String(entry["date"] ?? "-").slice(0, 10);
      const supplier = String(entry["supplierName"] ?? entry["supplier"] ?? "-").padEnd(22);
      const gstin = String(entry["gstin"] ?? "-").padEnd(16);
      const igst = formatAmount(String(entry["igst"] ?? "0")).padStart(12);
      const cgst = formatAmount(String(entry["cgst"] ?? "0")).padStart(12);
      const sgst = formatAmount(String(entry["sgst"] ?? "0")).padStart(12);
      console.log(`  ${date.padEnd(12)} ${supplier} ${gstin} IGST:${igst} CGST:${cgst} SGST:${sgst}`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function itcAgingCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.agingAlerts();

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const alerts = Array.isArray(result) ? result
      : Array.isArray(result?.data) ? result.data
      : Array.isArray(result?.alerts) ? result.alerts
      : [];

    console.log("\n ITC Aging Alerts\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (alerts.length === 0) {
      console.log("  No aging alerts.\n");
      return;
    }

    for (const alert of alerts as Array<Record<string, unknown>>) {
      const supplier = String(alert["supplierName"] ?? alert["supplier"] ?? "-").padEnd(25);
      const amount = formatAmount(String(alert["amount"] ?? "0")).padStart(14);
      const days = String(alert["daysOld"] ?? alert["age"] ?? "-").padStart(6);
      console.log(`  ${supplier} ${amount}  ${days} days`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function itcBlockCommand(invoiceId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.markBlocked({ invoiceId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`  ITC for invoice ${invoiceId} marked as blocked.\n`);

  } catch (e) {
    handleError(e);
  }
}

export async function itcUnblockCommand(invoiceId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.markEligible({ invoiceId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`  ITC for invoice ${invoiceId} marked as eligible.\n`);

  } catch (e) {
    handleError(e);
  }
}

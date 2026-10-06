import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { formatAmount, formatDate } from "../../format.js";
import { itcBlockReasons } from "@hisaabo/shared";

interface ItcOpts {
  json?: boolean;
  /** Return period in YYYY-MM format. */
  period?: string;
}

function isBlockReason(v: string): v is (typeof itcBlockReasons)[number] {
  return (itcBlockReasons as readonly string[]).includes(v);
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
    const result = await client.itc.dashboard({ returnPeriod: opts.period });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`\n ITC Dashboard  ${result.returnPeriod}\n`);
    console.log(` ${"═".repeat(50)}\n`);

    const total = (status: string): string => result.summary[status]?.total ?? "0";

    console.log(`  Available ITC:    ${formatAmount(total("available")).padStart(14)}`);
    console.log(`  Blocked ITC:      ${formatAmount(total("blocked")).padStart(14)}`);
    console.log(`  Utilized ITC:     ${formatAmount(total("utilized")).padStart(14)}`);
    console.log(`  Reversed ITC:     ${formatAmount(total("reversed")).padStart(14)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function itcLedgerCommand(opts: ItcOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.itc.ledger({ returnPeriod: opts.period });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const entries = result.entries;

    console.log("\n ITC Ledger\n");
    console.log(` ${"═".repeat(70)}\n`);

    for (const entry of entries) {
      const date = formatDate(entry.invoiceDate);
      const supplier = (entry.partyName ?? "-").padEnd(22);
      const status = entry.status.padEnd(10);
      const igst = formatAmount(entry.igst).padStart(12);
      const cgst = formatAmount(entry.cgst).padStart(12);
      const sgst = formatAmount(entry.sgst).padStart(12);
      console.log(`  ${date.padEnd(12)} ${supplier} ${status} IGST:${igst} CGST:${cgst} SGST:${sgst}`);
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

    const alerts = result;

    console.log("\n ITC Aging Alerts\n");
    console.log(` ${"═".repeat(60)}\n`);

    if (alerts.length === 0) {
      console.log("  No aging alerts.\n");
      return;
    }

    for (const alert of alerts) {
      const supplier = alert.partyName.padEnd(25);
      const amount = formatAmount(alert.itcAmount).padStart(14);
      const days = String(alert.daysOutstanding).padStart(6);
      console.log(`  ${supplier} ${amount}  ${days} days`);
    }
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function itcBlockCommand(invoiceId: string, opts: { json?: boolean; reason?: string; notes?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const blockReason = opts.reason ?? "other";
  if (!isBlockReason(blockReason)) {
    fatalError(`--reason must be one of: ${itcBlockReasons.join(", ")}`, EXIT.USAGE);
  }

  try {
    const result = await client.itc.markBlocked({ invoiceId, blockReason, notes: opts.notes });

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

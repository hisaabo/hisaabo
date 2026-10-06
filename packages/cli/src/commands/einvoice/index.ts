import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { apiFrom, apiTo } from "../../format.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

const CANCEL_REASONS = ["1", "2", "3", "4"] as const;

function isCancelReason(v: string): v is (typeof CANCEL_REASONS)[number] {
  return (CANCEL_REASONS as readonly string[]).includes(v);
}

function handleError(e: unknown): never {
  if (e instanceof HisaaboApiError) {
    const err = e.hisaaboError;
    if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
    if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
  }
  fatalError(String(e instanceof Error ? e.message : e));
}

export async function eInvoiceDashboardCommand(opts: { json?: boolean; from?: string; to?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.eInvoice.dashboard({ fromDate: apiFrom(opts.from), toDate: apiTo(opts.to) });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log("\n E-Invoice Dashboard\n");
    console.log(` ${"═".repeat(50)}\n`);

    const generated = String(result.counts.generated);
    const cancelled = String(result.counts.cancelled);
    const failed = String(result.counts.failed);
    const pending = String(result.counts.pending);

    console.log(`  Generated:   ${generated.padStart(8)}`);
    console.log(`  Cancelled:   ${cancelled.padStart(8)}`);
    console.log(`  Failed:      ${failed.padStart(8)}`);
    console.log(`  Pending:     ${pending.padStart(8)}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function eInvoiceGenerateCommand(invoiceId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.eInvoice.generate({ invoiceId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const irn = result.irn ?? "-";
    const ackNo = result.irnAckNumber ?? "-";
    console.log(`  E-Invoice generated.\n`);
    console.log(`  IRN:  ${irn}`);
    console.log(`  ACK:  ${ackNo}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function eInvoiceCancelCommand(invoiceId: string, opts: { json?: boolean; reason?: string; yes?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`Cancel the e-invoice for ${invoiceId}? This cannot be undone.`, opts);

  try {
    const cancelReason = opts.reason ?? "1";
    if (!isCancelReason(cancelReason)) fatalError("--reason must be one of: 1, 2, 3, 4", EXIT.USAGE);
    const result = await client.eInvoice.cancel({ invoiceId, cancelReason });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    console.log(`  E-Invoice for ${invoiceId} cancelled.\n`);

  } catch (e) {
    handleError(e);
  }
}

export async function eInvoiceRetryCommand(invoiceId: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.eInvoice.retryFailed({ invoiceId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const status = result.eInvoiceStatus ?? "queued";
    console.log(`  Retry queued for invoice ${invoiceId}. Status: ${status}\n`);

  } catch (e) {
    handleError(e);
  }
}

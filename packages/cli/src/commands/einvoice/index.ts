import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

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
    const result = await client.eInvoice.dashboard({ fromDate: opts.from, toDate: opts.to });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const r = result as Record<string, unknown>;
    console.log("\n E-Invoice Dashboard\n");
    console.log(` ${"═".repeat(50)}\n`);

    const generated = String(r["totalGenerated"] ?? r["generated"] ?? "0");
    const cancelled = String(r["totalCancelled"] ?? r["cancelled"] ?? "0");
    const failed = String(r["totalFailed"] ?? r["failed"] ?? "0");
    const pending = String(r["pending"] ?? "0");

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

    const r = result as Record<string, unknown>;
    const irn = String(r["irn"] ?? r["invoiceReferenceNumber"] ?? "-");
    const ackNo = String(r["ackNo"] ?? r["acknowledgementNumber"] ?? "-");
    console.log(`  E-Invoice generated.\n`);
    console.log(`  IRN:  ${irn}`);
    console.log(`  ACK:  ${ackNo}`);
    console.log();

  } catch (e) {
    handleError(e);
  }
}

export async function eInvoiceCancelCommand(invoiceId: string, opts: { json?: boolean; reason?: string }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.eInvoice.cancel({ invoiceId, cancelReason: opts.reason ?? "1" });

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

    const r = result as Record<string, unknown>;
    const status = String(r["status"] ?? "queued");
    console.log(`  Retry queued for invoice ${invoiceId}. Status: ${status}\n`);

  } catch (e) {
    handleError(e);
  }
}

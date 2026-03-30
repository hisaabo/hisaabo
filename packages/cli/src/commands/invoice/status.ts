import { HisaaboClient, HisaaboApiError, type InvoiceStatus } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import { formatStatus } from "../../format.js";
import chalk from "chalk";

const VALID_STATUSES: InvoiceStatus[] = ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"];

export async function invoiceStatusCommand(id: string, status: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!VALID_STATUSES.includes(status as InvoiceStatus)) {
    fatalError(`Invalid status: ${status}. Valid: ${VALID_STATUSES.join(", ")}`, EXIT.USAGE);
  }

  try {
    // Get current invoice to show before state
    const before = await client.invoice.get(id);
    const updated = await client.invoice.updateStatus(id, status as InvoiceStatus);

    if (opts.json) {
      outputJSON(updated);
      return;
    }

    const fromBadge = formatStatus(before.status);
    const toBadge = formatStatus(status);
    console.log(`  ${id} status updated: ${fromBadge} -> ${toBadge}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Invoice not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

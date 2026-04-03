import { HisaaboClient, HisaaboApiError, type PaymentUpdateInput } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatINR } from "../../format.js";

interface UpdateOpts {
  json?: boolean;
  amount?: string;
  mode?: string;
  date?: string;
  reference?: string;
  notes?: string;
}

export async function paymentUpdateCommand(id: string, opts: UpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Build update payload — only send fields explicitly provided
  const input: PaymentUpdateInput = { id };

  if (opts.amount !== undefined) input.amount = opts.amount;
  if (opts.mode !== undefined) input.mode = opts.mode as PaymentUpdateInput["mode"];
  if (opts.date !== undefined) input.paymentDate = opts.date;
  if (opts.reference !== undefined) input.referenceNumber = opts.reference || null;
  if (opts.notes !== undefined) input.notes = opts.notes || null;

  const hasUpdates = Object.keys(input).length > 1;
  if (!hasUpdates) {
    fatalError("No fields to update. Provide at least one option: --amount, --mode, --date, --reference, --notes", EXIT.USAGE);
  }

  try {
    const payment = await client.payment.update(input);

    if (opts.json) {
      outputJSON(payment);
      return;
    }

    success(`Updated: ${payment.paymentNumber} — ${formatINR(payment.amount)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Payment not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

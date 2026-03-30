import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatINR, todayISO } from "../../format.js";

interface CreateOpts {
  json?: boolean;
  category?: string;
  amount?: string;
  mode?: string;
  description?: string;
  date?: string;
  reference?: string;
}

export async function expenseCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.category) fatalError("--category is required", EXIT.USAGE);
  if (!opts.amount) fatalError("--amount is required", EXIT.USAGE);

  const mode = (opts.mode ?? "cash") as "cash" | "bank" | "upi" | "cheque" | "other";

  try {
    const expense = await client.expense.create({
      category: opts.category,
      amount: opts.amount,
      mode,
      description: opts.description,
      expenseDate: opts.date ?? todayISO(),
      referenceNumber: opts.reference,
    });

    if (opts.json) {
      outputJSON(expense);
      return;
    }

    success(`Created: ${expense.category} ${formatINR(expense.amount)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

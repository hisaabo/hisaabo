import { HisaaboClient, HisaaboApiError, type ExpenseCreateInput } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatINR } from "../../format.js";

interface UpdateOpts {
  json?: boolean;
  amount?: string;
  category?: string;
  date?: string;
  description?: string;
  paymentMode?: string;
  reference?: string;
}

export async function expenseUpdateCommand(id: string, opts: UpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Build update payload — only send fields explicitly provided
  const data: Partial<ExpenseCreateInput> = {};

  if (opts.amount !== undefined) data.amount = opts.amount;
  if (opts.category !== undefined) data.category = opts.category;
  if (opts.date !== undefined) data.expenseDate = opts.date;
  if (opts.description !== undefined) data.description = opts.description;
  if (opts.paymentMode !== undefined) data.mode = opts.paymentMode as ExpenseCreateInput["mode"];
  if (opts.reference !== undefined) data.referenceNumber = opts.reference;

  if (Object.keys(data).length === 0) {
    fatalError(
      "No fields to update. Provide at least one option: --amount, --category, --date, --description, --payment-mode, --reference",
      EXIT.USAGE,
    );
  }

  try {
    const expense = await client.expense.update(id, data);

    if (opts.json) {
      outputJSON(expense);
      return;
    }

    success(`Updated: ${expense.category} — ${formatINR(expense.amount)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Expense not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

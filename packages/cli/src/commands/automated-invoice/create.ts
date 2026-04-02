import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface CreateOpts {
  json?: boolean;
  partyId?: string;
  name?: string;
  type?: string;
  frequency?: string;
  customIntervalDays?: string;
  lineItem?: string[];
  qty?: string[];
  rate?: string[];
  tax?: string[];
  discount?: string[];
  startDate?: string;
  endDate?: string;
  maxRuns?: string;
  notes?: string;
}

export async function automatedInvoiceCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.partyId) fatalError("--party-id is required", EXIT.USAGE);
  if (!opts.name) fatalError("--name is required", EXIT.USAGE);
  if (!opts.type) fatalError("--type is required (sale or purchase)", EXIT.USAGE);
  if (!opts.frequency) fatalError("--frequency is required", EXIT.USAGE);
  if (!opts.startDate) fatalError("--start-date is required (YYYY-MM-DD)", EXIT.USAGE);

  const items = opts.lineItem ?? [];
  const qtys = opts.qty ?? [];
  const rates = opts.rate ?? [];
  const taxes = opts.tax ?? [];
  const discounts = opts.discount ?? [];

  if (items.length === 0) fatalError("At least one --line-item is required", EXIT.USAGE);

  const frequency = opts.frequency as "weekly" | "biweekly" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";

  if (frequency === "custom" && !opts.customIntervalDays) {
    fatalError("--custom-interval-days is required when frequency is 'custom'", EXIT.USAGE);
  }

  const lineItems = items.map((desc, i) => ({
    description: desc,
    quantity: qtys[i] ?? "1",
    unitPrice: rates[i] ?? "0",
    taxPercent: taxes[i],
    discountPercent: discounts[i],
  }));

  try {
    const result = await client.recurringInvoice.create({
      partyId: opts.partyId,
      name: opts.name,
      type: opts.type as "sale" | "purchase",
      frequency,
      customIntervalDays: opts.customIntervalDays ? parseInt(opts.customIntervalDays, 10) : undefined,
      lineItems,
      startDate: opts.startDate,
      endDate: opts.endDate,
      maxRuns: opts.maxRuns ? parseInt(opts.maxRuns, 10) : undefined,
      notes: opts.notes,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Created recurring invoice template: ${result.name} (${result.id})`);

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

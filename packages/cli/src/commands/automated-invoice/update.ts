import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { toApiDateTime } from "../../format.js";
import type { InputOf } from "../../api-types.js";

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"] as const;

function isFrequency(v: string): v is (typeof FREQUENCIES)[number] {
  return (FREQUENCIES as readonly string[]).includes(v);
}

interface UpdateOpts {
  json?: boolean;
  name?: string;
  frequency?: string;
  endDate?: string;
  maxRuns?: string;
  notes?: string;
}

export async function automatedInvoiceUpdateCommand(id: string, opts: UpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const data: InputOf<"recurringInvoice.update">["data"] = {};
  if (opts.name !== undefined) data.name = opts.name;
  if (opts.frequency !== undefined) {
    if (!isFrequency(opts.frequency)) {
      fatalError(`--frequency must be one of: ${FREQUENCIES.join(", ")}`, EXIT.USAGE);
    }
    data.frequency = opts.frequency;
  }
  if (opts.endDate !== undefined) data.endDate = toApiDateTime(opts.endDate, "end");
  if (opts.maxRuns !== undefined) data.maxRuns = parseInt(opts.maxRuns, 10);
  if (opts.notes !== undefined) data.notes = opts.notes;

  if (Object.keys(data).length === 0) {
    fatalError("No fields to update. Provide at least one option.", EXIT.USAGE);
  }

  try {
    const result = await client.recurringInvoice.update(id, data);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Updated recurring invoice template: ${result.name} (${result.id})`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Recurring invoice template not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

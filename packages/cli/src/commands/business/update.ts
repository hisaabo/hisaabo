import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";

interface BusinessUpdateOpts {
  name?: string;
  gstin?: string;
  address?: string;
  state?: string;
  phone?: string;
  email?: string;
  financialYearStart?: string;
  json?: boolean;
}

export async function businessUpdateCommand(opts: BusinessUpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Build update payload — only include provided fields
  const payload: Record<string, unknown> = {};
  if (opts.name !== undefined) payload["name"] = opts.name;
  if (opts.gstin !== undefined) payload["gstin"] = opts.gstin;
  if (opts.address !== undefined) payload["address"] = opts.address;
  if (opts.state !== undefined) payload["state"] = opts.state;
  if (opts.phone !== undefined) payload["phone"] = opts.phone;
  if (opts.email !== undefined) payload["email"] = opts.email;
  if (opts.financialYearStart !== undefined) {
    const month = parseInt(opts.financialYearStart, 10);
    if (isNaN(month) || month < 1 || month > 12) {
      fatalError("--financial-year-start must be a month number (1–12).", EXIT.USAGE);
    }
    payload["financialYearStart"] = month;
  }

  if (Object.keys(payload).length === 0) {
    fatalError("No fields to update. Pass at least one option (--name, --gstin, etc.).", EXIT.USAGE);
  }

  try {
    const result = await client.business.update(payload);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success("Business settings updated.");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") {
        const msgs = Object.entries(err.fields)
          .map(([f, ms]) => `  ${f}: ${ms.join(", ")}`)
          .join("\n");
        fatalError(`Validation failed:\n${msgs}`, EXIT.VALIDATION);
      }
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

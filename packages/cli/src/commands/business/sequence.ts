import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";

interface BusinessSequenceOpts {
  type?: string;
  prefix?: string;
  nextNumber?: string;
  json?: boolean;
}

export async function businessSequenceCommand(opts: BusinessSequenceOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.type) {
    fatalError("--type is required (sale or purchase).", EXIT.USAGE);
  }
  if (opts.type !== "sale" && opts.type !== "purchase") {
    fatalError("--type must be 'sale' or 'purchase'.", EXIT.USAGE);
  }

  const payload: Record<string, unknown> = { type: opts.type };
  if (opts.prefix !== undefined) payload["prefix"] = opts.prefix;
  if (opts.nextNumber !== undefined) {
    const n = parseInt(opts.nextNumber, 10);
    if (isNaN(n) || n < 1) {
      fatalError("--next-number must be a positive integer.", EXIT.USAGE);
    }
    payload["nextNumber"] = n;
  }

  if (Object.keys(payload).length === 1) {
    fatalError("Pass at least one of --prefix or --next-number.", EXIT.USAGE);
  }

  try {
    const result = await client.business.updateSequenceNumber(payload);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const typeLabel = opts.type === "sale" ? "Sales" : "Purchase";
    const parts: string[] = [];
    if (opts.prefix !== undefined) parts.push(`prefix → "${opts.prefix}"`);
    if (opts.nextNumber !== undefined) parts.push(`next number → ${opts.nextNumber}`);
    success(`${typeLabel} invoice sequence updated: ${parts.join(", ")}.`);
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

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface SwitchBaseUnitOpts {
  unit?: string;
  conversionFactor?: string;
  json?: boolean;
}

export async function itemSwitchBaseUnitCommand(id: string, opts: SwitchBaseUnitOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.unit) {
    fatalError("--unit is required", EXIT.USAGE);
  }

  const conversionFactor = opts.conversionFactor ? parseFloat(opts.conversionFactor) : undefined;

  try {
    const result = await client.item.switchBaseUnit({ itemId: id, unit: opts.unit, conversionFactor });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Switched base unit for item ${id} to: ${opts.unit}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

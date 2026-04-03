import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface RenameUnitOpts {
  old?: string;
  new?: string;
  json?: boolean;
}

export async function itemRenameUnitCommand(id: string, opts: RenameUnitOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.old) fatalError("--old is required", EXIT.USAGE);
  if (!opts.new) fatalError("--new is required", EXIT.USAGE);

  try {
    const result = await client.item.renameUnit({ itemId: id, oldUnit: opts.old, newUnit: opts.new });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Renamed unit '${opts.old}' to '${opts.new}' for item ${id}`);
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

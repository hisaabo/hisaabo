import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { outputJSON, EXIT, fatalError, success } from "../../output.js";

export async function storeItemsToggleCommand(opts: {
  enable?: string;
  disable?: string;
  json?: boolean;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.enable && !opts.disable) {
    fatalError("At least one of --enable or --disable is required", EXIT.USAGE);
  }

  const enableIds = opts.enable ? opts.enable.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const disableIds = opts.disable ? opts.disable.split(",").map((s) => s.trim()).filter(Boolean) : [];

  try {
    const result = await client.store.bulkToggleItems({ enable: enableIds, disable: disableIds });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    if (enableIds.length > 0) success(`Enabled ${enableIds.length} item(s)`);
    if (disableIds.length > 0) success(`Disabled ${disableIds.length} item(s)`);
    console.log();

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

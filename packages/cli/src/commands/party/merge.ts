import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

interface MergeOpts {
  yes?: boolean;
  json?: boolean;
}

export async function partyMergeCommand(sourceId: string, targetId: string, opts: MergeOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`  Merge party ${sourceId} into ${targetId}? All invoices and payments will be moved. This cannot be undone.`, opts);

  try {
    const result = await client.party.merge({ sourceId, targetId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Merged into ${targetId}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

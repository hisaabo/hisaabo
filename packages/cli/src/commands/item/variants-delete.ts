import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

interface VariantsDeleteOpts {
  yes?: boolean;
  json?: boolean;
}

export async function itemVariantsDeleteCommand(variantId: string, opts: VariantsDeleteOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`  Delete variant ${variantId}?`, opts);

  try {
    const result = await client.item.deleteVariant({ variantId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Deleted variant: ${variantId}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Variant not found: ${variantId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

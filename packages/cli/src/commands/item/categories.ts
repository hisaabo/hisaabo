import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

interface CategoriesOpts {
  json?: boolean;
}

export async function itemCategoriesCommand(opts: CategoriesOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const categories = await client.item.categories();

    if (opts.json) {
      outputJSON(categories);
      return;
    }

    if (!Array.isArray(categories) || categories.length === 0) {
      console.log("  (no categories)\n");
      return;
    }

    console.log();
    for (const cat of categories) {
      process.stdout.write(`  ${cat}\n`);
    }
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT } from "../../output.js";

interface CategoriesOpts {
  json?: boolean;
}

export async function expenseCategoriesCommand(opts: CategoriesOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const categories = await client.expense.categories();

    if (opts.json) {
      outputJSON(categories);
      return;
    }

    if (!categories || categories.length === 0) {
      console.log("\n  No expense categories found.\n");
      return;
    }

    console.log(`\n  Expense Categories  (${categories.length})\n`);
    for (const cat of categories) {
      console.log(`    ${cat}`);
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

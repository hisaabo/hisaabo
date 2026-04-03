import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import chalk from "chalk";

export async function storeCheckSlugCommand(
  slug: string,
  opts: { json?: boolean },
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.store.checkSlug({ slug });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const available =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)["available"]
        : result;

    if (available) {
      if (hasColor()) {
        process.stdout.write(chalk.green(`\n  ✓ "${slug}" is available\n\n`));
      } else {
        process.stdout.write(`\n  OK: "${slug}" is available\n\n`);
      }
    } else {
      if (hasColor()) {
        process.stdout.write(chalk.red(`\n  ✗ "${slug}" is already taken\n\n`));
      } else {
        process.stdout.write(`\n  TAKEN: "${slug}" is already taken\n\n`);
      }
    }
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

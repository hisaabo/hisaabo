import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, hasColor } from "../../output.js";
import chalk from "chalk";

interface ApiKeyCreateOpts {
  name: string;
  json?: boolean;
}

export async function apiKeyCreateCommand(opts: ApiKeyCreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.name || opts.name.trim().length === 0) {
    fatalError("--name is required.", EXIT.USAGE);
  }

  try {
    const result = await client.apiKey.create({ name: opts.name.trim() });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const key = String(result?.key ?? result?.apiKey ?? result?.token ?? "");
    const id = String(result?.id ?? "");

    // Security banner — key is shown ONLY ONCE
    if (hasColor()) {
      process.stdout.write("\n");
      process.stdout.write(chalk.bold.green("  ✓ API key created successfully!\n"));
      process.stdout.write("\n");
      process.stdout.write(chalk.bold.yellow("  ⚠  IMPORTANT: Copy this key now — it will NOT be shown again.\n"));
      process.stdout.write("\n");
      if (key) {
        process.stdout.write("  " + chalk.bold("Your API key:") + "\n");
        process.stdout.write("\n");
        process.stdout.write("  " + chalk.cyan.bold(key) + "\n");
        process.stdout.write("\n");
      }
      process.stdout.write(chalk.dim("  Use it with: hisaabo login --token <key>\n"));
      process.stdout.write(chalk.dim("  Or set env: HISAABO_TOKEN=" + (key ? key : "<key>") + "\n"));
      if (id) process.stdout.write(chalk.dim(`\n  Key ID: ${id}\n`));
      process.stdout.write("\n");
    } else {
      process.stdout.write("\nAPI key created successfully!\n\n");
      process.stdout.write("IMPORTANT: Copy this key now — it will NOT be shown again.\n\n");
      if (key) {
        process.stdout.write(`Your API key:\n\n  ${key}\n\n`);
        process.stdout.write(`Usage: hisaabo login --token ${key}\n`);
      }
      if (id) process.stdout.write(`Key ID: ${id}\n`);
      process.stdout.write("\n");
    }
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

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { outputJSON, EXIT, fatalError, success } from "../../output.js";

export async function storeUpdateSettingsCommand(opts: {
  slug?: string;
  tagline?: string;
  enabled?: string;
  json?: boolean;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const data: Record<string, unknown> = {};
  if (opts.slug !== undefined) data["storeSlug"] = opts.slug;
  if (opts.tagline !== undefined) data["storeDescription"] = opts.tagline;
  if (opts.enabled !== undefined) {
    if (opts.enabled !== "true" && opts.enabled !== "false") {
      fatalError("--enabled must be 'true' or 'false'", EXIT.USAGE);
    }
    data["storeEnabled"] = opts.enabled === "true";
  }

  if (Object.keys(data).length === 0) {
    fatalError("At least one option is required (--slug, --tagline, --enabled)", EXIT.USAGE);
  }

  try {
    const result = await client.store.updateSettings(data);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success("Store settings updated");
    console.log(`  Enabled:  ${result.storeEnabled ? "Yes" : "No"}`);
    if (result.storeSlug) console.log(`  Slug:     ${result.storeSlug}`);
    if (result.storeName) console.log(`  Name:     ${result.storeName}`);
    if (result.storeDescription) console.log(`  About:    ${result.storeDescription}`);
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

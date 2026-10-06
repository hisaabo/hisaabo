import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, outputJSON, EXIT } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

interface ApiKeyRevokeOpts {
  yes?: boolean;
  json?: boolean;
}

export async function apiKeyRevokeCommand(id: string, opts: ApiKeyRevokeOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit(`  Revoke API key ${id}? This cannot be undone.`, opts);

  try {
    const result = await client.apiKey.revoke({ id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`API key revoked: ${id}`);
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`API key not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, success, EXIT } from "../../output.js";
import { confirmOrExit } from "../../safety.js";

export async function revokeAllSessionsCommand(opts: { yes?: boolean } = {}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  await confirmOrExit("Sign out from all devices?", opts);

  try {
    await client.auth.logoutAll();
    success("Signed out from all devices.");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

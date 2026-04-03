import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

const VALID_ROLES = ["admin", "seller_manager", "seller", "accountant"] as const;
type TenantRole = typeof VALID_ROLES[number];

interface UpdateRoleOpts {
  json?: boolean;
}

export async function tenantUpdateRoleCommand(userId: string, role: string, opts: UpdateRoleOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!VALID_ROLES.includes(role as TenantRole)) {
    fatalError(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`, EXIT.VALIDATION);
  }

  try {
    const result = await client.tenant.updateMemberRole({ userId, role });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Updated role for member ${userId} to ${role}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Member not found: ${userId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

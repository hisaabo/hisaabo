import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

const VALID_ROLES = ["admin", "seller_manager", "seller", "accountant"] as const;
type TenantRole = typeof VALID_ROLES[number];

function isTenantRole(v: string): v is TenantRole {
  return (VALID_ROLES as readonly string[]).includes(v);
}

interface InviteOpts {
  role?: string;
  json?: boolean;
}

export async function tenantInviteCommand(email: string, opts: InviteOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const requested = opts.role ?? "seller";
  if (!isTenantRole(requested)) {
    fatalError(`Invalid role "${requested}". Must be one of: ${VALID_ROLES.join(", ")}`, EXIT.VALIDATION);
  }
  const role: TenantRole = requested;

  try {
    const result = await client.tenant.inviteMember({ email, role });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Invited ${email} as ${role} (invitation emailed)`);
    if (result.inviteUrl) console.log(`  Invite link: ${result.inviteUrl}`);
    console.log(`  Expires: ${result.expiresAt.toISOString()}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

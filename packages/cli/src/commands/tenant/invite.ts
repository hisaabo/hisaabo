import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

const VALID_ROLES = ["admin", "seller_manager", "seller", "accountant"] as const;
type TenantRole = typeof VALID_ROLES[number];

interface InviteResult {
  inviteToken?: string;
  inviteLink?: string;
  message?: string;
}

interface InviteOpts {
  role?: string;
  json?: boolean;
}

export async function tenantInviteCommand(email: string, opts: InviteOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const role: TenantRole = (opts.role as TenantRole) ?? "seller";

  if (!VALID_ROLES.includes(role)) {
    fatalError(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`, EXIT.VALIDATION);
  }

  try {
    const result = await client.tenant.inviteMember({ email, role }) as InviteResult;

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Invited ${email} as ${role}`);
    if (result.inviteLink) {
      console.log(`  Invite link: ${result.inviteLink}`);
    } else if (result.inviteToken) {
      console.log(`  Invite token: ${result.inviteToken}`);
    }
    if (result.message) {
      console.log(`  ${result.message}`);
    }

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

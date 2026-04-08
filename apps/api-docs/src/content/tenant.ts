import type { EndpointGroup } from "./types";

export const tenantEndpoints: EndpointGroup = {
  id: "tenant",
  title: "Organizations",
  description: "Manage organizations (tenants). Each organization can contain multiple businesses. Handle member invitations, role assignments, and organization switching. In multi-tenant mode, each user gets their own organization on registration.",
  endpoints: [
    {
      id: "tenant-create",
      method: "mutation",
      path: "tenant.create",
      title: "Create Organization",
      description: "Create a new organization for the authenticated user. The user becomes the owner. In multi-tenant mode (`MULTI_TENANT=true`), a dedicated database is provisioned for the new organization. In self-hosted mode, the user joins or creates the default organization instead. The new organization is auto-selected in the current session.",
      auth: "protected",
      input: [],
      output: {
        description: "The new organization's ID and name. The session is updated to point to this organization.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Rahul's Organization",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{}}'`,
        javascript: `const result = await trpc.tenant.create.mutate();
console.log("Created org:", result.tenantName);
// Session is auto-switched to the new organization`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.create",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {}},
)
data = resp.json()["result"]["data"]["json"]
print("New org:", data["tenantName"])`,
      },
      gotchas: [
        "Enforces plan limits — free tier users can only own a limited number of organizations. Returns FORBIDDEN if the limit is reached.",
        "In multi-tenant mode, this provisions a new PostgreSQL database for the organization. If provisioning fails, the tenant row is rolled back automatically.",
        "In self-hosted mode (`MULTI_TENANT` not set), all users share the default organization. The first user becomes the owner; subsequent users get the `member` role.",
        "The session's tenantId is updated automatically — no need to call `tenant.select` after creation.",
      ],
    },
    {
      id: "tenant-can-create-org",
      method: "query",
      path: "tenant.canCreateOrg",
      title: "Check Organization Creation Limit",
      description: "Check whether the authenticated user can create a new organization based on their plan limits. Looks at all organizations the user owns, picks the highest plan tier, and checks whether the org count is within that plan's `maxOwnedOrgs` limit.",
      auth: "protected",
      input: [],
      output: {
        description: "Boolean indicating whether the user can create another organization.",
        example: true,
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.canCreateOrg" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const canCreate = await trpc.tenant.canCreateOrg.query();
if (canCreate) {
  // Show "Create Organization" button
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.canCreateOrg",
    headers={"Authorization": f"Bearer {session_token}"},
)
can_create = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a `query` (GET) — not a mutation. Use `.query()` not `.mutate()`.",
        "Use this check before showing a 'Create Organization' button in the UI to avoid showing actions that will fail server-side.",
      ],
    },
    {
      id: "tenant-list",
      method: "query",
      path: "tenant.list",
      title: "List Organizations",
      description: "List all organizations the authenticated user is a member of. Returns only active organizations with the user's role, plan, and display information. Used for the organization switcher UI.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of organization memberships with tenant details.",
        example: [
          {
            tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
            role: "owner",
            tenantName: "Gupta Trading Co.",
            tenantSlug: "gupta-trading-co-abc123",
            tenantPlan: "pro",
          },
          {
            tenantId: "01957a2b-4d5e-6f78-9012-abcdef543210",
            role: "member",
            tenantName: "Sharma Enterprises",
            tenantSlug: "sharma-enterprises-xyz789",
            tenantPlan: "free",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const orgs = await trpc.tenant.list.query();
for (const org of orgs) {
  console.log(\`\${org.tenantName} — role: \${org.role}, plan: \${org.tenantPlan}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.list",
    headers={"Authorization": f"Bearer {session_token}"},
)
orgs = resp.json()["result"]["data"]["json"]
for org in orgs:
    print(f"{org['tenantName']} — {org['role']}")`,
      },
      gotchas: [
        "Only returns organizations with `status = 'active'` — deactivated orgs are excluded.",
        "The `role` reflects the user's role within that organization, not a global role.",
      ],
    },
    {
      id: "tenant-my-invitations",
      method: "query",
      path: "tenant.myInvitations",
      title: "My Pending Invitations",
      description: "List pending organization invitations for the authenticated user's email address. Used by the NoOrgScreen to show 'You've been invited to [Org]' when a user has no organization membership yet. Only returns invitations that have not been accepted and have not expired.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of pending invitations with organization name and assigned role.",
        example: [
          {
            id: "01957a2b-9999-aaaa-bbbb-ccccddddeeee",
            tenantName: "Gupta Trading Co.",
            role: "seller",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.myInvitations" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const invites = await trpc.tenant.myInvitations.query();
if (invites.length > 0) {
  console.log("You have pending invitations!");
  // Show accept/decline UI
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.myInvitations",
    headers={"Authorization": f"Bearer {session_token}"},
)
invites = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Matches invitations by the user's email (case-insensitive).",
        "Expired invitations (older than 7 days) are automatically excluded.",
        "To accept an invitation from this list, use `tenant.acceptById` with the invitation ID.",
      ],
      relatedEndpoints: ["tenant-accept-by-id"],
    },
    {
      id: "tenant-accept-by-id",
      method: "mutation",
      path: "tenant.acceptById",
      title: "Accept Invitation by ID",
      description: "Accept an organization invitation by its ID. Used when the user sees pending invitations in-app (from `tenant.myInvitations`) and clicks accept — no email token needed. Verifies the invitation belongs to the user's email. If the user is already a member, idempotently marks the invitation as accepted and selects the organization.",
      auth: "protected",
      input: [
        { name: "invitationId", type: "string (UUID)", required: true, description: "The invitation ID from `tenant.myInvitations`" },
      ],
      output: {
        description: "The organization the user joined. Session is auto-switched.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Gupta Trading Co.",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.acceptById \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"invitationId":"01957a2b-9999-aaaa-bbbb-ccccddddeeee"}}'`,
        javascript: `const result = await trpc.tenant.acceptById.mutate({
  invitationId: "01957a2b-9999-aaaa-bbbb-ccccddddeeee",
});
console.log("Joined:", result.tenantName);
// Session is now pointed at this organization`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.acceptById",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"invitationId": "01957a2b-9999-aaaa-bbbb-ccccddddeeee"}},
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the invitation doesn't exist, has expired, or belongs to a different email.",
        "Idempotent — calling this multiple times for the same invitation is safe.",
        "The session is auto-selected to the joined organization — no need to call `tenant.select`.",
        "Membership creation and invitation acceptance happen atomically in a transaction.",
      ],
      relatedEndpoints: ["tenant-my-invitations", "tenant-accept-invitation"],
    },
    {
      id: "tenant-select",
      method: "mutation",
      path: "tenant.select",
      title: "Switch Organization",
      description: "Switch the current session to a different organization. Updates the session's `tenantId` and invalidates the in-process session cache so subsequent requests pick up the new organization context. The user must be a member of the target organization.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (UUID)", required: true, description: "The organization to switch to" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.select \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"tenantId":"01957a2b-3c4d-7e8f-9012-abcdef012345"}}'`,
        javascript: `await trpc.tenant.select.mutate({
  tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
});
// All subsequent API calls now operate under the selected organization`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.select",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"tenantId": "01957a2b-3c4d-7e8f-9012-abcdef012345"}},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN if the user is not a member of the target organization.",
        "The session cache is invalidated immediately — no stale data on the next request.",
        "After switching, all `tenantProcedure` and `businessProcedure` calls operate under the new organization.",
      ],
    },
    {
      id: "tenant-current",
      method: "query",
      path: "tenant.current",
      title: "Get Current Organization",
      description: "Returns full details of the currently selected organization (tenant). Requires that the session has a selected tenant (use `tenant.select` first if needed).",
      auth: "protected",
      input: [],
      output: {
        description: "Full tenant record or null if not found.",
        example: {
          id: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          name: "Gupta Trading Co.",
          slug: "gupta-trading-co-abc123",
          plan: "pro",
          status: "active",
          createdAt: "2026-01-15T05:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.current" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const org = await trpc.tenant.current.query();
console.log("Current org:", org?.name, "Plan:", org?.plan);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.current",
    headers={"Authorization": f"Bearer {session_token}"},
)
org = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a session with a selected organization. Returns UNAUTHORIZED if no tenant is selected.",
        "Returns `null` if the tenant row no longer exists (edge case after deletion).",
      ],
    },
    {
      id: "tenant-members",
      method: "query",
      path: "tenant.members",
      title: "List Members",
      description: "List all members of the currently selected organization. Returns user details (name, email) along with their role and membership dates. Useful for the team management page.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of organization members with user details.",
        example: [
          {
            id: "membership-uuid",
            userId: "user-uuid-1",
            role: "owner",
            acceptedAt: "2026-01-15T05:30:00.000Z",
            createdAt: "2026-01-15T05:30:00.000Z",
            userName: "Rahul Sharma",
            userEmail: "rahul@guptaenterprises.in",
          },
          {
            id: "membership-uuid-2",
            userId: "user-uuid-2",
            role: "seller",
            acceptedAt: "2026-02-10T11:00:00.000Z",
            createdAt: "2026-02-10T10:45:00.000Z",
            userName: "Priya Patel",
            userEmail: "priya@guptaenterprises.in",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.members" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const members = await trpc.tenant.members.query();
for (const m of members) {
  console.log(\`\${m.userName} (\${m.userEmail}) — \${m.role}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.members",
    headers={"Authorization": f"Bearer {session_token}"},
)
members = resp.json()["result"]["data"]["json"]
for m in members:
    print(f"{m['userName']} — {m['role']}")`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a selected organization in the session.",
        "Returns all members regardless of role — filter client-side if needed.",
      ],
    },
    {
      id: "tenant-invite-member",
      method: "mutation",
      path: "tenant.inviteMember",
      title: "Invite Member",
      description: "Send an invitation to join the current organization. The invitation is emailed to the specified address with a unique, one-time token. Only owners and admins can invite members. Enforces team member limits based on the organization's plan.",
      auth: "protected",
      input: [
        { name: "email", type: "string (email)", required: true, description: "Email address to invite" },
        { name: "role", type: "enum", required: false, description: "Role to assign when invitation is accepted", default: "seller", enumValues: ["admin", "seller_manager", "seller", "accountant"] },
      ],
      output: {
        description: "The raw invitation token (for the email link) and expiration date.",
        example: {
          token: "abc123def456ghi789jkl012mno345pq",
          expiresAt: "2026-04-15T05:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.inviteMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"email":"priya@guptaenterprises.in","role":"seller"}}'`,
        javascript: `const invite = await trpc.tenant.inviteMember.mutate({
  email: "priya@guptaenterprises.in",
  role: "seller",
});
console.log("Invitation sent, expires:", invite.expiresAt);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.inviteMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"email": "priya@guptaenterprises.in", "role": "seller"}},
)
data = resp.json()["result"]["data"]["json"]
print("Token:", data["token"])`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can invite members. Returns FORBIDDEN otherwise.",
        "Returns CONFLICT if the email is already a member of the organization.",
        "Returns CONFLICT if a pending (unexpired) invitation for this email already exists.",
        "Invitations expire after 7 days. The token is a 32-character nanoid with ~192 bits of entropy.",
        "The token is hashed (SHA-256) before storage — only the raw token sent via email can be used to accept.",
        "If RESEND_API_KEY is not configured, the invitation email is skipped (but the invitation is still created).",
        "Enforces team member plan limits before creating the invitation.",
      ],
      relatedEndpoints: ["tenant-accept-invitation", "tenant-pending-invitations", "tenant-revoke-invitation"],
    },
    {
      id: "tenant-peek-invitation",
      method: "query",
      path: "tenant.peekInvitation",
      title: "Peek Invitation",
      description: "Preview invitation details without accepting it. Used by the onboarding flow to show 'Join [Org] or create your own?' before committing. Public because new users may not have a session yet. Deliberately omits the invitee's email to prevent PII leakage via token possession.",
      auth: "public",
      input: [
        { name: "token", type: "string", required: true, description: "The raw invitation token from the email link (1-128 chars)" },
      ],
      output: {
        description: "Organization name and role, or null if the token is invalid/expired/already accepted.",
        example: {
          tenantName: "Gupta Trading Co.",
          role: "seller",
        },
      },
      codeExamples: {
        curl: `# Token comes from the /invite/:token URL
curl "https://api.hisaabo.in/api/trpc/tenant.peekInvitation?input=%7B%22json%22%3A%7B%22token%22%3A%22abc123def456ghi789jkl012mno345pq%22%7D%7D"`,
        javascript: `// Extract token from URL: /invite/abc123def456...
const token = params.token;

const preview = await trpc.tenant.peekInvitation.query({ token });
if (preview) {
  console.log(\`Invited to \${preview.tenantName} as \${preview.role}\`);
} else {
  console.log("Invitation is invalid or expired");
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"token": "abc123def456ghi789jkl012mno345pq"}}))
resp = httpx.get(f"https://api.hisaabo.in/api/trpc/tenant.peekInvitation?input={params}")
preview = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a public endpoint — no authentication required.",
        "Returns `null` (not an error) if the token is invalid, expired, or already accepted.",
        "Security: the response deliberately omits the invitee email to prevent PII leakage.",
        "The token has ~192 bits of entropy (nanoid(32)), making brute-force infeasible.",
      ],
      relatedEndpoints: ["tenant-accept-invitation"],
    },
    {
      id: "tenant-accept-invitation",
      method: "mutation",
      path: "tenant.acceptInvitation",
      title: "Accept Invitation by Token",
      description: "Accept an organization invitation using the raw token from the email link. Verifies the token, checks the invitation email matches the authenticated user's email, creates membership, and marks the invitation as accepted — all atomically in a transaction. Idempotent: re-accepting an already-accepted invitation is safe and will re-add the user if they were removed.",
      auth: "protected",
      input: [
        { name: "token", type: "string", required: true, description: "The raw invitation token from the email link" },
      ],
      output: {
        description: "The organization the user joined. Session is auto-switched.",
        example: {
          tenantId: "01957a2b-3c4d-7e8f-9012-abcdef012345",
          tenantName: "Gupta Trading Co.",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.acceptInvitation \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"token":"abc123def456ghi789jkl012mno345pq"}}'`,
        javascript: `const result = await trpc.tenant.acceptInvitation.mutate({
  token: "abc123def456ghi789jkl012mno345pq",
});
console.log("Joined:", result.tenantName);
// Session is now pointed at the joined organization`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.acceptInvitation",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"token": "abc123def456ghi789jkl012mno345pq"}},
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the token is invalid or expired.",
        "Returns FORBIDDEN if the invitation was sent to a different email than the authenticated user's.",
        "Idempotent — re-accepting an already-accepted invitation is safe. If the user was removed and re-accepts, they are re-added.",
        "Membership creation and invitation acceptance are wrapped in a transaction to prevent partial state.",
        "The session is auto-selected to the joined organization.",
      ],
      relatedEndpoints: ["tenant-peek-invitation", "tenant-accept-by-id"],
    },
    {
      id: "tenant-pending-invitations",
      method: "query",
      path: "tenant.pendingInvitations",
      title: "List Pending Invitations",
      description: "List all pending (not yet accepted) invitations for the current organization. Shows the invitee email, assigned role, and who sent the invitation. Only includes unexpired invitations. Used in the team management UI to show outstanding invites.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of pending invitations sorted by creation date (newest first).",
        example: [
          {
            id: "invite-uuid-1",
            email: "priya@guptaenterprises.in",
            role: "seller",
            createdAt: "2026-04-08T10:30:00.000Z",
            expiresAt: "2026-04-15T10:30:00.000Z",
            invitedByName: "Rahul Sharma",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/tenant.pendingInvitations" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const pending = await trpc.tenant.pendingInvitations.query();
console.log(\`\${pending.length} pending invitations\`);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/tenant.pendingInvitations",
    headers={"Authorization": f"Bearer {session_token}"},
)
pending = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Uses `tenantProcedure` — requires a selected organization in the session.",
        "Only shows unexpired, unaccepted invitations. Expired invitations are filtered out automatically.",
      ],
      relatedEndpoints: ["tenant-invite-member", "tenant-revoke-invitation"],
    },
    {
      id: "tenant-revoke-invitation",
      method: "mutation",
      path: "tenant.revokeInvitation",
      title: "Revoke Invitation",
      description: "Revoke (delete) a pending invitation. The invitation link will no longer work. Only owners and admins can revoke invitations. Only unaccepted invitations belonging to the current organization can be revoked.",
      auth: "protected",
      input: [
        { name: "invitationId", type: "string (UUID)", required: true, description: "The invitation ID to revoke" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.revokeInvitation \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"invitationId":"invite-uuid-1"}}'`,
        javascript: `await trpc.tenant.revokeInvitation.mutate({
  invitationId: "invite-uuid-1",
});`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.revokeInvitation",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"invitationId": "invite-uuid-1"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can revoke invitations. Returns FORBIDDEN otherwise.",
        "Silently succeeds if the invitation was already accepted or doesn't exist — it only deletes unaccepted invitations.",
      ],
      relatedEndpoints: ["tenant-pending-invitations", "tenant-invite-member"],
    },
    {
      id: "tenant-remove-member",
      method: "mutation",
      path: "tenant.removeMember",
      title: "Remove Member",
      description: "Remove a member from the current organization. Deletes their membership and immediately invalidates any active sessions associated with the removed user and this organization. The removed user will be logged out of this org on their next API call. Cannot remove yourself or a superadmin/owner.",
      auth: "protected",
      input: [
        { name: "userId", type: "string (UUID)", required: true, description: "The user ID of the member to remove" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.removeMember \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"userId":"user-uuid-2"}}'`,
        javascript: `await trpc.tenant.removeMember.mutate({
  userId: "user-uuid-2",
});
// The removed user's sessions for this org are immediately invalidated`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.removeMember",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"userId": "user-uuid-2"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can remove members. Returns FORBIDDEN otherwise.",
        "Returns BAD_REQUEST if you try to remove yourself — use a different admin to remove your account.",
        "Returns FORBIDDEN if you try to remove an owner or superadmin.",
        "The removed user's sessions for this organization are immediately cleared (tenantId set to null) and the session cache is invalidated.",
      ],
      relatedEndpoints: ["tenant-members", "tenant-update-member-role"],
    },
    {
      id: "tenant-update-member-role",
      method: "mutation",
      path: "tenant.updateMemberRole",
      title: "Update Member Role",
      description: "Change a member's role within the current organization. Only owners and admins can change roles. Cannot change the role of an owner or superadmin.",
      auth: "protected",
      input: [
        { name: "userId", type: "string (UUID)", required: true, description: "The user ID whose role to change" },
        { name: "role", type: "enum", required: true, description: "The new role to assign", enumValues: ["admin", "seller_manager", "seller", "accountant"] },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/tenant.updateMemberRole \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"userId":"user-uuid-2","role":"admin"}}'`,
        javascript: `await trpc.tenant.updateMemberRole.mutate({
  userId: "user-uuid-2",
  role: "admin",
});`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/tenant.updateMemberRole",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"userId": "user-uuid-2", "role": "admin"}},
)`,
      },
      gotchas: [
        "Only owners, superadmins, and admins can change roles. Returns FORBIDDEN otherwise.",
        "Cannot change the role of an owner or superadmin — these are immutable.",
        "Available roles: `admin` (full access), `seller_manager` (manage sellers), `seller` (create invoices), `accountant` (financial access).",
      ],
      relatedEndpoints: ["tenant-members", "tenant-remove-member"],
    },
  ],
};

/**
 * Tenant (organization) tools — manage the current tenant membership and team.
 *
 * Tools registered:
 *   tenant_list               — list all tenants the current user belongs to
 *   tenant_members            — list all members of the current tenant
 *   tenant_invite_member      — send an invitation to join the tenant
 *   tenant_remove_member      — remove a member from the tenant
 *   tenant_update_member_role — change a member's role
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const MEMBER_ROLES = ["admin", "seller_manager", "seller", "accountant"] as const;

export function registerTenantTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "tenant_list",
    [
      "List all organizations (tenants) that the current user is a member of.",
      "Each entry includes the tenant UUID, name, slug, plan, and the user's role.",
      "Use this to discover which organizations are available before switching context.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const result = await client.tenant.list();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_members",
    [
      "List all members of the current tenant/organization.",
      "Returns each member's user ID, name, email, role, and when they joined.",
      "Requires the caller to be a member of the current tenant.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const result = await client.tenant.members();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_invite_member",
    [
      "Invite a user to join the current tenant by email address.",
      "Requires admin or owner role in the current tenant.",
      "The invitation link is valid for 7 days. The raw token is returned exactly once — save it to send via email.",
      "Available roles: 'admin' (full access), 'seller_manager' (manage sales team), 'seller' (create invoices), 'accountant' (read-only reports).",
    ].join(" "),
    {
      email: z.string().email()
        .describe("Email address of the person to invite."),
      role: z.enum(MEMBER_ROLES).default("seller")
        .describe("Role to assign: 'admin', 'seller_manager', 'seller', or 'accountant'."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.inviteMember(input.email, input.role);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_remove_member",
    [
      "Remove a member from the current tenant. Requires admin or owner role.",
      "Cannot remove yourself or a superadmin/owner.",
      "The removed user loses access to all businesses within this tenant immediately.",
    ].join(" "),
    {
      user_id: z.string().uuid()
        .describe("UUID of the user to remove from the tenant. Use tenant_members to find user UUIDs."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.removeMember(input.user_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_update_member_role",
    [
      "Change the role of an existing tenant member. Requires admin or owner role.",
      "Cannot change the role of a superadmin or owner.",
      "Available roles: 'admin' (full access), 'seller_manager', 'seller', 'accountant' (read-only).",
    ].join(" "),
    {
      user_id: z.string().uuid()
        .describe("UUID of the member whose role you want to change."),
      role: z.enum(MEMBER_ROLES)
        .describe("New role: 'admin', 'seller_manager', 'seller', or 'accountant'."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.updateMemberRole(input.user_id, input.role);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_pending_invitations",
    [
      "List pending (unaccepted) invitations for the current tenant.",
      "Shows email, role, inviter name, and expiry date.",
      "Only owners and admins can view pending invitations.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const invitations = await client.tenant.pendingInvitations();
      return {
        content: [{
          type: "text" as const,
          text: invitations.length === 0
            ? "No pending invitations."
            : JSON.stringify(invitations, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_revoke_invitation",
    [
      "Revoke a pending invitation by its ID.",
      "Only owners and admins can revoke invitations.",
      "Use tenant_pending_invitations to find invitation IDs.",
    ].join(" "),
    {
      invitation_id: z.string().uuid()
        .describe("The UUID of the invitation to revoke. Use tenant_pending_invitations to find IDs."),
    },
    wrapTool(async (input) => {
      await client.tenant.revokeInvitation(input.invitation_id);
      return {
        content: [{
          type: "text" as const,
          text: "Invitation revoked successfully.",
        }],
      };
    })
  );
}

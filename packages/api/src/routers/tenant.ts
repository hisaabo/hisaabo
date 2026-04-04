import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { controlDb, tenants, tenantMembers, invitations, users, sessions } from "@hisaabo/db";
import { eq, and, gt, isNull, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { router, protectedProcedure, tenantProcedure } from "../trpc.js";
import { invalidateSessionCache } from "../context.js";
import { emailService } from "../lib/email.js";

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function autoSelectTenantInSession(req: Request, tenantId: string): Promise<string> {
  const sessionId = getCookieFromRequest(req, "session_id");
  if (sessionId) {
    await controlDb.update(sessions)
      .set({ tenantId })
      .where(eq(sessions.id, sessionId));
    invalidateSessionCache(sessionId);
  }
  const [tenant] = await controlDb.select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return tenant?.name ?? "Organization";
}

export const tenantRouter = router({
  // List user's tenant memberships
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await controlDb.select({
      tenantId: tenantMembers.tenantId,
      role: tenantMembers.role,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      tenantPlan: tenants.plan,
    })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(
        eq(tenantMembers.userId, ctx.user.id),
        eq(tenants.status, "active"),
      ));
    return memberships;
  }),

  // Select/switch tenant — updates session's tenantId
  select: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify user is a member of this tenant
      const [membership] = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, input.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
      }

      // Get session ID from cookie
      const sessionId = getCookieFromRequest(ctx.req, "session_id");
      if (!sessionId) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Update session's tenantId
      await controlDb.update(sessions)
        .set({ tenantId: input.tenantId })
        .where(eq(sessions.id, sessionId));

      // Invalidate cached session so the next request picks up the new tenant
      invalidateSessionCache(sessionId);

      return { success: true };
    }),

  // Get current tenant info
  current: tenantProcedure.query(async ({ ctx }) => {
    const [tenant] = await controlDb.select()
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    return tenant ?? null;
  }),

  // List members of current tenant
  members: tenantProcedure.query(async ({ ctx }) => {
    const members = await controlDb.select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
      role: tenantMembers.role,
      acceptedAt: tenantMembers.acceptedAt,
      createdAt: tenantMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(eq(tenantMembers.tenantId, ctx.tenantId));
    return members;
  }),

  // Invite a member
  inviteMember: tenantProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(["admin", "seller_manager", "seller", "accountant"]).default("seller"),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check caller has permission (owner/superadmin or admin)
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can invite members" });
      }

      // Check if already a member
      const [existingUser] = await controlDb.select({ id: users.id })
        .from(users).where(eq(users.email, input.email)).limit(1);

      if (existingUser) {
        const [existingMember] = await controlDb.select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, ctx.tenantId),
            eq(tenantMembers.userId, existingUser.id),
          ))
          .limit(1);

        if (existingMember) {
          throw new TRPCError({ code: "CONFLICT", message: "User is already a member" });
        }
      }

      // Check for existing pending invitation (prevent duplicates)
      const [existingInvite] = await controlDb.select({ id: invitations.id })
        .from(invitations)
        .where(and(
          eq(invitations.tenantId, ctx.tenantId),
          eq(invitations.email, input.email),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (existingInvite) {
        throw new TRPCError({ code: "CONFLICT", message: "A pending invitation for this email already exists" });
      }

      const rawToken = nanoid(32);
      const tokenHash = hashInvitationToken(rawToken);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await controlDb.insert(invitations).values({
        tenantId: ctx.tenantId,
        email: input.email,
        role: input.role,
        token: tokenHash, // Store hash, never the raw token
        invitedBy: ctx.user.id,
        expiresAt,
      });

      // Fire-and-forget invitation email — failure doesn't block invite creation
      const [tenant] = await controlDb.select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      const [inviter] = await controlDb.select({ name: users.name })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5173}`;
      const inviteUrl = `${baseUrl}/invite/${rawToken}`;

      emailService.sendInvitation(
        input.email,
        inviteUrl,
        tenant?.name ?? "Organization",
        inviter?.name ?? null,
      ).catch((err) => {
        console.error("[invite] Failed to send invitation email:", err);
      });

      // Return the raw token — this is what gets sent via email
      return { token: rawToken, expiresAt };
    }),

  // Accept an invitation
  acceptInvitation: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tokenHash = hashInvitationToken(input.token);
      const [invitation] = await controlDb.select()
        .from(invitations)
        .where(and(
          eq(invitations.token, tokenHash),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid or expired invitation" });
      }

      if (invitation.acceptedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invitation already accepted" });
      }

      // Verify the invitation email matches the authenticated user
      const [currentUser] = await controlDb.select({ email: users.email })
        .from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!currentUser || currentUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This invitation was sent to a different email address" });
      }

      // Check if already a member (e.g. double-click)
      const [existingMember] = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, invitation.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);
      if (existingMember) {
        await controlDb.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id));
        const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
        return { tenantId: invitation.tenantId, tenantName };
      }

      // Create membership and mark invitation accepted atomically so a crash
      // between the two writes cannot leave the user as a member with a
      // re-usable invitation link.
      await controlDb.transaction(async (tx) => {
        await tx.insert(tenantMembers).values({
          tenantId: invitation.tenantId,
          userId: ctx.user.id,
          role: invitation.role,
          invitedBy: invitation.invitedBy ?? undefined,
          acceptedAt: new Date(),
        });

        await tx.update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invitation.id));
      });

      const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
      return { tenantId: invitation.tenantId, tenantName };
    }),

  // List pending invitations for the current tenant
  pendingInvitations: tenantProcedure.query(async ({ ctx }) => {
    const pending = await controlDb.select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      invitedByName: users.name,
    })
      .from(invitations)
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(
        eq(invitations.tenantId, ctx.tenantId),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ))
      .orderBy(desc(invitations.createdAt));

    return pending;
  }),

  // Revoke a pending invitation
  revokeInvitation: tenantProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // Verify caller is admin/owner
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can revoke invitations" });
      }

      await controlDb.delete(invitations)
        .where(and(
          eq(invitations.id, input.invitationId),
          eq(invitations.tenantId, ctx.tenantId),
          isNull(invitations.acceptedAt),
        ));

      return { success: true };
    }),

  // Remove a member
  removeMember: tenantProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can remove members" });
      }

      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
      }

      // Prevent removing a superadmin/owner
      const [targetMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ))
        .limit(1);

      if (targetMembership && ["owner", "superadmin"].includes(targetMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove a superadmin" });
      }

      await controlDb.delete(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ));

      return { success: true };
    }),

  // Update member role
  updateMemberRole: tenantProcedure
    .input(z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "seller_manager", "seller", "accountant"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [callerMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, ctx.user.id),
        ))
        .limit(1);

      if (!callerMembership || !["owner", "superadmin", "admin"].includes(callerMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can change roles" });
      }

      // Prevent changing a superadmin/owner's role
      const [targetMembership] = await controlDb.select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ))
        .limit(1);

      if (targetMembership && ["owner", "superadmin"].includes(targetMembership.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change the role of a superadmin" });
      }

      await controlDb.update(tenantMembers)
        .set({ role: input.role })
        .where(and(
          eq(tenantMembers.tenantId, ctx.tenantId),
          eq(tenantMembers.userId, input.userId),
        ));

      return { success: true };
    }),
});

function getCookieFromRequest(req: Request, name: string): string | null {
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

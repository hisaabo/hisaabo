import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { controlDb, tenants, tenantMembers, invitations, users, sessions, provisionTenantDatabase } from "@hisaabo/db";
import { eq, and, gt, isNull, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { router, publicProcedure, protectedProcedure, tenantProcedure } from "../trpc.js";
import { invalidateSessionCache, getSessionIdFromRequest } from "../context.js";
import { emailService } from "../lib/email.js";
import { enforceTeamMemberLimit, enforceOrgCreationLimit, getLimits } from "../lib/plan-limits.js";

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function autoSelectTenantInSession(req: Request, tenantId: string): Promise<string> {
  const sessionId = getSessionIdFromRequest(req);
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

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) + "-" + nanoid(6);
}

export const tenantRouter = router({
  // Create a new organization for the authenticated user.
  // User becomes the owner. In self-hosted mode, joins the default tenant instead.
  create: protectedProcedure.mutation(async ({ ctx }) => {
    await enforceOrgCreationLimit(ctx.user.id);
    const displayName = ctx.user.name ?? ctx.user.email.split("@")[0];

    if (process.env.MULTI_TENANT === "true") {
      const tenantName = `${displayName}'s Organization`;
      const slug = generateSlug(tenantName);

      // 1. Create the tenant row
      const [tenant] = await controlDb.insert(tenants).values({
        name: tenantName,
        slug,
      }).returning({ id: tenants.id });

      // 2. Provision the tenant database (CREATE DATABASE, user, schema push)
      let dbConfig: Awaited<ReturnType<typeof provisionTenantDatabase>>;
      try {
        dbConfig = await provisionTenantDatabase(tenant.id, slug);
      } catch (err) {
        // Roll back orphaned tenant row so a retry can succeed
        await controlDb.delete(tenants).where(eq(tenants.id, tenant.id));
        throw err;
      }

      // 3. Persist DB connection details
      await controlDb.update(tenants)
        .set({
          dbName: dbConfig.dbName,
          dbHost: dbConfig.dbHost,
          dbPort: dbConfig.dbPort,
          dbUser: dbConfig.dbUser,
          dbPassword: dbConfig.dbPassword,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      // 4. Create owner membership
      await controlDb.insert(tenantMembers).values({
        tenantId: tenant.id,
        userId: ctx.user.id,
        role: "owner",
        acceptedAt: new Date(),
      });

      // Auto-select the new tenant in session
      const tenantNameResult = await autoSelectTenantInSession(ctx.req, tenant.id);
      return { tenantId: tenant.id, tenantName: tenantNameResult };
    } else {
      // Self-hosted: join/create default tenant
      let [defaultTenant] = await controlDb.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.slug, "default")).limit(1);
      if (!defaultTenant) {
        [defaultTenant] = await controlDb.insert(tenants).values({
          name: "Default Organization", slug: "default",
        }).returning({ id: tenants.id });
      }

      const memberCount = await controlDb.select({ id: tenantMembers.id })
        .from(tenantMembers).where(eq(tenantMembers.tenantId, defaultTenant.id));
      const role = memberCount.length === 0 ? "owner" : "member";

      await controlDb.insert(tenantMembers).values({
        tenantId: defaultTenant.id, userId: ctx.user.id,
        role, acceptedAt: new Date(),
      });

      const tenantNameResult = await autoSelectTenantInSession(ctx.req, defaultTenant.id);
      return { tenantId: defaultTenant.id, tenantName: tenantNameResult };
    }
  }),

  // Check if the user can create a new org (plan limit not reached).
  canCreateOrg: protectedProcedure.query(async ({ ctx }) => {
    const ownedOrgs = await controlDb.select({ plan: tenants.plan })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(and(
        eq(tenantMembers.userId, ctx.user.id),
        eq(tenantMembers.role, "owner"),
      ));

    const planRank: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
    let bestPlan = "free";
    for (const org of ownedOrgs) {
      if ((planRank[org.plan ?? "free"] ?? 0) > (planRank[bestPlan] ?? 0)) {
        bestPlan = org.plan ?? "free";
      }
    }

    const limits = getLimits(bestPlan);
    return limits.maxOwnedOrgs === Infinity || ownedOrgs.length < limits.maxOwnedOrgs;
  }),

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

  // Pending invitations for the authenticated user's email.
  // Used by the NoOrgScreen to show "You've been invited to [Org]".
  myInvitations: protectedProcedure.query(async ({ ctx }) => {
    const pending = await controlDb.select({
      id: invitations.id,
      tenantName: tenants.name,
      role: invitations.role,
    })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(and(
        eq(invitations.email, ctx.user.email.toLowerCase()),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ));
    return pending;
  }),

  // Accept invitation by ID (for users who see their pending invites in-app,
  // without having clicked the email link). Same logic as acceptInvitation
  // but looks up by ID + email match instead of raw token.
  acceptById: protectedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const [invitation] = await controlDb.select()
        .from(invitations)
        .where(and(
          eq(invitations.id, input.invitationId),
          eq(invitations.email, ctx.user.email.toLowerCase()),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invitation not found or expired" });
      }

      // Check if already a member
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

      // Get session ID from cookie or Bearer token (mobile uses Bearer)
      const sessionId = getSessionIdFromRequest(ctx.req);
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

      // Enforce team member limit before proceeding
      await enforceTeamMemberLimit(ctx.tenantId);

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
  // Preview invitation details without accepting — used by the onboarding
  // flow to show "Join [Org] or create your own?" before committing.
  // Public because new users calling this may not have a session yet.
  // Security: token is nanoid(32) (~192 bits entropy) — brute-force infeasible.
  // Response deliberately omits email to avoid leaking PII via token possession.
  peekInvitation: publicProcedure
    .input(z.object({ token: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const tokenHash = hashInvitationToken(input.token);
      const [invitation] = await controlDb.select({
        role: invitations.role,
        tenantId: invitations.tenantId,
        acceptedAt: invitations.acceptedAt,
      })
        .from(invitations)
        .where(and(
          eq(invitations.token, tokenHash),
          gt(invitations.expiresAt, new Date()),
        ))
        .limit(1);

      if (!invitation || invitation.acceptedAt) return null;

      const [tenant] = await controlDb.select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, invitation.tenantId))
        .limit(1);

      return {
        tenantName: tenant?.name ?? "Organization",
        role: invitation.role,
      };
    }),

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

      // Verify the invitation email matches the authenticated user
      const [currentUser] = await controlDb.select({ email: users.email })
        .from(users).where(eq(users.id, ctx.user.id)).limit(1);
      if (!currentUser || currentUser.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This invitation was sent to a different email address" });
      }

      // If already accepted, treat as idempotent — the user may be clicking
      // an old link or retrying after a partial failure. Check membership and
      // auto-select the tenant if they're already in.
      if (invitation.acceptedAt) {
        const [existingMember] = await controlDb.select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(
            eq(tenantMembers.tenantId, invitation.tenantId),
            eq(tenantMembers.userId, ctx.user.id),
          ))
          .limit(1);
        if (existingMember) {
          const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
          return { tenantId: invitation.tenantId, tenantName };
        }
        // Accepted but not a member (removed after accepting) — re-add them
        await controlDb.insert(tenantMembers).values({
          tenantId: invitation.tenantId,
          userId: ctx.user.id,
          role: invitation.role,
          invitedBy: invitation.invitedBy ?? undefined,
          acceptedAt: new Date(),
        });
        const tenantName = await autoSelectTenantInSession(ctx.req, invitation.tenantId);
        return { tenantId: invitation.tenantId, tenantName };
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


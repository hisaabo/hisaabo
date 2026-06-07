/**
 * Plan limits configuration.
 *
 * Free tier is generous enough to get hooked (unlimited invoices, parties, payments)
 * but gates features that matter at scale (team size, multi-business, integrations).
 *
 * Self-hosted defaults to "free" plan — same limits apply including PDF branding.
 */

import { TRPCError } from "@trpc/server";
import { eq, and, gt, isNull, count } from "drizzle-orm";
import { controlDb, tenants, tenantMembers, invitations } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";
import { businesses } from "@hisaabo/db";
import { getTenantMemberUserIds, businessTenantScope } from "./tenant-businesses.js";

// ── Plan limit definitions ────────────────────────────────────────────────────

export interface PlanLimits {
  maxOwnedOrgs: number;         // orgs a user can own (across all their tenants)
  maxBusinesses: number;        // businesses per tenant
  maxTeamMembers: number;       // members + pending invites per tenant
  maxConcurrentSessions: number;
  maxApiKeys: number;
  recurringRunsPerMonth: number;
  auditRetentionDays: number | null; // null = unlimited
  dataExport: boolean;
  onlineStore: boolean;
  pdfBranding: boolean;         // true = shows "Powered by hisaabo.in"
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxOwnedOrgs: 1,
    maxBusinesses: 1,
    maxTeamMembers: 3,
    maxConcurrentSessions: 3,
    maxApiKeys: 0,
    recurringRunsPerMonth: 5,
    auditRetentionDays: 30,
    dataExport: false,
    onlineStore: false,
    pdfBranding: true,
  },
  pro: {
    maxOwnedOrgs: 3,
    maxBusinesses: 5,
    maxTeamMembers: 15,
    maxConcurrentSessions: 10,
    maxApiKeys: 3,
    recurringRunsPerMonth: Infinity,
    auditRetentionDays: 365,
    dataExport: true,
    onlineStore: true,
    pdfBranding: false,
  },
  business: {
    maxOwnedOrgs: Infinity,
    maxBusinesses: Infinity,
    maxTeamMembers: Infinity,
    maxConcurrentSessions: Infinity,
    maxApiKeys: Infinity,
    recurringRunsPerMonth: Infinity,
    auditRetentionDays: null,
    dataExport: true,
    onlineStore: true,
    pdfBranding: false,
  },
  enterprise: {
    maxOwnedOrgs: Infinity,
    maxBusinesses: Infinity,
    maxTeamMembers: Infinity,
    maxConcurrentSessions: Infinity,
    maxApiKeys: Infinity,
    recurringRunsPerMonth: Infinity,
    auditRetentionDays: null,
    dataExport: true,
    onlineStore: true,
    pdfBranding: false,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

/** Backwards-compat export used by recurring invoice scheduler. */
export const RECURRING_RUNS_PER_MONTH_FREE = PLAN_LIMITS.free.recurringRunsPerMonth;

// ── Enforcement helpers ───────────────────────────────────────────────────────

async function getTenantPlan(tenantId: string): Promise<string> {
  const [row] = await controlDb
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.plan ?? "free";
}

/**
 * Enforce org creation limit.
 * Counts orgs the user owns and checks against the highest plan they have.
 * A user's effective plan is the best plan across all orgs they own.
 */
export async function enforceOrgCreationLimit(userId: string): Promise<void> {
  // Count orgs this user owns
  const ownedOrgs = await controlDb.select({ tenantId: tenantMembers.tenantId, plan: tenants.plan })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.role, "owner"),
    ));

  // Effective plan = best plan across all owned orgs
  const planRank: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
  let bestPlan = "free";
  for (const org of ownedOrgs) {
    if ((planRank[org.plan ?? "free"] ?? 0) > (planRank[bestPlan] ?? 0)) {
      bestPlan = org.plan ?? "free";
    }
  }

  const limits = getLimits(bestPlan);
  if (limits.maxOwnedOrgs === Infinity) return;

  if (ownedOrgs.length >= limits.maxOwnedOrgs) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your plan allows up to ${limits.maxOwnedOrgs} organization${limits.maxOwnedOrgs === 1 ? "" : "s"}. Upgrade to create more.`,
    });
  }
}

/**
 * Enforce business creation limit.
 * Counts existing businesses in the tenant DB and compares against the plan limit.
 */
export async function enforceBusinessLimit(tenantId: string, tenantDb: TenantDatabase): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limits = getLimits(plan);
  if (limits.maxBusinesses === Infinity) return;

  // Count only this tenant's businesses. In self-hosted shared-DB mode a bare
  // count would tally every tenant's businesses and wrongly block creation.
  const memberIds = await getTenantMemberUserIds(tenantId);
  const [{ count: bizCount }] = await tenantDb
    .select({ count: count() })
    .from(businesses)
    .where(businessTenantScope(memberIds));

  if (bizCount >= limits.maxBusinesses) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your plan allows up to ${limits.maxBusinesses} business${limits.maxBusinesses === 1 ? "" : "es"}. Upgrade to add more.`,
    });
  }
}

/**
 * Enforce team member limit.
 * Counts current members + pending invitations against the plan limit.
 */
export async function enforceTeamMemberLimit(tenantId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limits = getLimits(plan);
  if (limits.maxTeamMembers === Infinity) return;

  const [[members], [pending]] = await Promise.all([
    controlDb.select({ count: count() }).from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId)),
    controlDb.select({ count: count() }).from(invitations)
      .where(and(
        eq(invitations.tenantId, tenantId),
        gt(invitations.expiresAt, new Date()),
        isNull(invitations.acceptedAt),
      )),
  ]);

  const total = (members?.count ?? 0) + (pending?.count ?? 0);
  if (total >= limits.maxTeamMembers) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your plan allows up to ${limits.maxTeamMembers} team members (including pending invites). Upgrade to invite more.`,
    });
  }
}

/**
 * Enforce API key limit.
 * Called from apiKey.create — counts existing keys for the user+tenant.
 */
export async function enforceApiKeyLimit(tenantId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limits = getLimits(plan);
  if (limits.maxApiKeys === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API keys are available on paid plans. Upgrade to Pro to use the CLI and MCP server.",
    });
  }
  if (limits.maxApiKeys === Infinity) return;

  const { apiKeys } = await import("@hisaabo/db");
  const [{ count: keyCount }] = await controlDb
    .select({ count: count() })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId));

  if (keyCount >= limits.maxApiKeys) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your plan allows up to ${limits.maxApiKeys} API key${limits.maxApiKeys === 1 ? "" : "s"}. Upgrade to create more.`,
    });
  }
}

/**
 * Enforce concurrent session limit.
 * Called when creating a new session. If at the limit, the oldest session
 * is automatically revoked (FIFO) rather than blocking login.
 *
 * Accepts an optional `parentTx` so the eviction DELETE participates in the
 * surrounding sign-in transaction. Without this, a rollback of the parent tx
 * would leave the user with FEWER sessions than they started with (the old
 * session was evicted via the non-transactional controlDb, the new session
 * insert inside the tx was rolled back).
 */
type ControlTxLike = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

export async function enforceSessionLimit(userId: string, parentTx?: ControlTxLike): Promise<void> {
  const { sessions } = await import("@hisaabo/db");
  const { asc } = await import("drizzle-orm");
  const db = parentTx ?? controlDb;

  // Get the user's tenant to determine plan
  const [membership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId))
    .limit(1);

  const plan = membership ? await getTenantPlan(membership.tenantId) : "free";
  const limits = getLimits(plan);
  if (limits.maxConcurrentSessions === Infinity) return;

  const activeSessions = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(
      eq(sessions.userId, userId),
      gt(sessions.expiresAt, new Date()),
    ))
    .orderBy(asc(sessions.createdAt));

  // If at/over limit, evict the oldest session(s) to make room for the new one
  const toEvict = activeSessions.length - limits.maxConcurrentSessions + 1;
  if (toEvict > 0) {
    const evictIds = activeSessions.slice(0, toEvict).map((s) => s.id);
    const { inArray } = await import("drizzle-orm");
    await db.delete(sessions).where(inArray(sessions.id, evictIds));
  }
}

/**
 * Enforce data export access.
 */
export async function enforceDataExport(tenantId: string): Promise<void> {
  const plan = await getTenantPlan(tenantId);
  const limits = getLimits(plan);
  if (!limits.dataExport) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Data export is available on paid plans. Upgrade to export your data.",
    });
  }
}

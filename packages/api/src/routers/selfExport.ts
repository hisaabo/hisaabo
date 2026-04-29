/**
 * selfExport router
 *
 * Single procedure: selfExport.request
 * - Checks caller is an owner of the target tenant
 * - Enforces a rate limit of 2 exports per tenant per 24 hours (in-memory rolling window)
 * - Issues a signed, 5-minute single-use export token
 * - Returns { token, url, expiresAt }
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { controlDb, tenantMembers, tenants } from "@hisaabo/db";
import { router, protectedProcedure } from "../trpc.js";
import { signExportToken } from "../lib/exportToken.js";
import { logger } from "../lib/logger.js";

// ── Rate limiting: 2 exports per tenant per 24 hours ──────────────────────────
// Rolling window based on last 24h of token issuances.
// Stored in-memory; acceptable for v1 (single-instance; token TTL is 5 min).
const EXPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPORT_RATE_MAX = 2;

/** ISO timestamps of recent export issuances per tenantId */
const exportIssuanceLog = new Map<string, number[]>();

// Evict stale entries every hour
setInterval(() => {
  const cutoff = Date.now() - EXPORT_RATE_WINDOW_MS;
  for (const [tenantId, timestamps] of exportIssuanceLog) {
    const fresh = timestamps.filter((ts) => ts > cutoff);
    if (fresh.length === 0) {
      exportIssuanceLog.delete(tenantId);
    } else {
      exportIssuanceLog.set(tenantId, fresh);
    }
  }
}, 60 * 60_000).unref();

function checkAndRecordExportRateLimit(tenantId: string): void {
  const now = Date.now();
  const cutoff = now - EXPORT_RATE_WINDOW_MS;
  const existing = exportIssuanceLog.get(tenantId) ?? [];
  const recent = existing.filter((ts) => ts > cutoff);

  if (recent.length >= EXPORT_RATE_MAX) {
    const oldestMs = Math.min(...recent);
    const retryAfterSec = Math.ceil((oldestMs + EXPORT_RATE_WINDOW_MS - now) / 1000);
    const retryAfterHours = Math.ceil(retryAfterSec / 3600);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Export limit reached: maximum ${EXPORT_RATE_MAX} exports per 24 hours. Try again in approximately ${retryAfterHours} hour(s).`,
    });
  }

  exportIssuanceLog.set(tenantId, [...recent, now]);
}

// ── Router ─────────────────────────────────────────────────────────────────────

export const selfExportRouter = router({
  /**
   * Request a new export token for the given tenant.
   *
   * The caller must be an owner-role member of the tenant.
   * Returns a signed 5-minute download URL.
   */
  request: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      // ── Authz: caller must be owner of the target tenant ──────────────────────
      const [membership] = await controlDb
        .select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, input.tenantId),
            eq(tenantMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      if (membership.role !== "owner" && membership.role !== "superadmin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only organization owners can export data",
        });
      }

      // ── Verify tenant is active ───────────────────────────────────────────────
      const [tenant] = await controlDb
        .select({ slug: tenants.slug, status: tenants.status })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);

      if (!tenant || tenant.status !== "active") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Organization is not active",
        });
      }

      // ── Rate limit check ──────────────────────────────────────────────────────
      checkAndRecordExportRateLimit(input.tenantId);

      // ── Issue token ───────────────────────────────────────────────────────────
      const { token, expiresAt } = signExportToken(input.tenantId, ctx.user.id);

      // Return a relative URL — the client resolves it against the API base
      // (apiUrl helper on the web; cfg.apiUrl on the CLI). Building an
      // absolute URL server-side would require knowing the API host, but
      // APP_URL points to the frontend in split-host deployments.
      const url = `/api/export/${input.tenantId}?token=${encodeURIComponent(token)}`;

      logger.info(
        { tenantId: input.tenantId, userId: ctx.user.id, expiresAt },
        "[selfExport] Export token issued",
      );

      return { token, url, expiresAt: expiresAt.toISOString() };
    }),
});

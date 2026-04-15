/**
 * selfImport.ts — tRPC procedures for the self-import restore feature.
 *
 * Tenant-level feature (not business-level). Uses protectedProcedure with
 * manual owner-role check — same pattern as other tenant-scoped operations.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { controlDb, getTenantDb, businesses, tenantMembers } from "@hisaabo/db";
import { eq, and, count as sqlCount } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { signImportToken } from "../lib/importToken.js";

export const selfImportRouter = router({
  /**
   * Request an import token for the given tenant.
   *
   * Authz: caller must be an `owner` of the target tenant.
   * Pre-check: target tenant must have zero businesses (v1 empty-target policy).
   *
   * Returns a signed one-time upload token (15-min TTL) and the upload URL.
   */
  request: protectedProcedure
    .input(z.object({ tenantId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { tenantId } = input;

      // ── Owner check ────────────────────────────────────────────────────────
      const [membership] = await controlDb
        .select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenantId, tenantId),
            eq(tenantMembers.userId, ctx.user.id),
          ),
        )
        .limit(1);

      if (!membership || membership.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only tenant owners can initiate an import",
        });
      }

      // ── Empty-target pre-check ─────────────────────────────────────────────
      const tenantDb = await getTenantDb(tenantId);
      const [{ businessCount }] = await tenantDb
        .select({ businessCount: sqlCount(businesses.id) })
        .from(businesses);

      if (businessCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "TARGET_NOT_EMPTY: target tenant already has businesses. Import is only allowed to an empty tenant.",
        });
      }

      // ── Sign token ─────────────────────────────────────────────────────────
      const { token, expiresAt } = signImportToken(tenantId, ctx.user.id);

      // Build the upload URL. In multi-tenant cloud mode the API base URL is
      // determined by the CORS_ORIGINS env (first entry). In self-hosted mode
      // the client can resolve this relative to their own base URL.
      // We return a relative path; the client resolves it against its API base.
      const url = `/api/selfImport/${tenantId}?token=${encodeURIComponent(token)}`;

      return {
        token,
        url,
        expiresAt: expiresAt.toISOString(),
      };
    }),
});

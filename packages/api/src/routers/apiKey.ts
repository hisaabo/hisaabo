import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { controlDb, apiKeys } from "@hisaabo/db";
import { createApiKeySchema, revokeApiKeySchema } from "@hisaabo/shared";
import { enforceApiKeyLimit } from "../lib/plan-limits.js";
import { requireTenantRole, ADMIN_ROLES } from "../lib/tenant-access.js";
import { createApiKeyRecord } from "../lib/api-keys.js";
import { cacheBus } from "../lib/cache/bus.js";

// Key generation, hashing and the expiry rule live in lib/api-keys.ts (shared with the
// operator CLI); re-exported here for the callers that always imported them from the router.
export { resolveApiKeyExpiry, API_KEY_DEFAULT_TTL_MS, API_KEY_MAX_TTL_MS } from "../lib/api-keys.js";

function rejectApiKeyAuth(ctx: { viaApiKey?: boolean }) {
  if (ctx.viaApiKey) {
    throw new TRPCError({ code: "FORBIDDEN", message: "API keys cannot manage API keys" });
  }
}

export const apiKeyRouter = router({
  /**
   * List all API keys for the current user + tenant.
   * Never returns the full key or hash — only display-safe fields.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
    }
    await requireTenantRole({ user: ctx.user, tenantId: ctx.tenantId }, ADMIN_ROLES, "Only owners and admins can manage API keys");

    const rows = await controlDb
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, ctx.user.id), eq(apiKeys.tenantId, ctx.tenantId)));

    return rows;
  }),

  /**
   * Create a new API key.
   * Blocked on free plan tenants.
   * Returns the raw key exactly once — it is never stored or returned again.
   */
  create: protectedProcedure.input(createApiKeySchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
    }

    rejectApiKeyAuth(ctx);
    await requireTenantRole({ user: ctx.user, tenantId: ctx.tenantId }, ADMIN_ROLES, "Only owners and admins can manage API keys");

    // Plan check — enforces both plan access and key count limit
    await enforceApiKeyLimit(ctx.tenantId);

    // Key generation, hashing, insert and the "API key created" alert: lib/api-keys.ts
    const created = await createApiKeyRecord({
      userId: ctx.user.id,
      tenantId: ctx.tenantId,
      name: input.name,
      expiresAt: input.expiresAt,
      createdByName: ctx.user.name || ctx.user.email,
      actorUserId: ctx.user.id,
    });

    return {
      id: created.id,
      name: created.name,
      key: created.key,
      keyPrefix: created.keyPrefix,
      expiresAt: created.expiresAt,
    };
  }),

  /**
   * Revoke (delete) an API key by ID.
   * Verifies ownership before deletion.
   */
  revoke: protectedProcedure.input(revokeApiKeySchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
    }
    rejectApiKeyAuth(ctx);
    await requireTenantRole({ user: ctx.user, tenantId: ctx.tenantId }, ADMIN_ROLES, "Only owners and admins can manage API keys");

    // Revocation is immediate: the cached key (if any) is dropped as soon as
    // the DELETE settled, so the key's very next request is unauthenticated.
    const tenantId = ctx.tenantId;
    const deleted = await cacheBus.afterWrite(
      [{ kind: "apiKey", keyId: input.id, userId: ctx.user.id, tenantId }],
      () =>
        controlDb
          .delete(apiKeys)
          .where(
            and(
              eq(apiKeys.id, input.id),
              eq(apiKeys.userId, ctx.user.id),
              eq(apiKeys.tenantId, tenantId),
            ),
          )
          .returning({ id: apiKeys.id }),
    );

    if (deleted.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
    }

    return { success: true };
  }),
});

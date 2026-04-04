import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { controlDb, apiKeys } from "@hisaabo/db";
import { createApiKeySchema, revokeApiKeySchema } from "@hisaabo/shared";
import { enforceApiKeyLimit } from "../lib/plan-limits.js";

export const apiKeyRouter = router({
  /**
   * List all API keys for the current user + tenant.
   * Never returns the full key or hash — only display-safe fields.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
    }

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

    // Plan check — enforces both plan access and key count limit
    await enforceApiKeyLimit(ctx.tenantId);

    // Generate a high-entropy raw key
    const rawKey = `hisaabo_key_${randomBytes(32).toString("base64url")}`;

    // SHA-256 hash — API keys are high-entropy so slow hashing (argon2) is unnecessary
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // First 20 chars for display identification
    const keyPrefix = rawKey.slice(0, 20);

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const [created] = await controlDb
      .insert(apiKeys)
      .values({
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
        keyHash,
        keyPrefix,
        name: input.name,
        expiresAt,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        expiresAt: apiKeys.expiresAt,
      });

    // Return the raw key ONCE — it will never be accessible again
    return {
      id: created.id,
      name: created.name,
      key: rawKey,
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

    const deleted = await controlDb
      .delete(apiKeys)
      .where(
        and(
          eq(apiKeys.id, input.id),
          eq(apiKeys.userId, ctx.user.id),
          eq(apiKeys.tenantId, ctx.tenantId),
        ),
      )
      .returning({ id: apiKeys.id });

    if (deleted.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
    }

    return { success: true };
  }),
});

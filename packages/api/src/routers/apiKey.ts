import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc.js";
import { controlDb, apiKeys } from "@hisaabo/db";
import { createApiKeySchema, revokeApiKeySchema } from "@hisaabo/shared";
import { enforceApiKeyLimit } from "../lib/plan-limits.js";
import { requireTenantRole, ADMIN_ROLES } from "../lib/tenant-access.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const API_KEY_DEFAULT_TTL_MS = 90 * DAY_MS;
export const API_KEY_MAX_TTL_MS = 365 * DAY_MS;

/** Resolves the key expiry: 90 days when omitted, never more than 365 days out. */
export function resolveApiKeyExpiry(requested: string | Date | null | undefined, now = Date.now()): Date {
  if (!requested) return new Date(now + API_KEY_DEFAULT_TTL_MS);
  const at = new Date(requested).getTime();
  if (Number.isNaN(at) || at <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Expiry must be in the future" });
  }
  if (at > now + API_KEY_MAX_TTL_MS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "API keys can be valid for at most 365 days" });
  }
  return new Date(at);
}

// A key (or any non-interactive credential) must never be able to mint or
// revoke keys: only an interactive session can manage them.
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

    // Generate a high-entropy raw key
    const rawKey = `hisaabo_key_${randomBytes(32).toString("base64url")}`;

    // SHA-256 hash — API keys are high-entropy so slow hashing (argon2) is unnecessary
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // First 20 chars for display identification
    const keyPrefix = rawKey.slice(0, 20);

    const expiresAt = resolveApiKeyExpiry(input.expiresAt);

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
    rejectApiKeyAuth(ctx);
    await requireTenantRole({ user: ctx.user, tenantId: ctx.tenantId }, ADMIN_ROLES, "Only owners and admins can manage API keys");

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

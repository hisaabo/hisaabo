/**
 * notification.* — inbox, preferences, push devices and user settings.
 * See docs/architecture/notifications.md §13.
 *
 * Tenant isolation: inbox rows carry tenant_id and are always filtered by
 * ctx.tenantId + the caller's user id (+ the active business where relevant),
 * which is what keeps tenants apart in self-hosted mode where they share one
 * database. Preferences are stored per (user, tenant, business?) in the
 * control DB. Devices and settings belong to the user.
 */

import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, lt, or, sql, count } from "drizzle-orm";
import {
  controlDb,
  accessTokens,
  pushDevices,
  userNotificationSettings,
  notificationPreferences,
  notificationInbox,
  encryptField,
} from "@hisaabo/db";
import {
  CHANNELS,
  CHANNEL_IDS,
  DELIVERIES,
  SCOPES,
  SUPPORTED_LOCALES,
  DEFAULT_QUIET_START,
  DEFAULT_QUIET_END,
  isChannelAvailableFor,
  isChannelLockedFor,
  isLocale,
  parseClock,
  resolvePreference,
  type ChannelId,
  type Delivery,
  type PreferenceOverride,
  type Scope,
} from "@hisaabo/shared";
import { router, protectedProcedure, tenantProcedure, viewerProcedure } from "../trpc.js";
import { getSessionIdFromRequest } from "../context.js";
import { getTenantRole } from "../lib/tenant-access.js";
import { assertBusinessInTenant } from "../lib/tenant-businesses.js";
import { isValidDeviceKeys } from "../lib/notifications/push-crypto.js";
import { getPushProvider } from "../lib/notifications/push-provider.js";
import { getTenantPushUsage } from "../lib/notifications/quota.js";
import { getLimits, getTenantPlan } from "../lib/plan-limits.js";

const channelSchema = z.enum(CHANNEL_IDS as unknown as [ChannelId, ...ChannelId[]]);
const idsSchema = z.array(z.string().uuid()).min(1).max(200);
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Use HH:MM (24-hour)");

// ── Helpers ─────────────────────────────────────────────────────────────────

// tenantId is guaranteed by hasTenantAccess; businessProcedure's context type
// just doesn't carry the narrowing through.
function inboxScope(ctx: { tenantId: string | null; user: { id: string } | null }, businessId: string | null) {
  if (!ctx.tenantId || !ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return and(
    eq(notificationInbox.tenantId, ctx.tenantId),
    eq(notificationInbox.recipientUserId, ctx.user.id),
    businessId
      ? or(eq(notificationInbox.businessId, businessId), isNull(notificationInbox.businessId))
      : undefined,
  );
}

async function requireRole(ctx: { tenantId: string; user: { id: string } }): Promise<string> {
  const role = await getTenantRole(ctx.tenantId, ctx.user.id);
  if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this organization" });
  return role;
}

/** The session behind this request; push registrations are bound to it. */
async function callerSessionId(req: Request): Promise<string | null> {
  const fromCookieOrBearer = getSessionIdFromRequest(req);
  if (fromCookieOrBearer) return fromCookieOrBearer;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer at_")) {
    const [row] = await controlDb
      .select({ sessionId: accessTokens.sessionId })
      .from(accessTokens)
      .where(eq(accessTokens.id, auth.slice(7)))
      .limit(1);
    return row?.sessionId ?? null;
  }
  return null;
}

function tokenHash(platform: string, token: string): string {
  return createHash("sha256").update(`${platform}:${token}`).digest("hex");
}

type PrefRow = typeof notificationPreferences.$inferSelect;

function overrideOf(row: PrefRow | undefined): PreferenceOverride | null {
  if (!row) return null;
  return {
    delivery: row.delivery as Delivery | null,
    scope: row.scope as Scope | null,
    thresholdPaise: row.thresholdPaise,
    email: row.email,
  };
}

// ── Router ──────────────────────────────────────────────────────────────────

export const notificationRouter = router({
  /** Inbox for the active business (plus tenant-level entries such as team changes). */
  list: viewerProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(30),
      // Keyset pagination: pass the previous page's nextCursor
      cursor: z.string().datetime().optional(),
      unreadOnly: z.boolean().default(false),
      channel: channelSchema.optional(),
    }).default({}))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: notificationInbox.id,
          businessId: notificationInbox.businessId,
          channel: notificationInbox.channel,
          eventType: notificationInbox.eventType,
          title: notificationInbox.title,
          body: notificationInbox.body,
          target: notificationInbox.target,
          locked: notificationInbox.locked,
          readAt: notificationInbox.readAt,
          createdAt: notificationInbox.createdAt,
        })
        .from(notificationInbox)
        .where(and(
          inboxScope(ctx, ctx.businessId),
          isNull(notificationInbox.archivedAt),
          input.unreadOnly ? isNull(notificationInbox.readAt) : undefined,
          input.channel ? eq(notificationInbox.channel, input.channel) : undefined,
          input.cursor ? lt(notificationInbox.createdAt, new Date(input.cursor)) : undefined,
        ))
        .orderBy(desc(notificationInbox.createdAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      };
    }),

  /** Unread counts for every business in the tenant, for badges and the business switcher. */
  unreadCounts: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ businessId: notificationInbox.businessId, count: count() })
      .from(notificationInbox)
      .where(and(
        inboxScope(ctx, null),
        isNull(notificationInbox.readAt),
        isNull(notificationInbox.archivedAt),
      ))
      .groupBy(notificationInbox.businessId);
    const tenantLevel = rows.find((r) => r.businessId === null)?.count ?? 0;
    return {
      total: rows.reduce((sum, r) => sum + r.count, 0),
      tenantLevel,
      byBusiness: rows
        .filter((r): r is { businessId: string; count: number } => r.businessId !== null)
        .map((r) => ({ businessId: r.businessId, count: r.count })),
    };
  }),

  markRead: tenantProcedure
    .input(z.object({ ids: idsSchema }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notificationInbox)
        .set({ readAt: new Date() })
        .where(and(inboxScope(ctx, null), inArray(notificationInbox.id, input.ids), isNull(notificationInbox.readAt)))
        .returning({ id: notificationInbox.id });
      return { updated: updated.length };
    }),

  /** Mark everything read in the active business (and tenant-level entries). */
  markAllRead: viewerProcedure.mutation(async ({ ctx }) => {
    const updated = await ctx.db
      .update(notificationInbox)
      .set({ readAt: new Date() })
      .where(and(inboxScope(ctx, ctx.businessId), isNull(notificationInbox.readAt)))
      .returning({ id: notificationInbox.id });
    return { updated: updated.length };
  }),

  archive: tenantProcedure
    .input(z.object({ ids: idsSchema }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(notificationInbox)
        .set({ archivedAt: new Date(), readAt: sql`COALESCE(${notificationInbox.readAt}, now())` })
        .where(and(inboxScope(ctx, null), inArray(notificationInbox.id, input.ids)))
        .returning({ id: notificationInbox.id });
      return { updated: updated.length };
    }),

  /**
   * Effective preferences for every channel, for the tenant default
   * (businessId omitted) or one business. Includes where each value came from
   * and whether the channel is locked or unavailable for the caller's role.
   */
  getPreferences: tenantProcedure
    .input(z.object({ businessId: z.string().uuid().nullish() }).default({}))
    .query(async ({ ctx, input }) => {
      const businessId = input.businessId ?? null;
      if (businessId) await assertBusinessInTenant(ctx.db, ctx.tenantId, businessId);
      const role = await requireRole(ctx);

      const rows = await controlDb
        .select()
        .from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.tenantId, ctx.tenantId),
          eq(notificationPreferences.userId, ctx.user.id),
          businessId
            ? or(isNull(notificationPreferences.businessId), eq(notificationPreferences.businessId, businessId))
            : isNull(notificationPreferences.businessId),
        ));

      const [settings] = await controlDb
        .select({ locale: userNotificationSettings.locale })
        .from(userNotificationSettings)
        .where(eq(userNotificationSettings.userId, ctx.user.id));
      const locale = isLocale(settings?.locale) ? settings.locale : "en";

      return {
        role,
        businessId,
        channels: CHANNEL_IDS.map((channel) => {
          const tenantRow = rows.find((r) => r.channel === channel && r.businessId === null);
          const businessRow = rows.find((r) => r.channel === channel && r.businessId === businessId && businessId !== null);
          const { preference, source } = resolvePreference(role, channel, overrideOf(tenantRow), overrideOf(businessRow));
          const def = CHANNELS[channel];
          return {
            channel,
            name: def.name[locale],
            description: def.description[locale],
            available: isChannelAvailableFor(channel, role),
            locked: isChannelLockedFor(channel, role),
            scopeable: def.scopeable,
            thresholdable: def.thresholdable,
            preference,
            source,
            tenantOverride: overrideOf(tenantRow),
            businessOverride: overrideOf(businessRow),
          };
        }),
      };
    }),

  /**
   * Set (or with reset: true, clear) the caller's override for one channel,
   * for the whole tenant (businessId null) or one business.
   */
  updatePreference: tenantProcedure
    .input(z.object({
      businessId: z.string().uuid().nullable(),
      channel: channelSchema,
      delivery: z.enum(DELIVERIES as unknown as [Delivery, ...Delivery[]]).nullish(),
      scope: z.enum(SCOPES as unknown as [Scope, ...Scope[]]).nullish(),
      thresholdPaise: z.number().int().min(0).max(1_000_000_000_00).nullish(),
      email: z.boolean().nullish(),
      reset: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.businessId) await assertBusinessInTenant(ctx.db, ctx.tenantId, input.businessId);
      const role = await requireRole(ctx);
      if (!isChannelAvailableFor(input.channel, role)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This channel is not available for your role" });
      }
      if (isChannelLockedFor(input.channel, role) && input.delivery && input.delivery !== "push") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "These alerts are required for your role and cannot be turned off",
        });
      }

      const where = and(
        eq(notificationPreferences.userId, ctx.user.id),
        eq(notificationPreferences.tenantId, ctx.tenantId),
        eq(notificationPreferences.channel, input.channel),
        input.businessId ? eq(notificationPreferences.businessId, input.businessId) : isNull(notificationPreferences.businessId),
      );

      if (input.reset) {
        await controlDb.delete(notificationPreferences).where(where);
        return { ok: true };
      }

      const patch: Partial<typeof notificationPreferences.$inferInsert> = { updatedAt: new Date() };
      if (input.delivery !== undefined) patch.delivery = input.delivery;
      if (input.scope !== undefined) patch.scope = input.scope;
      if (input.thresholdPaise !== undefined) patch.thresholdPaise = input.thresholdPaise;
      if (input.email !== undefined) patch.email = input.email;

      await controlDb.transaction(async (tx) => {
        const [existing] = await tx.select({ id: notificationPreferences.id }).from(notificationPreferences).where(where).for("update");
        if (existing) {
          await tx.update(notificationPreferences).set(patch).where(eq(notificationPreferences.id, existing.id));
        } else {
          await tx.insert(notificationPreferences).values({
            userId: ctx.user.id,
            tenantId: ctx.tenantId,
            businessId: input.businessId,
            channel: input.channel,
            ...patch,
          });
        }
      });
      return { ok: true };
    }),

  /** Register (or refresh) this device for push. Call on every app launch. */
  registerDevice: protectedProcedure
    .input(z.object({
      platform: z.enum(["ios", "android", "web", "unifiedpush"]),
      appFlavor: z.enum(["play", "appstore", "fdroid", "web", "desktop"]),
      token: z.string().min(8).max(4096),
      publicKey: z.string().max(200).optional(),
      authSecret: z.string().max(100).optional(),
      locale: z.enum(SUPPORTED_LOCALES as unknown as ["en", "hi"]).default("en"),
      appVersion: z.string().max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.viaApiKey) {
        throw new TRPCError({ code: "FORBIDDEN", message: "API keys cannot register push devices" });
      }
      const sessionId = await callerSessionId(ctx.req);
      if (!sessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Push registration requires a signed-in session" });
      }
      if ((input.publicKey || input.authSecret) && !(input.publicKey && input.authSecret && isValidDeviceKeys(input.publicKey, input.authSecret))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid device encryption keys" });
      }

      const hash = tokenHash(input.platform, input.token);
      const values = {
        userId: ctx.user.id,
        sessionId,
        platform: input.platform,
        appFlavor: input.appFlavor,
        tokenHash: hash,
        token: encryptField(input.token),
        publicKey: input.publicKey ?? null,
        authSecret: input.authSecret ? encryptField(input.authSecret) : null,
        locale: input.locale,
        appVersion: input.appVersion ?? null,
        lastSeenAt: new Date(),
      };
      // A token is unique to a device; if another account registered it last
      // (shared phone, re-login), this registration replaces it.
      const [row] = await controlDb
        .insert(pushDevices)
        .values(values)
        .onConflictDoUpdate({ target: pushDevices.tokenHash, set: values })
        .returning({ id: pushDevices.id });
      return { id: row.id, pushEnabled: getPushProvider().supports(input.platform) };
    }),

  unregisterDevice: protectedProcedure
    .input(z.object({
      platform: z.enum(["ios", "android", "web", "unifiedpush"]),
      token: z.string().min(8).max(4096),
    }))
    .mutation(async ({ ctx, input }) => {
      const removed = await controlDb
        .delete(pushDevices)
        .where(and(eq(pushDevices.userId, ctx.user.id), eq(pushDevices.tokenHash, tokenHash(input.platform, input.token))))
        .returning({ id: pushDevices.id });
      return { removed: removed.length };
    }),

  listDevices: protectedProcedure.query(async ({ ctx }) => {
    const sessionId = await callerSessionId(ctx.req);
    const rows = await controlDb
      .select({
        id: pushDevices.id,
        platform: pushDevices.platform,
        appFlavor: pushDevices.appFlavor,
        appVersion: pushDevices.appVersion,
        sessionId: pushDevices.sessionId,
        lastSeenAt: pushDevices.lastSeenAt,
        createdAt: pushDevices.createdAt,
      })
      .from(pushDevices)
      .where(eq(pushDevices.userId, ctx.user.id))
      .orderBy(desc(pushDevices.lastSeenAt));
    return rows.map(({ sessionId: s, ...rest }) => ({ ...rest, currentSession: !!sessionId && s === sessionId }));
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await controlDb
      .select()
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, ctx.user.id));
    return {
      locale: isLocale(row?.locale) ? row.locale : "en",
      quietHours: row
        ? (row.quietStart && row.quietEnd ? { start: row.quietStart, end: row.quietEnd } : null)
        : { start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END },
      pausedUntil: row?.pausedUntil ?? null,
      lockScreenPrivacy: row?.lockScreenPrivacy ?? false,
      promotionsOptIn: !!row?.promotionsOptInAt,
      promotionsOptInAt: row?.promotionsOptInAt ?? null,
    };
  }),

  updateSettings: protectedProcedure
    .input(z.object({
      locale: z.enum(SUPPORTED_LOCALES as unknown as ["en", "hi"]).optional(),
      // null turns quiet hours off
      quietHours: z.object({ start: clockSchema, end: clockSchema }).nullable().optional(),
      pausedUntil: z.string().datetime().nullable().optional(),
      lockScreenPrivacy: z.boolean().optional(),
      promotionsOptIn: z.boolean().optional(),
      // Where consent was given (screen name), recorded with the opt-in
      promotionsOptInSource: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.promotionsOptIn !== undefined && ctx.viaApiKey) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Marketing consent must be given by the user, not an API key" });
      }
      if (input.quietHours && parseClock(input.quietHours.start) === parseClock(input.quietHours.end)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Quiet hours must start and end at different times" });
      }
      const patch: Partial<typeof userNotificationSettings.$inferInsert> = { updatedAt: new Date() };
      if (input.locale) patch.locale = input.locale;
      if (input.quietHours !== undefined) {
        patch.quietStart = input.quietHours?.start ?? null;
        patch.quietEnd = input.quietHours?.end ?? null;
      }
      if (input.pausedUntil !== undefined) patch.pausedUntil = input.pausedUntil ? new Date(input.pausedUntil) : null;
      if (input.lockScreenPrivacy !== undefined) patch.lockScreenPrivacy = input.lockScreenPrivacy;
      if (input.promotionsOptIn !== undefined) {
        patch.promotionsOptInAt = input.promotionsOptIn ? new Date() : null;
        patch.promotionsOptInSource = input.promotionsOptIn ? (input.promotionsOptInSource ?? "settings") : null;
      }
      await controlDb
        .insert(userNotificationSettings)
        .values({ userId: ctx.user.id, ...patch })
        .onConflictDoUpdate({ target: userNotificationSettings.userId, set: patch });
      return { ok: true };
    }),

  /**
   * What this server can deliver, so clients never promise push that will not
   * arrive (self-hosted servers usually have no mobile push), plus today's push
   * usage against the tenant's plan limit.
   */
  transports: tenantProcedure.query(async ({ ctx }) => {
    const provider = getPushProvider();
    const plan = await getTenantPlan(ctx.tenantId);
    const cloud = process.env.MULTI_TENANT === "true";
    const limit = getLimits(plan).pushPerDay;
    return {
      inbox: true,
      email: !!process.env.RESEND_API_KEY || process.env.NODE_ENV !== "production",
      mobilePush: provider.supports("ios") || provider.supports("android"),
      pushProvider: provider.name,
      webPush: false,
      unifiedPush: false,
      pushUsageToday: cloud ? await getTenantPushUsage(ctx.tenantId) : null,
      pushLimitPerDay: cloud && Number.isFinite(limit) ? limit : null,
    };
  }),
});

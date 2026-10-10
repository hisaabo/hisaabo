/**
 * Push quotas (docs/architecture/notifications.md §9).
 *
 * Three layers, checked before every push, counted in fixed windows in the
 * control DB (push_quota_usage) so all API replicas share them:
 *   - instance: hard ceiling for this deployment's push credentials (protects
 *               sender reputation with Apple/Google from a runaway loop)
 *   - tenant:   per plan (plan-limits.ts pushPerDay); cloud only
 *   - user:     per recipient per hour/day; overflow stays inbox-only
 *
 * Urgent events (security, locked compliance) are exempt from the tenant and
 * user layers but never from the instance ceiling.
 *
 * Self-hosted defaults: instance and tenant layers are unlimited unless the
 * PUSH_QUOTA_* variables are set; per-user caps always apply.
 */

import { controlDb, pushQuotaUsage } from "@hisaabo/db";
import { sql, lt, and, eq } from "drizzle-orm";
import { getLimits } from "../plan-limits.js";

export type QuotaScope = "instance_day" | "instance_minute" | "tenant_day" | "user_hour" | "user_day";

function envLimit(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface QuotaConfig {
  instanceId: string;
  instancePerDay: number;
  instancePerMinute: number;
  userPerHour: number;
  userPerDay: number;
  /** Tenant limits apply only in multi-tenant (cloud) mode. */
  tenantLimitsEnabled: boolean;
}

export function quotaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QuotaConfig {
  const cloud = env.MULTI_TENANT === "true";
  return {
    instanceId: env.PUSH_INSTANCE_ID || "default",
    instancePerDay: envLimit("PUSH_QUOTA_INSTANCE_DAY", cloud ? 2_000_000 : Infinity, env),
    instancePerMinute: envLimit("PUSH_QUOTA_INSTANCE_MINUTE", cloud ? 2_000 : Infinity, env),
    userPerHour: envLimit("PUSH_QUOTA_USER_HOUR", 60, env),
    userPerDay: envLimit("PUSH_QUOTA_USER_DAY", 200, env),
    tenantLimitsEnabled: cloud,
  };
}

function windowStart(now: Date, unit: "minute" | "hour" | "day"): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  if (unit === "hour" || unit === "day") d.setUTCMinutes(0);
  if (unit === "day") d.setUTCHours(0);
  return d;
}

/** Atomically add one to a window counter and return the new value. */
async function bump(scope: QuotaScope, scopeId: string, start: Date): Promise<number> {
  const [row] = await controlDb
    .insert(pushQuotaUsage)
    .values({ scope, scopeId, windowStart: start, count: 1 })
    .onConflictDoUpdate({
      target: [pushQuotaUsage.scope, pushQuotaUsage.scopeId, pushQuotaUsage.windowStart],
      set: { count: sql`${pushQuotaUsage.count} + 1` },
    })
    .returning({ count: pushQuotaUsage.count });
  return row.count;
}

export interface QuotaRequest {
  tenantId: string;
  tenantPlan: string;
  userId: string;
  urgent: boolean;
  now?: Date;
}

/**
 * Consume one push from every applicable quota. Returns null when the push may
 * go out, or the first layer that refused it. A refused push stays in the
 * inbox (and the digest, once it exists).
 */
export async function consumePushQuota(
  req: QuotaRequest,
  config: QuotaConfig = quotaConfigFromEnv(),
): Promise<QuotaScope | null> {
  const now = req.now ?? new Date();
  const checks: Array<[QuotaScope, string, Date, number]> = [];

  if (Number.isFinite(config.instancePerMinute)) {
    checks.push(["instance_minute", config.instanceId, windowStart(now, "minute"), config.instancePerMinute]);
  }
  if (Number.isFinite(config.instancePerDay)) {
    checks.push(["instance_day", config.instanceId, windowStart(now, "day"), config.instancePerDay]);
  }
  if (!req.urgent) {
    const tenantLimit = getLimits(req.tenantPlan).pushPerDay;
    if (config.tenantLimitsEnabled && Number.isFinite(tenantLimit)) {
      checks.push(["tenant_day", req.tenantId, windowStart(now, "day"), tenantLimit]);
    }
    if (Number.isFinite(config.userPerHour)) {
      checks.push(["user_hour", req.userId, windowStart(now, "hour"), config.userPerHour]);
    }
    if (Number.isFinite(config.userPerDay)) {
      checks.push(["user_day", req.userId, windowStart(now, "day"), config.userPerDay]);
    }
  }

  for (const [scope, scopeId, start, limit] of checks) {
    const count = await bump(scope, scopeId, start);
    if (count > limit) return scope;
  }
  return null;
}

/** Current usage for a tenant today (for the settings screen). */
export async function getTenantPushUsage(tenantId: string, now: Date = new Date()): Promise<number> {
  const [row] = await controlDb
    .select({ count: pushQuotaUsage.count })
    .from(pushQuotaUsage)
    .where(and(
      eq(pushQuotaUsage.scope, "tenant_day"),
      eq(pushQuotaUsage.scopeId, tenantId),
      eq(pushQuotaUsage.windowStart, windowStart(now, "day")),
    ));
  return row?.count ?? 0;
}

/** Drop counters older than two days. */
export async function pruneQuotaWindows(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  await controlDb.delete(pushQuotaUsage).where(lt(pushQuotaUsage.windowStart, cutoff));
}

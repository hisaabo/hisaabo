/**
 * emitNotificationEvent — the single way domain code raises a notification.
 *
 * Call it with the SAME transaction as the domain write: if the write rolls
 * back, the notification never existed. The dispatcher picks the outbox row up
 * within a few seconds (docs/architecture/notifications.md §6).
 *
 * Inside a hot path (payment, store order) use emitNotificationEventSafe or
 * withNotificationSavepoint instead: they run the emit in a SAVEPOINT, so an
 * outbox failure (bad payload, constraint, table missing on a half-migrated
 * database) is logged and rolled back to the savepoint while the business
 * write still commits. A rollback of the OUTER transaction still drops the
 * event, so the transactional-outbox guarantee is unchanged.
 *
 *   await emitNotificationEventSafe(tx, {
 *     tenantId: ctx.tenantId,
 *     businessId: ctx.businessId,
 *     type: "payment.received",
 *     payload: { ... },
 *     actorUserId: ctx.user.id,
 *     ownerUserId: invoice.createdByUserId,
 *     dedupeKey: `payment.received:${payment.id}`,
 *   });
 */

import {
  controlDb,
  getTenantDb,
  tenantMembers,
  users,
  businesses,
  notificationOutbox,
  type TenantDatabase,
} from "@hisaabo/db";
import { asc, eq } from "drizzle-orm";
import type { EventPayloads, EventType } from "@hisaabo/shared";
import { OWNER_ROLES } from "../tenant-access.js";
import { logger } from "../logger.js";
import { kickDispatcher } from "./kick.js";

type Tx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];
export type TenantDbOrTx = TenantDatabase | Tx;

export type ActorKind = "user" | "api_key" | "agent" | "system";

export interface EmitInput<T extends EventType> {
  /**
   * The tenant the event belongs to. Pass null (or the self-hosted placeholder
   * "single") when only the business is known — e.g. public store endpoints —
   * and it is resolved from the business owner's membership.
   */
  tenantId: string | null;
  /** Null for tenant-level events (team changes, API keys). */
  businessId: string | null;
  type: T;
  payload: EventPayloads[T];
  actorUserId?: string | null;
  actorKind?: ActorKind;
  /** Who "Only mine" refers to — usually the record's creator. */
  ownerUserId?: string | null;
  /** Who an own-account or team event is about. */
  subjectUserId?: string | null;
  /** Unique per tenant. Retried webhooks or sweeps never notify twice. */
  dedupeKey: string;
}

/**
 * Resolve the tenant that owns a business. A business belongs to the tenant
 * its creator is a member of (same rule as trpc.ts hasBusinessAccess). If the
 * creator belongs to several tenants, prefer one they own, then the oldest.
 */
export async function resolveBusinessTenantId(db: TenantDbOrTx, businessId: string): Promise<string | null> {
  const [biz] = await db
    .select({ createdByUserId: businesses.createdByUserId })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!biz) return null;
  const memberships = await controlDb
    .select({ tenantId: tenantMembers.tenantId, role: tenantMembers.role })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, biz.createdByUserId))
    .orderBy(asc(tenantMembers.createdAt));
  if (memberships.length === 0) return null;
  const owned = memberships.find((m) => (OWNER_ROLES as readonly string[]).includes(m.role));
  return (owned ?? memberships[0]).tenantId;
}

/** Returns the outbox row id, or null if an identical event (same dedupe key) already exists. */
export async function emitNotificationEvent<T extends EventType>(
  db: TenantDbOrTx,
  input: EmitInput<T>,
): Promise<string | null> {
  let tenantId = input.tenantId && input.tenantId !== "single" ? input.tenantId : null;
  if (!tenantId) {
    if (!input.businessId) throw new Error("emitNotificationEvent: tenantId or businessId is required");
    tenantId = await resolveBusinessTenantId(db, input.businessId);
    if (!tenantId) return null;
  }

  const [row] = await db
    .insert(notificationOutbox)
    .values({
      tenantId,
      businessId: input.businessId,
      eventType: input.type,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind ?? (input.actorUserId ? "user" : "system"),
      ownerUserId: input.ownerUserId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      payload: input.payload as unknown as Record<string, unknown>,
      dedupeKey: input.dedupeKey.slice(0, 200),
    })
    .onConflictDoNothing({ target: [notificationOutbox.tenantId, notificationOutbox.dedupeKey] })
    .returning({ id: notificationOutbox.id });

  if (row) kickDispatcher(tenantId);
  return row?.id ?? null;
}

/**
 * Run `fn` inside a SAVEPOINT of `db` (a real transaction when `db` is a plain
 * connection). If `fn` throws, only the savepoint is rolled back and the error
 * is logged at warn level, so the caller's transaction stays usable and keeps
 * its writes. Returns whether `fn` completed.
 *
 * Without the savepoint a failed statement would abort the whole Postgres
 * transaction ("current transaction is aborted, commands ignored until end of
 * transaction block"), taking the payment or store order down with it.
 */
export async function withNotificationSavepoint(
  db: TenantDbOrTx,
  label: string,
  fn: (sp: Tx) => Promise<void>,
): Promise<boolean> {
  try {
    await db.transaction(async (sp) => {
      await fn(sp);
    });
    return true;
  } catch (err) {
    logger.warn({ err, type: label }, "[notifications] failed to emit event — continuing without it");
    return false;
  }
}

/**
 * Emit without letting a notification problem break the caller. Safe to call
 * with the business transaction (the emit runs in a savepoint) or with a plain
 * connection: losing a notification is preferable to failing the request.
 */
export async function emitNotificationEventSafe<T extends EventType>(
  db: TenantDbOrTx,
  input: EmitInput<T>,
): Promise<void> {
  await withNotificationSavepoint(db, input.type, async (sp) => {
    await emitNotificationEvent(sp, input);
  });
}

/**
 * Tenant-level events (team changes, API keys) happen in the control DB, with
 * no business and no tenant transaction to join. Best-effort: a failure here is
 * logged and never fails the team operation.
 */
export async function emitTenantEvent<T extends EventType>(
  tenantId: string,
  input: Omit<EmitInput<T>, "tenantId" | "businessId">,
): Promise<void> {
  try {
    const db = await getTenantDb(tenantId);
    await emitNotificationEvent(db, { ...input, tenantId, businessId: null } as EmitInput<T>);
  } catch (err) {
    logger.warn({ err, type: input.type }, "[notifications] failed to emit tenant event");
  }
}

/**
 * Display name for a user in notification copy. Never throws: call sites build
 * event payloads with it, outside the emit helpers' error handling.
 */
export async function userDisplayName(userId: string): Promise<string> {
  try {
    const [u] = await controlDb.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name || u?.email || "A team member";
  } catch (err) {
    logger.warn({ err, userId }, "[notifications] could not look up a user name");
    return "A team member";
  }
}

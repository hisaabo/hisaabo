/**
 * Collections sweep: emits `invoice.due_today` and `invoice.overdue` events for
 * sale invoices (docs/architecture/notifications.md §2, channel "collections").
 *
 * Runs hourly but only emits during business hours (09:00–20:00 IST) so the
 * resulting pushes are not swallowed by quiet hours. Dedupe keys make every
 * reminder fire once:
 *   - due today:  once per invoice per due date
 *   - overdue:    once per invoice per bucket (7, 30, 60 days)
 * A bucket only fires within 3 days of being crossed, so turning the feature on
 * does not flood owners with reminders for invoices that are years old.
 *
 * Even so, the first run on an upgraded install finds every open invoice that
 * sits inside one of those windows at once. Each run therefore emits at most
 * MAX_EVENTS_PER_BUSINESS_PER_SWEEP new events per business; the rest are left
 * for the next hourly run, which is safe because the windows are 3 days wide
 * and the dedupe keys stop anything from firing twice.
 */

import { eq, sql } from "drizzle-orm";
import { controlDb, getTenantDb, tenants, type TenantDatabase } from "@hisaabo/db";
import { DEFAULT_TIME_ZONE, minutesInTimeZone } from "@hisaabo/shared";
import { logger } from "../logger.js";
import { emitNotificationEvent } from "./emit.js";

export const OVERDUE_BUCKETS = [60, 30, 7] as const;
const BUCKET_WINDOW_DAYS = 3;
/**
 * New due-today / overdue events one sweep may emit per business. Hourly runs
 * (09:00-20:00 IST) give a backlog of N invoices roughly N / 50 hours to drain,
 * well inside the 3-day bucket window for any realistic business.
 */
export const MAX_EVENTS_PER_BUSINESS_PER_SWEEP = 50;
const SWEEP_START_MINUTE = 9 * 60;
const SWEEP_END_MINUTE = 20 * 60;

interface DueRow {
  id: string;
  business_id: string;
  invoice_number: string;
  party_name: string;
  amount_due: string;
  days: number;
  due_date: string;
  created_by_user_id: string | null;
}

/** Which overdue bucket (if any) fires for an invoice `days` past due. */
export function overdueBucket(days: number): number | null {
  for (const b of OVERDUE_BUCKETS) {
    if (days >= b && days < b + BUCKET_WINDOW_DAYS) return b;
  }
  return null;
}

/**
 * Emit collection events for one tenant database. `tenantId` is null in
 * self-hosted mode, where each business's tenant is resolved on emit.
 */
export async function sweepCollections(
  db: TenantDatabase,
  tenantId: string | null,
  maxPerBusiness: number = MAX_EVENTS_PER_BUSINESS_PER_SWEEP,
): Promise<number> {
  const tz = DEFAULT_TIME_ZONE;
  const result = await db.execute(sql`
    SELECT i.id, i.business_id, i.invoice_number, p.name AS party_name,
           (i.total_amount::numeric - i.amount_paid::numeric)::text AS amount_due,
           ((now() AT TIME ZONE ${tz})::date - (i.due_date AT TIME ZONE ${tz})::date) AS days,
           to_char(i.due_date AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS due_date,
           i.created_by_user_id
    FROM invoices i
    JOIN parties p ON p.id = i.party_id
    WHERE i.type = 'sale'
      AND i.document_type = 'invoice'
      AND i.deleted_at IS NULL
      AND i.due_date IS NOT NULL
      AND i.status IN ('unfulfilled', 'sent', 'partial', 'overdue')
      AND i.total_amount::numeric > i.amount_paid::numeric
      AND ((now() AT TIME ZONE ${tz})::date - (i.due_date AT TIME ZONE ${tz})::date) IN (
        0, 7, 8, 9, 30, 31, 32, 60, 61, 62
      )
    ORDER BY i.due_date DESC, i.id
  `);
  const rows = result as unknown as DueRow[];

  let emitted = 0;
  const emittedByBusiness = new Map<string, number>();
  const notExaminedByBusiness = new Map<string, number>();
  for (const r of rows) {
    // Cap NEW events per business. Rows already emitted by an earlier run dedupe
    // to null below and do not count, so each run makes progress through the backlog.
    if ((emittedByBusiness.get(r.business_id) ?? 0) >= maxPerBusiness) {
      notExaminedByBusiness.set(r.business_id, (notExaminedByBusiness.get(r.business_id) ?? 0) + 1);
      continue;
    }
    const days = Number(r.days);
    const common = {
      tenantId,
      businessId: r.business_id,
      ownerUserId: r.created_by_user_id,
      actorKind: "system" as const,
    };
    let id: string | null = null;
    if (days === 0) {
      id = await emitNotificationEvent(db, {
        ...common,
        type: "invoice.due_today",
        payload: { invoiceId: r.id, invoiceNumber: r.invoice_number, partyName: r.party_name, amountDue: r.amount_due },
        dedupeKey: `invoice.due_today:${r.id}:${r.due_date}`,
      });
    } else {
      const bucket = overdueBucket(days);
      if (bucket === null) continue;
      id = await emitNotificationEvent(db, {
        ...common,
        type: "invoice.overdue",
        payload: {
          invoiceId: r.id,
          invoiceNumber: r.invoice_number,
          partyName: r.party_name,
          amountDue: r.amount_due,
          daysOverdue: days,
        },
        dedupeKey: `invoice.overdue:${r.id}:${bucket}`,
      });
    }
    if (id) {
      emitted++;
      emittedByBusiness.set(r.business_id, (emittedByBusiness.get(r.business_id) ?? 0) + 1);
    }
  }
  for (const [businessId, notExamined] of notExaminedByBusiness) {
    logger.info(
      { businessId, notExamined, cap: maxPerBusiness },
      "[notifications] collections sweep hit its per-business cap; the remaining invoices are examined by the next run",
    );
  }
  return emitted;
}

const SWEEP_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const minute = minutesInTimeZone(new Date(), DEFAULT_TIME_ZONE);
  if (minute < SWEEP_START_MINUTE || minute >= SWEEP_END_MINUTE) return;
  try {
    if (process.env.MULTI_TENANT !== "true") {
      await sweepCollections(await getTenantDb("single"), null);
      return;
    }
    const active = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, "active"));
    for (const t of active) {
      try {
        await sweepCollections(await getTenantDb(t.id), t.id);
      } catch (err) {
        logger.error({ err, tenantId: t.id }, "[notifications] collections sweep failed for tenant");
      }
    }
  } catch (err) {
    logger.error({ err }, "[notifications] collections sweep failed");
  }
}

export function startCollectionsSweep(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, SWEEP_MS);
  timer.unref();
  // First run shortly after boot rather than an hour later.
  setTimeout(() => { void tick(); }, 30_000).unref();
}

export function stopCollectionsSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

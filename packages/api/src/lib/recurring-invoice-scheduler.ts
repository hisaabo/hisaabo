/**
 * In-process scheduler for recurring invoices.
 * Ticks every 60 seconds, finds due templates, and generates invoices.
 *
 * Concurrency: each occurrence is claimed and generated inside ONE transaction
 * that holds the template's row lock (`SELECT ... FOR UPDATE SKIP LOCKED`), so
 * a second runner (another replica, or an overlapping tick) skips the template
 * instead of generating the same invoice. `recurring_run_occurrence_uniq` is
 * the database-level backstop.
 *
 * Multi-tenant: every tenant is visited with its own short-lived, single
 * connection client (`withDedicatedTenantDb`), not through the shared pool
 * cache, so a sweep over hundreds of tenants cannot evict the pools that live
 * requests are using.
 */

import { eq, and, sql, gte, lte, asc, desc } from "drizzle-orm";
import {
  getTenantDb,
  withDedicatedTenantDb,
  controlDb,
  tenants,
  recurringInvoiceTemplates,
  recurringInvoiceRuns,
} from "@hisaabo/db";
import { generateInvoiceInTx, toTemplateRow, computeNextRunDate } from "./recurring-invoice-generator.js";
import { RECURRING_RUNS_PER_MONTH_FREE } from "./plan-limits.js";

const TICK_MS = 60_000; // 60 seconds
const MAX_CATCHUP = 12; // Max invoices per template per tick to prevent runaway loops
const MAX_TEMPLATES_PER_TICK = 50; // Per tenant database; the rest are picked up on the next tick
const OCCURRENCE_INDEX = "recurring_run_occurrence_uniq";
const isMultiTenant = process.env.MULTI_TENANT === "true";
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

type SchedulerDb = Awaited<ReturnType<typeof getTenantDb>>;

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    if (!isMultiTenant) {
      const db = await getTenantDb("single");
      await processDueTemplates(db);
    } else {
      const activeTenants = await controlDb
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, "active"));

      for (const tenant of activeTenants) {
        try {
          await withDedicatedTenantDb(tenant.id, (db) => processDueTemplates(db));
        } catch (err) {
          console.error(`[recurring-scheduler] tenant ${tenant.id} error:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[recurring-scheduler] tick error:", err);
  } finally {
    tickInFlight = false;
  }
}

/**
 * True when `err` is the occurrence backstop firing: another runner consumed
 * this occurrence between our claim and our commit. Not a failure.
 */
function isOccurrenceConflict(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    const x = e as { code?: string; constraint_name?: string; cause?: unknown };
    if (x.code === "23505" && x.constraint_name === OCCURRENCE_INDEX) return true;
    e = x.cause;
  }
  return false;
}

/**
 * Consumes ONE occurrence of a due template: claims the row (skipping it when
 * another runner holds it or it is no longer due), then either records a
 * plan-limit skip or generates the invoice, all in a single transaction.
 *
 * Returns true when the template may have another occurrence due right now
 * (catch-up), false to stop.
 */
async function processOccurrence(db: SchedulerDb, templateId: string): Promise<boolean> {
  const claimed: { tpl?: typeof recurringInvoiceTemplates.$inferSelect } = {};
  try {
    return await db.transaction(async (tx) => {
      const [tpl] = await tx.select()
        .from(recurringInvoiceTemplates)
        .where(and(
          eq(recurringInvoiceTemplates.id, templateId),
          eq(recurringInvoiceTemplates.status, "active"),
          lte(recurringInvoiceTemplates.nextRunDate, new Date()),
        ))
        .for("update", { skipLocked: true });
      if (!tpl) return false; // no longer due, or another runner holds the lock
      claimed.tpl = tpl;

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(recurringInvoiceRuns)
        .where(and(
          eq(recurringInvoiceRuns.businessId, tpl.businessId),
          eq(recurringInvoiceRuns.status, "success"),
          gte(recurringInvoiceRuns.executedAt, monthStart),
        ));

      if (count >= RECURRING_RUNS_PER_MONTH_FREE) {
        await tx.insert(recurringInvoiceRuns).values({
          templateId: tpl.id,
          businessId: tpl.businessId,
          status: "skipped_limit",
          errorMessage: `Monthly limit of ${RECURRING_RUNS_PER_MONTH_FREE} runs reached`,
          scheduledFor: tpl.nextRunDate,
        });
        await tx.update(recurringInvoiceTemplates)
          .set({
            nextRunDate: computeNextRunDate(tpl.nextRunDate, tpl.frequency, tpl.customIntervalDays),
            updatedAt: new Date(),
          })
          .where(eq(recurringInvoiceTemplates.id, tpl.id));
        return false; // Plan limit exhausted for this business this month — stop catch-up
      }

      await generateInvoiceInTx(tx, toTemplateRow(tpl));

      const [updated] = await tx.select({
        nextRunDate: recurringInvoiceTemplates.nextRunDate,
        status: recurringInvoiceTemplates.status,
        endDate: recurringInvoiceTemplates.endDate,
      })
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, tpl.id))
        .limit(1);

      const now = new Date();
      if (!updated || updated.status !== "active") return false;
      if (updated.endDate && updated.endDate <= now) return false;
      return updated.nextRunDate <= now;
    });
  } catch (err) {
    if (isOccurrenceConflict(err)) {
      // The transaction rolled back, so nothing was generated twice; the other
      // runner's run record stands. Say so, because with the row lock in place
      // this should not happen.
      console.warn(
        `[recurring-scheduler] template ${templateId}: occurrence ${claimed.tpl?.nextRunDate.toISOString() ?? "?"} ` +
          `was already consumed by another run (${OCCURRENCE_INDEX}); skipped`,
      );
      return false;
    }

    const message = err instanceof Error ? err.message : String(err);
    const { tpl } = claimed;
    if (tpl && (await alreadyRecordedFailure(db, tpl.id, tpl.nextRunDate, message))) {
      // A template that cannot generate stays due and is retried every tick;
      // record the failure once, not once a minute for ever.
      console.warn(`[recurring-scheduler] template ${templateId} is still failing with the recorded error: ${message}`);
      return false;
    }

    console.error(`[recurring-scheduler] Failed to generate invoice for template ${templateId}:`, err);
    if (tpl) {
      // The failed transaction is rolled back, so record the failure on its own.
      await db.insert(recurringInvoiceRuns).values({
        templateId: tpl.id,
        businessId: tpl.businessId,
        status: "failed",
        errorMessage: message,
        scheduledFor: tpl.nextRunDate,
      }).catch(() => {}); // Don't let logging failure crash the loop
    }
    return false; // Stop catch-up on error to avoid cascading failures
  }
}

/** True when the latest run for this occurrence is already a `failed` run with this very message. */
async function alreadyRecordedFailure(
  db: SchedulerDb,
  templateId: string,
  occurrence: Date,
  message: string,
): Promise<boolean> {
  try {
    const [last] = await db.select({ status: recurringInvoiceRuns.status, errorMessage: recurringInvoiceRuns.errorMessage })
      .from(recurringInvoiceRuns)
      .where(and(
        eq(recurringInvoiceRuns.templateId, templateId),
        eq(recurringInvoiceRuns.scheduledFor, occurrence),
      ))
      .orderBy(desc(recurringInvoiceRuns.executedAt), desc(recurringInvoiceRuns.id))
      .limit(1);
    return last?.status === "failed" && last.errorMessage === message;
  } catch {
    return false; // can't tell: record it
  }
}

export async function processDueTemplates(db: SchedulerDb) {
  // Unlocked peek at what is due; each template is then claimed under its own
  // row lock (processOccurrence), which is what excludes concurrent runners.
  const due = await db.select({ id: recurringInvoiceTemplates.id })
    .from(recurringInvoiceTemplates)
    .where(and(
      eq(recurringInvoiceTemplates.status, "active"),
      lte(recurringInvoiceTemplates.nextRunDate, new Date()),
    ))
    .orderBy(asc(recurringInvoiceTemplates.nextRunDate))
    .limit(MAX_TEMPLATES_PER_TICK);

  for (const { id } of due) {
    for (let catchup = 0; catchup < MAX_CATCHUP; catchup++) {
      if (!(await processOccurrence(db, id))) break;
    }
  }
}

export function startRecurringScheduler() {
  if (timer) return;
  console.log("[recurring-scheduler] Started (60s interval)");
  timer = setInterval(tick, TICK_MS);
  timer.unref(); // Don't keep process alive just for this timer
}

export function stopRecurringScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[recurring-scheduler] Stopped");
  }
}

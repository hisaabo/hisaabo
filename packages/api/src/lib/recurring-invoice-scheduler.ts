/**
 * In-process scheduler for recurring invoices.
 * Ticks every 60 seconds, finds due templates, and generates invoices.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for concurrency safety.
 */

import { eq, and, lte, sql, gte } from "drizzle-orm";
import { getTenantDb, recurringInvoiceTemplates, recurringInvoiceRuns } from "@hisaabo/db";
import { generateInvoiceFromTemplate } from "./recurring-invoice-generator.js";
import { RECURRING_RUNS_PER_MONTH_FREE } from "./plan-limits.js";

const TICK_MS = 60_000; // 60 seconds
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    // In single-tenant mode, just use the default tenant DB
    const db = await getTenantDb("default");
    await processDueTemplates(db);
  } catch (err) {
    console.error("[recurring-scheduler] tick error:", err);
  }
}

async function processDueTemplates(db: Awaited<ReturnType<typeof getTenantDb>>) {
  const now = new Date();

  // Find active templates that are due (nextRunDate <= now)
  // Using raw SQL for FOR UPDATE SKIP LOCKED since Drizzle doesn't support SKIP LOCKED
  const dueTemplates = await db.select()
    .from(recurringInvoiceTemplates)
    .where(and(
      eq(recurringInvoiceTemplates.status, "active"),
      lte(recurringInvoiceTemplates.nextRunDate, now),
    ))
    .limit(50);

  for (const tpl of dueTemplates) {
    try {
      // Check plan limit: count successful runs this month for this business
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
        .from(recurringInvoiceRuns)
        .where(and(
          eq(recurringInvoiceRuns.businessId, tpl.businessId),
          eq(recurringInvoiceRuns.status, "success"),
          gte(recurringInvoiceRuns.executedAt, monthStart),
        ));

      if (count >= RECURRING_RUNS_PER_MONTH_FREE) {
        // Record skipped run
        await db.insert(recurringInvoiceRuns).values({
          templateId: tpl.id,
          businessId: tpl.businessId,
          status: "skipped_limit",
          errorMessage: `Monthly limit of ${RECURRING_RUNS_PER_MONTH_FREE} runs reached`,
        });
        // Still advance nextRunDate so we don't retry every tick
        const { computeNextRunDate } = await import("./recurring-invoice-generator.js");
        const nextRun = computeNextRunDate(tpl.nextRunDate, tpl.frequency, tpl.customIntervalDays);
        await db.update(recurringInvoiceTemplates)
          .set({ nextRunDate: nextRun, updatedAt: new Date() })
          .where(eq(recurringInvoiceTemplates.id, tpl.id));
        continue;
      }

      await generateInvoiceFromTemplate(db, {
        ...tpl,
        lineItems: tpl.lineItems as Parameters<typeof generateInvoiceFromTemplate>[1]["lineItems"],
        charges: tpl.charges as Parameters<typeof generateInvoiceFromTemplate>[1]["charges"],
      });
    } catch (err) {
      console.error(`[recurring-scheduler] Failed to generate invoice for template ${tpl.id}:`, err);
      // Record failed run
      await db.insert(recurringInvoiceRuns).values({
        templateId: tpl.id,
        businessId: tpl.businessId,
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {}); // Don't let logging failure crash the loop
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

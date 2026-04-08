/**
 * In-process scheduler for recurring invoices.
 * Ticks every 60 seconds, finds due templates, and generates invoices.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED for concurrency safety.
 */

import { eq, and, sql, gte, lte } from "drizzle-orm";
import { getTenantDb, controlDb, tenants, recurringInvoiceTemplates, recurringInvoiceRuns } from "@hisaabo/db";
import { generateInvoiceFromTemplate } from "./recurring-invoice-generator.js";
import { RECURRING_RUNS_PER_MONTH_FREE } from "./plan-limits.js";

const TICK_MS = 60_000; // 60 seconds
const MAX_CATCHUP = 12; // Max invoices per template per tick to prevent runaway loops
const isMultiTenant = process.env.MULTI_TENANT === "true";
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  try {
    if (!isMultiTenant) {
      // Self-hosted: single tenant DB
      const db = await getTenantDb("single");
      await processDueTemplates(db);
    } else {
      // Multi-tenant: iterate all active tenants
      const activeTenants = await controlDb
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.status, "active"));

      for (const tenant of activeTenants) {
        try {
          const db = await getTenantDb(tenant.id);
          await processDueTemplates(db);
        } catch (err) {
          console.error(`[recurring-scheduler] tenant ${tenant.id} error:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[recurring-scheduler] tick error:", err);
  }
}

export async function processDueTemplates(db: Awaited<ReturnType<typeof getTenantDb>>) {
  // Find active templates that are due, using FOR UPDATE SKIP LOCKED
  // to prevent duplicate processing in multi-instance deployments.
  const dueTemplates = await db.transaction(async (tx) => {
    return tx.select()
      .from(recurringInvoiceTemplates)
      .where(and(
        eq(recurringInvoiceTemplates.status, "active"),
        lte(recurringInvoiceTemplates.nextRunDate, new Date()),
      ))
      .limit(50)
      .for("update", { skipLocked: true });
  });

  for (const tpl of dueTemplates) {
    let catchupCount = 0;
    let currentNextRunDate = tpl.nextRunDate;
    let currentTotalRuns = tpl.totalRuns;

    while (currentNextRunDate <= new Date() && catchupCount < MAX_CATCHUP) {
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
          const nextRun = computeNextRunDate(currentNextRunDate, tpl.frequency, tpl.customIntervalDays);
          await db.update(recurringInvoiceTemplates)
            .set({ nextRunDate: nextRun, updatedAt: new Date() })
            .where(eq(recurringInvoiceTemplates.id, tpl.id));
          break; // Plan limit exhausted for this business this month — stop catch-up
        }

        await generateInvoiceFromTemplate(db, {
          ...tpl,
          nextRunDate: currentNextRunDate,
          totalRuns: currentTotalRuns,
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
        break; // Stop catch-up on error to avoid cascading failures
      }

      catchupCount++;

      // Re-read template to get the updated nextRunDate and totalRuns (the generator advances both)
      const [updated] = await db.select({
        nextRunDate: recurringInvoiceTemplates.nextRunDate,
        totalRuns: recurringInvoiceTemplates.totalRuns,
        status: recurringInvoiceTemplates.status,
        endDate: recurringInvoiceTemplates.endDate,
      })
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, tpl.id))
        .limit(1);

      if (!updated || updated.status !== "active") break;
      if (updated.endDate && updated.endDate <= new Date()) break;

      currentNextRunDate = updated.nextRunDate;
      currentTotalRuns = updated.totalRuns;
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

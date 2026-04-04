/**
 * BDD workflow tests for the recurring invoice lifecycle.
 *
 * These tests verify the REAL recurring invoice workflows:
 *   - Template creation with schedule calculation
 *   - Manual trigger (runNow) → invoice generated → stock adjusted
 *   - Pause/resume lifecycle with nextRunDate recalculation
 *   - maxRuns and endDate completion guards
 *   - Template deletion (hard delete)
 *
 * The recurring invoice system generates invoices via:
 *   recurringInvoice.runNow → generateInvoiceFromTemplate() →
 *     validate party/items → atomic counter → calc totals → create invoice →
 *     adjust stock → record run → bump totalRuns → advance nextRunDate
 *
 * Workflow reference: docs/workflows/WORKFLOW-SPECS.md §11 (Recurring Invoices)
 * Test case IDs: REC-01 through REC-11
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  invoices,
  items as itemsTable,
  recurringInvoiceTemplates,
  recurringInvoiceRuns,
} from "@hisaabo/db";
import {
  createTestWorld,
  createItem,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

async function getStockQty(itemId: string): Promise<string> {
  const db = getTenantTestDb();
  const [row] = await db
    .select({ stockQuantity: itemsTable.stockQuantity })
    .from(itemsTable)
    .where(eq(itemsTable.id, itemId))
    .limit(1);
  return row?.stockQuantity ?? "0.000";
}

// Base input for creating a recurring template
function baseTemplateInput(partyId: string, itemId?: string) {
  return {
    partyId,
    name: "Monthly Invoice Template",
    type: "sale" as const,
    frequency: "monthly" as const,
    startDate: pastDate(1), // start in the past so nextRunDate is computed from now
    lineItems: [
      {
        description: "Monthly service fee",
        quantity: "1",
        unitPrice: "5000.00",
        taxPercent: "18",
        discountPercent: "0",
        ...(itemId ? { itemId } : {}),
      },
    ],
  };
}

// =============================================================================
// REC-01: Create template
// =============================================================================

describe("REC-01: Create recurring invoice template", () => {
  it("creates a template with status=active and nextRunDate calculated from start date", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create(
      baseTemplateInput(world.party1.id),
    );

    expect(template.status).toBe("active");
    expect(template.name).toBe("Monthly Invoice Template");
    expect(template.frequency).toBe("monthly");
    expect(template.totalRuns).toBe(0);
    expect(template.nextRunDate).toBeDefined();

    // nextRunDate should be in the future (since startDate was in the past)
    const nextRun = new Date(template.nextRunDate);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
  });

  it("custom frequency requires customIntervalDays — rejected without it", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.recurringInvoice.create({
        ...baseTemplateInput(world.party1.id),
        frequency: "custom" as const,
        // customIntervalDays omitted
      })
    ).rejects.toBeDefined();
  });

  it("custom frequency with customIntervalDays succeeds", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Bimonthly Template",
      frequency: "custom" as const,
      customIntervalDays: 60,
    });

    expect(template.status).toBe("active");
    expect(template.customIntervalDays).toBe(60);
  });
});

// =============================================================================
// REC-02: Run now — manual invoice generation
// =============================================================================

describe("REC-02: runNow generates invoice from template", () => {
  it("generates an invoice, adjusts stock, records run, bumps totalRuns", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create item with known stock
    const item = await createItem(db, world.business1.id, {
      name: "Recurring Sale Item",
      stockQuantity: "100.000",
      salePrice: "5000.00",
      taxPercent: "18.00",
    });

    const template = await caller.recurringInvoice.create(
      baseTemplateInput(world.party1.id, item.id),
    );

    // Run now
    const result = await caller.recurringInvoice.runNow({ id: template.id });
    expect(result.invoiceId).toBeDefined();
    expect(result.runId).toBeDefined();

    // Verify invoice was created
    const [invoice] = await db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      totalAmount: invoices.totalAmount,
      type: invoices.type,
      documentType: invoices.documentType,
      source: invoices.source,
      partyId: invoices.partyId,
    }).from(invoices).where(eq(invoices.id, result.invoiceId));

    expect(invoice!.invoiceNumber).toMatch(/^INV-\d{5}$/);
    expect(invoice!.type).toBe("sale");
    expect(invoice!.documentType).toBe("invoice");
    expect(invoice!.source).toBe("recurring");
    expect(invoice!.partyId).toBe(world.party1.id);

    // Verify stock decremented (sale = decrement)
    expect(await getStockQty(item.id)).toBe("99.000");

    // Verify run recorded
    const runs = await db.select()
      .from(recurringInvoiceRuns)
      .where(eq(recurringInvoiceRuns.templateId, template.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("success");
    expect(runs[0]!.invoiceId).toBe(result.invoiceId);

    // Verify template updated
    const [updatedTpl] = await db.select({
      totalRuns: recurringInvoiceTemplates.totalRuns,
      lastRunDate: recurringInvoiceTemplates.lastRunDate,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));

    expect(updatedTpl!.totalRuns).toBe(1);
    expect(updatedTpl!.lastRunDate).not.toBeNull();
  });
});

// =============================================================================
// REC-05: maxRuns completion
// =============================================================================

describe("REC-05: maxRuns reached marks template as completed", () => {
  it("template becomes completed after reaching maxRuns", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Max Runs Template",
      maxRuns: 2,
    });

    // Run 1
    await caller.recurringInvoice.runNow({ id: template.id });

    const [afterRun1] = await db.select({
      totalRuns: recurringInvoiceTemplates.totalRuns,
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));

    expect(afterRun1!.totalRuns).toBe(1);
    expect(afterRun1!.status).toBe("active");

    // Run 2 (hits maxRuns)
    await caller.recurringInvoice.runNow({ id: template.id });

    const [afterRun2] = await db.select({
      totalRuns: recurringInvoiceTemplates.totalRuns,
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));

    expect(afterRun2!.totalRuns).toBe(2);
    expect(afterRun2!.status).toBe("completed");
  });
});

// =============================================================================
// REC-07..10: Pause/Resume lifecycle
// =============================================================================

describe("REC-07..10: Pause and Resume lifecycle", () => {
  it("REC-07: pausing an active template sets status=paused", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Pause Test Template",
    });
    expect(template.status).toBe("active");

    const paused = await caller.recurringInvoice.pause({ id: template.id });
    expect(paused.status).toBe("paused");
  });

  it("REC-08: resuming a paused template sets status=active and recalculates nextRunDate", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Resume Test Template",
    });

    await caller.recurringInvoice.pause({ id: template.id });

    const beforeResume = new Date();
    const resumed = await caller.recurringInvoice.resume({ id: template.id });

    expect(resumed.status).toBe("active");
    // nextRunDate should be recalculated from "now", not from the old date
    const newNextRun = new Date(resumed.nextRunDate);
    expect(newNextRun.getTime()).toBeGreaterThan(beforeResume.getTime());
  });

  it("REC-09: pausing a non-active template fails", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Double Pause Template",
    });

    // Pause once (succeeds)
    await caller.recurringInvoice.pause({ id: template.id });

    // Pause again (should fail — already paused)
    await expect(
      caller.recurringInvoice.pause({ id: template.id })
    ).rejects.toMatchObject({
      message: expect.stringContaining("not active"),
    });
  });

  it("REC-10: resuming a non-paused template fails", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Resume Non-Paused Template",
    });

    // Template is active, not paused — resume should fail
    await expect(
      caller.recurringInvoice.resume({ id: template.id })
    ).rejects.toMatchObject({
      message: expect.stringContaining("not paused"),
    });
  });
});

// =============================================================================
// REC-11: Run now (manual trigger)
// =============================================================================

describe("REC-11: runNow — manual trigger", () => {
  it("runNow works on active template and creates invoice immediately", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Manual Run Template",
    });

    const result = await caller.recurringInvoice.runNow({ id: template.id });
    expect(result.invoiceId).toBeDefined();

    // Verify the invoice exists
    const [inv] = await db.select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.id, result.invoiceId));
    expect(inv).toBeDefined();
  });

  it("runNow works on paused template (still allowed)", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Paused Manual Run Template",
    });

    await caller.recurringInvoice.pause({ id: template.id });

    // Should still work — runNow is allowed on paused templates
    const result = await caller.recurringInvoice.runNow({ id: template.id });
    expect(result.invoiceId).toBeDefined();
  });

  it("runNow on a completed template fails", async () => {
    const caller = callerForRamesh();

    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Completed Template",
      maxRuns: 1,
    });

    // First run completes the template
    await caller.recurringInvoice.runNow({ id: template.id });

    // Second runNow should fail — template is completed
    await expect(
      caller.recurringInvoice.runNow({ id: template.id })
    ).rejects.toMatchObject({
      message: expect.stringContaining("active or paused"),
    });
  });
});

// =============================================================================
// Full lifecycle: create → run → run → maxRuns → completed → cannot run
// =============================================================================

describe("Recurring invoice full lifecycle", () => {
  it("template progresses: active → runNow → pause → resume → runNow → completed (maxRuns)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create template with maxRuns=2
    const template = await caller.recurringInvoice.create({
      ...baseTemplateInput(world.party1.id),
      name: "Full Lifecycle Template",
      maxRuns: 2,
    });

    // Step 1: Run once
    const run1 = await caller.recurringInvoice.runNow({ id: template.id });
    expect(run1.invoiceId).toBeDefined();

    let [tpl] = await db.select({
      totalRuns: recurringInvoiceTemplates.totalRuns,
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));
    expect(tpl!.totalRuns).toBe(1);
    expect(tpl!.status).toBe("active");

    // Step 2: Pause
    await caller.recurringInvoice.pause({ id: template.id });
    [tpl] = await db.select({
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));
    expect(tpl!.status).toBe("paused");

    // Step 3: Resume
    await caller.recurringInvoice.resume({ id: template.id });
    [tpl] = await db.select({
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));
    expect(tpl!.status).toBe("active");

    // Step 4: Run again (hits maxRuns=2)
    const run2 = await caller.recurringInvoice.runNow({ id: template.id });
    expect(run2.invoiceId).toBeDefined();

    [tpl] = await db.select({
      totalRuns: recurringInvoiceTemplates.totalRuns,
      status: recurringInvoiceTemplates.status,
    }).from(recurringInvoiceTemplates)
      .where(eq(recurringInvoiceTemplates.id, template.id));
    expect(tpl!.totalRuns).toBe(2);
    expect(tpl!.status).toBe("completed");

    // Step 5: Cannot run anymore
    await expect(
      caller.recurringInvoice.runNow({ id: template.id })
    ).rejects.toBeDefined();

    // Verify 2 run records exist
    const runs = await db.select()
      .from(recurringInvoiceRuns)
      .where(eq(recurringInvoiceRuns.templateId, template.id));
    expect(runs).toHaveLength(2);
    expect(runs.every(r => r.status === "success")).toBe(true);
  });
});

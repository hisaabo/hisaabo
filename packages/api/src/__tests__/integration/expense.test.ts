/**
 * expense.test.ts — Integration tests for expenseRouter
 *
 * WHY THIS FILE EXISTS:
 * Expenses are the third leg of financial reporting (after sales and purchases).
 * The router provides CRUD operations with soft-delete semantics, date-range
 * filtering, category-based grouping, and a summary view. Key invariants:
 *
 *   1. Soft delete: deletedAt is set rather than the row being removed.
 *      Deleted expenses must be invisible to list/summary queries.
 *   2. Category filter is an exact-match string — not fuzzy.
 *   3. Date range boundaries are inclusive (gte/lte, not gt/lt).
 *   4. Business isolation: one business cannot see another's expenses.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createExpense, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoDatetime(date: Date): string {
  return date.toISOString();
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── CRUD ───────────────────────────────────────────────────────────────────────

describe("expense.create", () => {
  it("expense.create persists a new expense and returns the created row", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.expense.create({
      category: "Transport",
      description: "Auto rickshaw to supplier",
      amount: "350.00",
      mode: "cash",
      expenseDate: isoDatetime(new Date()),
    });

    expect(result).toBeDefined();
    expect(result!.category).toBe("Transport");
    expect(result!.amount).toBe("350.00");
    expect(result!.businessId).toBe(world.business1.id);
    expect(result!.deletedAt).toBeNull();
  });

  it("expense.create validates category is required — gap: empty string should fail Zod", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await expect(
      caller.expense.create({
        category: "",
        description: "No category test",
        amount: "100.00",
        mode: "cash",
      }),
    ).rejects.toThrow();
  });

  it("expense.create validates amount must be a valid decimal string", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await expect(
      caller.expense.create({
        category: "Test",
        description: "Bad amount",
        amount: "not-a-number",
        mode: "cash",
      }),
    ).rejects.toThrow();
  });
});

describe("expense.list", () => {
  it("expense.list returns paginated expenses for the business", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Seed two expenses
    await caller.expense.create({
      category: "Stationery",
      description: "Notebook and pens",
      amount: "200.00",
      mode: "cash",
      expenseDate: isoDatetime(daysAgo(1)),
    });

    await caller.expense.create({
      category: "Utilities",
      description: "Electricity bill",
      amount: "3000.00",
      mode: "bank",
      expenseDate: isoDatetime(daysAgo(2)),
    });

    const result = await caller.expense.list({ page: 1, limit: 20 });

    expect(Array.isArray(result.data)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it("expense.list category filter returns only matching expenses", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await caller.expense.create({
      category: "Marketing",
      description: "Social media ads",
      amount: "5000.00",
      mode: "bank",
    });

    const result = await caller.expense.list({ category: "Marketing", page: 1, limit: 20 });

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    for (const row of result.data) {
      expect(row.category).toBe("Marketing");
    }
  });

  it("expense.list date range filter respects inclusive boundaries", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const anchorDate = daysAgo(30);

    await caller.expense.create({
      category: "Audit",
      description: "CA audit fees",
      amount: "10000.00",
      mode: "bank",
      expenseDate: isoDatetime(anchorDate),
    });

    // Window that includes anchorDate
    const from = isoDatetime(daysAgo(31));
    const to = isoDatetime(daysAgo(29));

    const withinResult = await caller.expense.list({ fromDate: from, toDate: to, page: 1, limit: 50 });
    const auditExpenses = withinResult.data.filter((e) => e.description === "CA audit fees");
    expect(auditExpenses.length).toBeGreaterThanOrEqual(1);

    // Window that excludes anchorDate
    const tooNarrow = await caller.expense.list({
      fromDate: isoDatetime(daysAgo(5)),
      toDate: isoDatetime(new Date()),
      page: 1,
      limit: 50,
    });
    const auditInNarrow = tooNarrow.data.filter((e) => e.description === "CA audit fees");
    expect(auditInNarrow.length).toBe(0);
  });

  it("expense.list — business isolation: business2 returns empty list", async () => {
    const caller2 = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await caller2.expense.list({ page: 1, limit: 20 });

    // business2 has no expenses
    expect(result.data.length).toBe(0);
    expect(result.total).toBe(0);
  });
});

describe("expense.update", () => {
  it("expense.update changes the amount and category of an existing expense", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.expense.create({
      category: "Travel",
      description: "Flight ticket",
      amount: "8000.00",
      mode: "bank",
    });

    const updated = await caller.expense.update({
      id: created!.id,
      data: { amount: "9500.00", category: "Travel & Accommodation" },
    });

    expect(updated!.amount).toBe("9500.00");
    expect(updated!.category).toBe("Travel & Accommodation");
  });

  it("expense.update throws NOT_FOUND for expense belonging to another business", async () => {
    const callerRamesh = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await callerRamesh.expense.create({
      category: "Rent",
      description: "Office rent",
      amount: "25000.00",
      mode: "bank",
    });

    // kiran tries to update ramesh's expense
    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    await expect(
      callerKiran.expense.update({
        id: created!.id,
        data: { amount: "1.00" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("expense.delete", () => {
  it("expense.delete soft-deletes the expense — row remains in DB but invisible to list", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.expense.create({
      category: "Miscellaneous",
      description: "Soft-delete test expense",
      amount: "100.00",
      mode: "cash",
    });

    const deleteResult = await caller.expense.delete({ id: created!.id });
    expect(deleteResult.success).toBe(true);

    // Should no longer appear in list
    const listResult = await caller.expense.list({ page: 1, limit: 100 });
    const found = listResult.data.find((e) => e.id === created!.id);
    expect(found).toBeUndefined();
  });

  it("expense.delete is idempotent — calling delete twice returns success both times", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.expense.create({
      category: "Idempotent",
      description: "Delete twice test",
      amount: "50.00",
      mode: "cash",
    });

    await caller.expense.delete({ id: created!.id });
    const second = await caller.expense.delete({ id: created!.id });
    expect(second.success).toBe(true);
  });
});

// ── categories ─────────────────────────────────────────────────────────────────

describe("expense.categories", () => {
  it("expense.categories returns distinct category strings for the business", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await caller.expense.create({ category: "UniqueCategory_Alpha", description: "Test", amount: "10.00", mode: "cash" });
    await caller.expense.create({ category: "UniqueCategory_Alpha", description: "Duplicate", amount: "20.00", mode: "cash" });
    await caller.expense.create({ category: "UniqueCategory_Beta", description: "Another", amount: "30.00", mode: "cash" });

    const categories = await caller.expense.categories();

    expect(Array.isArray(categories)).toBe(true);
    const alpha = categories.filter((c) => c === "UniqueCategory_Alpha");
    expect(alpha.length).toBe(1); // distinct — not duplicated
    expect(categories).toContain("UniqueCategory_Beta");
  });

  it("expense.categories excludes soft-deleted expense categories", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.expense.create({
      category: "GhostCategory_ToDelete",
      description: "Will be deleted",
      amount: "10.00",
      mode: "cash",
    });

    await caller.expense.delete({ id: created!.id });

    const categories = await caller.expense.categories();
    expect(categories).not.toContain("GhostCategory_ToDelete");
  });
});

// ── summary ────────────────────────────────────────────────────────────────────

describe("expense.summary", () => {
  it("expense.summary groups totals by category", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    await caller.expense.create({ category: "SummaryTest", description: "A", amount: "100.00", mode: "cash" });
    await caller.expense.create({ category: "SummaryTest", description: "B", amount: "200.00", mode: "cash" });

    const summary = await caller.expense.summary({ from: undefined, to: undefined });

    const summaryTestRow = summary.find((s) => s.category === "SummaryTest");
    expect(summaryTestRow).toBeDefined();
    expect(parseFloat(summaryTestRow!.total)).toBeGreaterThanOrEqual(300);
    expect(summaryTestRow!.count).toBeGreaterThanOrEqual(2);
  });

  it("expense.summary respects date range filter — earlier expenses excluded", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // Expense from 90 days ago
    await createExpense(world.tenantDb, world.business1.id, {
      category: "OldSummaryCategory",
      amount: "9999.00",
      expenseDate: daysAgo(90),
    });

    // Query only last 7 days
    const summary = await caller.expense.summary({
      from: isoDatetime(daysAgo(7)),
      to: isoDatetime(new Date()),
    });

    const oldRow = summary.find((s) => s.category === "OldSummaryCategory");
    expect(oldRow).toBeUndefined();
  });
});

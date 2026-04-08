import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { chartOfAccounts, journalEntries, journalEntryLines } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

let world: TestWorld;
let cashAccountId: string;
let capitalAccountId: string;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);

  // Get account IDs for test entries
  const accounts = await db.select().from(chartOfAccounts)
    .where(eq(chartOfAccounts.businessId, world.business1.id));
  cashAccountId = accounts.find(a => a.code === "1000")!.id;
  capitalAccountId = accounts.find(a => a.code === "3000")!.id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

describe("journal.create", () => {
  it("creates a balanced journal entry", async () => {
    const caller = callerForRamesh();
    const entry = await caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "Capital introduction",
      lines: [
        { accountId: cashAccountId, debit: "100000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "100000.00" },
      ],
    });
    expect(entry.id).toBeDefined();
    expect(entry.entryNumber).toMatch(/^JE-/);
    expect(entry.narration).toBe("Capital introduction");
  });

  it("rejects unbalanced entry", async () => {
    const caller = callerForRamesh();
    await expect(caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "Unbalanced",
      lines: [
        { accountId: cashAccountId, debit: "1000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "500.00" },
      ],
    })).rejects.toThrow();
  });

  it("rejects entry with fewer than 2 lines", async () => {
    const caller = callerForRamesh();
    await expect(caller.journal.create({
      entryDate: new Date().toISOString(),
      lines: [
        { accountId: cashAccountId, debit: "1000.00", credit: "0" },
      ],
    })).rejects.toThrow();
  });
});

describe("journal.list", () => {
  it("returns journal entries for the business", async () => {
    const caller = callerForRamesh();
    const result = await caller.journal.list({
      fromDate: new Date("2020-01-01").toISOString(),
      toDate: new Date("2030-12-31").toISOString(),
    });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("journal.getById", () => {
  it("returns entry with lines", async () => {
    const caller = callerForRamesh();
    // Create first, then get
    const created = await caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "Test get by id",
      lines: [
        { accountId: cashAccountId, debit: "5000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "5000.00" },
      ],
    });
    const entry = await caller.journal.getById({ id: created.id });
    expect(entry.lines).toHaveLength(2);
    expect(entry.narration).toBe("Test get by id");
  });
});

describe("journal.delete", () => {
  it("deletes a journal entry and its lines", async () => {
    const caller = callerForRamesh();
    const created = await caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "To be deleted",
      lines: [
        { accountId: cashAccountId, debit: "1000.00", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "1000.00" },
      ],
    });
    await caller.journal.delete({ id: created.id });

    // Verify it's gone
    const db = getTenantTestDb();
    const remaining = await db.select().from(journalEntries)
      .where(eq(journalEntries.id, created.id));
    expect(remaining).toHaveLength(0);

    // Verify lines are also gone (cascade)
    const remainingLines = await db.select().from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, created.id));
    expect(remainingLines).toHaveLength(0);
  });
});

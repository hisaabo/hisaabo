import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { chartOfAccounts } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

let world: TestWorld;
let cashId: string;
let capitalId: string;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);
  const accounts = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.businessId, world.business1.id));
  cashId = accounts.find((a) => a.code === "1000")!.id;
  capitalId = accounts.find((a) => a.code === "3000")!.id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

describe("reports.tallyExport manual journal entries", () => {
  it("includes lines of every manual journal entry in the period", async () => {
    const c = caller();
    await c.journal.create({
      entryDate: new Date("2031-03-10").toISOString(),
      narration: "TALLY-JE-ONE",
      lines: [
        { accountId: cashId, debit: "111.00", credit: "0" },
        { accountId: capitalId, debit: "0", credit: "111.00" },
      ],
    });
    await c.journal.create({
      entryDate: new Date("2031-03-11").toISOString(),
      narration: "TALLY-JE-TWO",
      lines: [
        { accountId: cashId, debit: "222.00", credit: "0" },
        { accountId: capitalId, debit: "0", credit: "222.00" },
      ],
    });

    const { xml } = await c.reports.tallyExport({
      fromDate: new Date("2031-03-01").toISOString(),
      toDate: new Date("2031-03-31").toISOString(),
    });

    expect(xml).toContain("TALLY-JE-ONE");
    expect(xml).toContain("TALLY-JE-TWO");
    expect(xml).toContain("<AMOUNT>-111.00</AMOUNT>");
    expect(xml).toContain("<AMOUNT>111.00</AMOUNT>");
    expect(xml).toContain("<AMOUNT>-222.00</AMOUNT>");
    expect(xml).toContain("<AMOUNT>222.00</AMOUNT>");
  });
});

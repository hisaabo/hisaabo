import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { chartOfAccounts } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { logger } from "../../lib/logger.js";
import { resetDeprecationWarnings } from "../../lib/deprecations.js";

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

describe("reports.tallyExport after journal.delete", () => {
  it("keeps the deleted (voided) entry and its reversal in the XML so the books still net to zero", async () => {
    const c = caller();
    const created = await c.journal.create({
      entryDate: new Date("2031-05-10").toISOString(),
      narration: "TALLY-JE-DELETED",
      lines: [
        { accountId: cashId, debit: "333.00", credit: "0" },
        { accountId: capitalId, debit: "0", credit: "333.00" },
      ],
    });
    await c.journal.delete({ id: created.id });

    const { xml } = await c.reports.tallyExport({
      fromDate: new Date("2031-05-01").toISOString(),
      toDate: new Date("2031-05-31").toISOString(),
    });

    expect(xml).toContain("TALLY-JE-DELETED");
    expect(xml).toContain(`Void: reversal of ${created.entryNumber}`);
    // Original and reversal: two vouchers, each with a -333.00 and a 333.00 leg.
    expect(xml.match(/<AMOUNT>-333\.00<\/AMOUNT>/g)).toHaveLength(2);
    expect(xml.match(/<AMOUNT>333\.00<\/AMOUNT>/g)).toHaveLength(2);
  });
});

describe("party.tallyExport (deprecated CSV)", () => {
  it("still returns the CSV, and warns once per hour that reports.tallyExport replaces it", async () => {
    resetDeprecationWarnings();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const c = caller();
      const first = await c.party.tallyExport({});
      await c.party.tallyExport({});

      // Behaviour unchanged.
      expect(first.csv.split("\n")[0]).toBe("Date,Vch Type,Vch No.,Debit Ledger,Credit Ledger,Amount");
      expect(first.filename).toMatch(/^tally-export.*\.csv$/);
      expect(typeof first.rowCount).toBe("number");

      const deprecations = warn.mock.calls.filter(
        ([fields]) => (fields as { procedure?: string }).procedure === "party.tallyExport",
      );
      expect(deprecations).toHaveLength(1);
      const [fields, message] = deprecations[0] as unknown as [Record<string, unknown>, string];
      expect(fields).toMatchObject({ deprecated: true, replacement: "reports.tallyExport" });
      expect(message).toContain("reports.tallyExport");
      // No request data in the log line.
      expect(JSON.stringify(fields)).not.toContain(world.ramesh.email);
    } finally {
      warn.mockRestore();
    }
  });
});

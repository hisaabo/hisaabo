/**
 * bank-statement-dedup.test.ts — duplicate detection in bankRecon.confirmMapping.
 *
 * A parsed statement line is a duplicate when a line already exists in a
 * DIFFERENT import of the SAME bank account with the same day, debit, credit and
 * reference number (normalized narration when the line has no reference).
 * Duplicates are skipped when the client sends `skipDuplicates: true` (the 0.10.1
 * web app does), counted in `duplicatesSkipped`, and never matched against
 * another business or another bank account. The server default is OFF, so a
 * 0.10.0 client that never sends the flag imports every line, as before.
 *
 *   Default (flag omitted)        nothing is skipped
 *   Overlapping statements        only the new lines are imported
 *   Same file uploaded twice      every line is skipped, nothing inserted
 *   Re-confirming one import      its own old lines are not "duplicates"
 *   Reference / narration rules   reference wins; narration is the fallback
 *   Scope                         other bank accounts and other businesses
 *   Multiset                      identical lines are not collapsed
 *   skipDuplicates=false          escape hatch imports everything
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { bankStatementImports, bankStatementLines } from "@hisaabo/db";
import {
  createTestWorld,
  createBankAccount,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let accountSeq = 0;

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function callerForKiran() {
  return createTestCaller({
    userId: world.kiran.id,
    email: world.kiran.email,
    name: world.kiran.name ?? null,
    tenantId: world.tenant2.id,
    businessId: world.business2.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function newAccount(businessId: string) {
  accountSeq += 1;
  return createBankAccount(getTenantTestDb(), businessId, {
    accountName: `Dedup account ${accountSeq}`,
    accountNumber: `990000${String(accountSeq).padStart(6, "0")}`,
    isDefault: false,
  });
}

/** Date, Narration, Ref, Debit, Credit, Balance */
function csv(...rows: string[]): string {
  return ["Date,Narration,Ref,Debit,Credit,Balance", ...rows].join("\n");
}

const MAPPING = {
  date: 0,
  narration: 1,
  reference: 2,
  debit: 3,
  credit: 4,
  balance: 5,
  dateFormat: "DD/MM/YYYY",
  skipRows: 1,
};

async function importCsv(
  caller: ReturnType<typeof callerForRamesh>,
  bankAccountId: string,
  content: string,
  // The server default is off, so the dedup tests turn it on explicitly, like the
  // 0.10.1 web app does. "omit" sends no flag at all, like a 0.10.0 client.
  opts: { skipDuplicates?: boolean | "omit" } = {},
) {
  const skipDuplicates = opts.skipDuplicates ?? true;
  const upload = await caller.bankRecon.uploadCSV({
    bankAccountId,
    fileName: "statement.csv",
    csvContent: content,
  });
  const result = await caller.bankRecon.confirmMapping({
    importId: upload.importId,
    csvContent: content,
    columnMapping: MAPPING,
    ...(skipDuplicates === "omit" ? {} : { skipDuplicates }),
  });
  return { importId: upload.importId, result };
}

async function linesOf(importId: string) {
  return getTenantTestDb()
    .select()
    .from(bankStatementLines)
    .where(eq(bankStatementLines.importId, importId));
}

const L1 = "01/04/2026,UPI/PAY/RAJ TRADERS,UPI111,5000.00,,95000.00";
const L2 = "02/04/2026,NEFT/SALARY/ACME,NEFT222,,50000.00,145000.00";
const L3 = "03/04/2026,ATM/WDL/HDFC,ATM333,2000.00,,143000.00";
const L4 = "04/04/2026,UPI/PAY/GUPTA SUPPLIERS,UPI444,1200.00,,141800.00";

describe("bankRecon.confirmMapping duplicate detection", () => {
  it("is off by default: a client that sends no skipDuplicates flag imports every line (0.10.0 clients)", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1, L2, L3));
    const second = await importCsv(caller, account.id, csv(L2, L3, L4), { skipDuplicates: "omit" });

    expect(second.result).toMatchObject({ totalLines: 3, duplicatesSkipped: 0 });
    expect(await linesOf(second.importId)).toHaveLength(3);
  });

  it("imports only the new lines of an overlapping statement", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    const first = await importCsv(caller, account.id, csv(L1, L2, L3));
    expect(first.result).toMatchObject({ totalLines: 3, duplicatesSkipped: 0 });

    // Second statement overlaps on L2 and L3 and adds L4.
    const second = await importCsv(caller, account.id, csv(L2, L3, L4));
    expect(second.result.duplicatesSkipped).toBe(2);
    expect(second.result.totalLines).toBe(1);
    expect(second.result.matchedLines + second.result.unmatchedLines).toBe(1);

    const secondLines = await linesOf(second.importId);
    expect(secondLines).toHaveLength(1);
    expect(secondLines[0]!.referenceNumber).toBe("UPI444");
    // The line keeps its position in the file (line 3 of the second statement).
    expect(secondLines[0]!.lineNumber).toBe(3);

    // The first import is untouched, and the import row reflects the inserted lines.
    expect(await linesOf(first.importId)).toHaveLength(3);
    const [imp] = await getTenantTestDb()
      .select()
      .from(bankStatementImports)
      .where(eq(bankStatementImports.id, second.importId));
    expect(imp!.status).toBe("review");
    expect(imp!.totalLines).toBe(1);
    // Statement metadata describes the whole file, not just the new lines.
    expect(imp!.closingBalance).toBe("141800.00");
  });

  it("skips every line when the same file is uploaded again", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1, L2, L3));
    const again = await importCsv(caller, account.id, csv(L1, L2, L3));

    expect(again.result).toMatchObject({
      totalLines: 0,
      matchedLines: 0,
      unmatchedLines: 0,
      duplicatesSkipped: 3,
    });
    expect(await linesOf(again.importId)).toHaveLength(0);
  });

  it("does not treat the import's own old lines as duplicates when it is re-confirmed", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    const first = await importCsv(caller, account.id, csv(L1, L2));
    expect(first.result.duplicatesSkipped).toBe(0);

    // A re-import: the same import goes back to a mappable state, then is
    // confirmed again with the same file. It deletes its own lines first, so
    // nothing may be skipped and nothing may be lost.
    const db = getTenantTestDb();
    await db
      .update(bankStatementImports)
      .set({ status: "mapped" })
      .where(eq(bankStatementImports.id, first.importId));

    const again = await caller.bankRecon.confirmMapping({
      importId: first.importId,
      csvContent: csv(L1, L2),
      columnMapping: MAPPING,
      skipDuplicates: true,
    });
    expect(again).toMatchObject({ totalLines: 2, duplicatesSkipped: 0 });
    expect(await linesOf(first.importId)).toHaveLength(2);
  });

  it("uses the reference number when present: same reference is a duplicate even if the narration differs", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1));
    const reworded = "01/04/2026,UPI PAYMENT TO RAJ TRADERS (reworded),UPI111,5000.00,,95000.00";
    const second = await importCsv(caller, account.id, csv(reworded));
    expect(second.result).toMatchObject({ totalLines: 0, duplicatesSkipped: 1 });
  });

  it("does not skip a line whose reference differs (same day, amount and narration)", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1));
    const otherRef = "01/04/2026,UPI/PAY/RAJ TRADERS,UPI999,5000.00,,95000.00";
    const second = await importCsv(caller, account.id, csv(otherRef));
    expect(second.result).toMatchObject({ totalLines: 1, duplicatesSkipped: 0 });
  });

  it("falls back to normalized narration when there is no reference", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    const noRef = "05/04/2026,POS PURCHASE  Starbucks,,350.00,,99650.00";
    await importCsv(caller, account.id, csv(noRef));

    // Same transaction with different case/spacing: duplicate.
    const sameNarration = "05/04/2026,pos purchase starbucks,,350.00,,99650.00";
    const dup = await importCsv(caller, account.id, csv(sameNarration));
    expect(dup.result).toMatchObject({ totalLines: 0, duplicatesSkipped: 1 });

    // Different narration (same day and amount): a different transaction.
    const other = "05/04/2026,POS PURCHASE Cafe Coffee Day,,350.00,,99650.00";
    const fresh = await importCsv(caller, account.id, csv(other));
    expect(fresh.result).toMatchObject({ totalLines: 1, duplicatesSkipped: 0 });
  });

  it("compares amounts, not strings: 5000 and 5000.00 are the same debit", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv("06/04/2026,CHQ PAID,CHQ0001,5000,,1000.00"));
    const second = await importCsv(caller, account.id, csv("06/04/2026,CHQ PAID,CHQ0001,5000.00,,1000.00"));
    expect(second.result.duplicatesSkipped).toBe(1);

    // A different amount is a different transaction.
    const third = await importCsv(caller, account.id, csv("06/04/2026,CHQ PAID,CHQ0001,5000.01,,1000.00"));
    expect(third.result).toMatchObject({ totalLines: 1, duplicatesSkipped: 0 });
  });

  it("recognizes the same day across date formats (ISO vs DD/MM/YYYY), whatever the server timezone", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    // parseDate() builds ISO dates at UTC midnight but dd/mm/yyyy dates at
    // server-local midnight; both are the same statement day.
    await importCsv(caller, account.id, csv("2026-04-09,IMPS/RENT,IMPS555,15000.00,,5000.00"));
    const second = await importCsv(caller, account.id, csv("09/04/2026,IMPS/RENT,IMPS555,15000.00,,5000.00"));
    expect(second.result).toMatchObject({ totalLines: 0, duplicatesSkipped: 1 });
  });

  it("does not compare against other bank accounts of the same business", async () => {
    const caller = callerForRamesh();
    const accountA = await newAccount(world.business1.id);
    const accountB = await newAccount(world.business1.id);

    await importCsv(caller, accountA.id, csv(L1, L2));
    const onB = await importCsv(caller, accountB.id, csv(L1, L2));
    expect(onB.result).toMatchObject({ totalLines: 2, duplicatesSkipped: 0 });
  });

  it("does not compare against another business", async () => {
    const accountMine = await newAccount(world.business1.id);
    const accountTheirs = await newAccount(world.business2.id);

    await importCsv(callerForRamesh(), accountMine.id, csv(L1, L2));
    const theirs = await importCsv(callerForKiran(), accountTheirs.id, csv(L1, L2));
    expect(theirs.result).toMatchObject({ totalLines: 2, duplicatesSkipped: 0 });
    expect(await linesOf(theirs.importId)).toHaveLength(2);
  });

  it("does not collapse identical lines inside one file", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    const swipe = "07/04/2026,POS PURCHASE Tea Stall,,50.00,,9950.00";
    const first = await importCsv(caller, account.id, csv(swipe, swipe));
    expect(first.result).toMatchObject({ totalLines: 2, duplicatesSkipped: 0 });
  });

  it("matches multiset-style: a statement with one more identical line keeps the extra one", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    const swipe = "08/04/2026,POS PURCHASE Tea Stall,,50.00,,9950.00";
    await importCsv(caller, account.id, csv(swipe)); // 1 occurrence on record
    const second = await importCsv(caller, account.id, csv(swipe, swipe)); // file has 2
    expect(second.result).toMatchObject({ totalLines: 1, duplicatesSkipped: 1 });
  });

  it("imports everything when skipDuplicates is false", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1, L2));
    const forced = await importCsv(caller, account.id, csv(L1, L2), { skipDuplicates: false });
    expect(forced.result).toMatchObject({ totalLines: 2, duplicatesSkipped: 0 });
    expect(await linesOf(forced.importId)).toHaveLength(2);
  });

  it("does not auto-match or count skipped duplicates in the unmatched tally", async () => {
    const caller = callerForRamesh();
    const account = await newAccount(world.business1.id);

    await importCsv(caller, account.id, csv(L1, L2, L3));
    const second = await importCsv(caller, account.id, csv(L1, L2, L3, L4));
    expect(second.result.unmatchedLines).toBe(1);

    const summary = await caller.bankRecon.summary({
      bankAccountId: account.id,
      importId: second.importId,
    });
    // Only L4 (1200.00) is left unmatched in the latest import.
    expect(summary.unmatchedDebits).toBe("1200.00");
  });
});

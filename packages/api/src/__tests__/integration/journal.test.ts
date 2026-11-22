import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, chartOfAccounts, journalEntries, journalEntryLines } from "@hisaabo/db";
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

describe("journal.list line aggregates", () => {
  it("reports lineCount and totalAmount per entry, and 0 / '0' for entries without lines", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();
    const withLines = await caller.journal.create({
      entryDate: new Date().toISOString(),
      narration: "Aggregate check",
      lines: [
        { accountId: cashAccountId, debit: "250.50", credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: "250.50" },
      ],
    });
    const [empty] = await db.insert(journalEntries).values({
      businessId: world.business1.id,
      entryNumber: "JE-EMPTY-1",
      entryDate: new Date(),
      source: "manual",
    }).returning();

    const rows = await caller.journal.list({});
    const a = rows.find((r) => r.id === withLines.id)!;
    const b = rows.find((r) => r.id === empty!.id)!;
    expect(Number(a.lineCount)).toBe(2);
    expect(a.totalAmount).toBe("250.50");
    expect(Number(b.lineCount)).toBe(0);
    expect(b.totalAmount).toBe("0");
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

// `journal.delete` is kept for API compatibility but no longer erases posted
// history: it voids the entry (reversing entry + isVoided flag), like journal.void.
describe("journal.delete (voids instead of erasing)", () => {
  function callerForKiran() {
    return createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name ?? null,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });
  }

  async function postEntry(narration: string, amount = "1000.00") {
    return callerForRamesh().journal.create({
      entryDate: new Date("2026-05-10T00:00:00.000Z").toISOString(),
      narration,
      lines: [
        { accountId: cashAccountId, debit: amount, credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: amount },
      ],
    });
  }

  async function entryRow(id: string) {
    const [row] = await getTenantTestDb().select().from(journalEntries).where(eq(journalEntries.id, id));
    return row;
  }

  async function linesOf(entryId: string) {
    return getTenantTestDb().select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entryId));
  }

  async function auditFor(entryId: string) {
    return getTenantTestDb().select().from(auditLog).where(eq(auditLog.entityId, entryId));
  }

  it("keeps the entry and its lines, flags it voided and posts a reversal", async () => {
    const created = await postEntry("To be deleted");

    const res = await callerForRamesh().journal.delete({ id: created.id });

    // Compatible shape: success stays true; extra fields are additive.
    expect(res.success).toBe(true);
    expect(res).toMatchObject({ voided: true, alreadyVoided: false, entryNumber: created.entryNumber });
    expect(res.reversingEntryId).toBeTruthy();
    expect(res.reversingEntryNumber).toMatch(/^JE-/);

    // Nothing was erased.
    const original = await entryRow(created.id);
    expect(original).toBeDefined();
    expect(original!.isVoided).toBe(true);
    expect(original!.voidedByEntryId).toBe(res.reversingEntryId);
    expect(await linesOf(created.id)).toHaveLength(2);

    // The reversal is a real entry with the debits and credits swapped.
    const reversal = await entryRow(res.reversingEntryId!);
    expect(reversal!.reversesEntryId).toBe(created.id);
    expect(reversal!.narration).toBe(`Void: reversal of ${created.entryNumber}`);
    expect(reversal!.entryDate.toISOString()).toBe(original!.entryDate.toISOString());
    const reversalLines = await linesOf(reversal!.id);
    const cash = reversalLines.find((l) => l.accountId === cashAccountId)!;
    const capital = reversalLines.find((l) => l.accountId === capitalAccountId)!;
    expect(cash).toMatchObject({ debit: "0.00", credit: "1000.00" });
    expect(capital).toMatchObject({ debit: "1000.00", credit: "0.00" });
  });

  it("is the same operation as journal.void (same reversal, same resulting state)", async () => {
    const viaVoid = await postEntry("Voided the normal way", "250.00");
    const viaDelete = await postEntry("Deleted", "250.00");
    const caller = callerForRamesh();

    const v = await caller.journal.void({ id: viaVoid.id });
    const d = await caller.journal.delete({ id: viaDelete.id });

    const [rv, rd] = await Promise.all([entryRow(v.reversingEntry.id), entryRow(d.reversingEntryId!)]);
    expect(rd!.source).toBe(rv!.source);
    expect(rd!.reversesEntryId).toBe(viaDelete.id);
    expect((await entryRow(viaVoid.id))!.isVoided).toBe(true);
    expect((await entryRow(viaDelete.id))!.isVoided).toBe(true);
  });

  it("nets to zero in the ledger: original plus reversal cancel per account", async () => {
    const created = await postEntry("Nets to zero", "777.00");
    const res = await callerForRamesh().journal.delete({ id: created.id });

    const all = [...(await linesOf(created.id)), ...(await linesOf(res.reversingEntryId!))];
    for (const accountId of [cashAccountId, capitalAccountId]) {
      const lines = all.filter((l) => l.accountId === accountId);
      const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
      const credit = lines.reduce((s, l) => s + Number(l.credit), 0);
      expect(debit).toBeCloseTo(credit, 2);
    }
  });

  it("writes an audit_log entry recording that the delete was a void", async () => {
    const created = await postEntry("Audited delete");
    const res = await callerForRamesh().journal.delete({ id: created.id });

    const rows = await auditFor(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: world.business1.id,
      userId: world.ramesh.id,
      action: "journal.void",
      entityType: "journal_entry",
    });
    expect(JSON.parse(rows[0]!.metadata!)).toMatchObject({
      entryNumber: created.entryNumber,
      reversingEntryId: res.reversingEntryId,
      reversingEntryNumber: res.reversingEntryNumber,
      via: "delete",
    });
  });

  it("journal.void writes the same audit entry with via=void", async () => {
    const created = await postEntry("Audited void");
    await callerForRamesh().journal.void({ id: created.id });

    const rows = await auditFor(created.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("journal.void");
    expect(JSON.parse(rows[0]!.metadata!).via).toBe("void");
  });

  it("is a no-op on an entry that is already voided (no second reversal, no extra audit row)", async () => {
    const created = await postEntry("Delete twice");
    const caller = callerForRamesh();
    const first = await caller.journal.delete({ id: created.id });

    const entriesBefore = (await caller.journal.list({})).length;
    const second = await caller.journal.delete({ id: created.id });

    expect(second).toMatchObject({
      success: true,
      voided: false,
      alreadyVoided: true,
      reversingEntryId: first.reversingEntryId,
    });
    expect((await caller.journal.list({})).length).toBe(entriesBefore);
    expect(await auditFor(created.id)).toHaveLength(1);
  });

  it("deleting an entry that journal.void already voided is likewise a no-op", async () => {
    const created = await postEntry("Void then delete");
    const caller = callerForRamesh();
    const v = await caller.journal.void({ id: created.id });

    const res = await caller.journal.delete({ id: created.id });
    expect(res).toMatchObject({ success: true, alreadyVoided: true, reversingEntryId: v.reversingEntry.id });
  });

  it("refuses to delete a reversal entry (that would silently reinstate the original)", async () => {
    const created = await postEntry("Has a reversal");
    const caller = callerForRamesh();
    const res = await caller.journal.delete({ id: created.id });

    await expect(caller.journal.delete({ id: res.reversingEntryId! })).rejects.toThrow(/reversal of another journal entry/);

    // Both sides are still on record, untouched.
    expect((await entryRow(res.reversingEntryId!))!.isVoided).toBe(false);
    expect((await entryRow(created.id))!.isVoided).toBe(true);
  });

  it("journal.void refuses a reversal entry too, and leaves the ledger as it was", async () => {
    const created = await postEntry("Void a reversal");
    const caller = callerForRamesh();
    const first = await caller.journal.void({ id: created.id });
    const reversalId = first.reversingEntry.id;

    await expect(caller.journal.void({ id: reversalId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/reversal of another journal entry.*cannot be voided or deleted/),
    });

    // No second-level reversal was posted: the original is still reversed exactly once,
    // and the reversal is neither voided nor reversed itself.
    const db = getTenantTestDb();
    expect(await db.select().from(journalEntries).where(eq(journalEntries.reversesEntryId, reversalId))).toHaveLength(0);
    expect(await db.select().from(journalEntries).where(eq(journalEntries.reversesEntryId, created.id))).toHaveLength(1);
    expect((await entryRow(reversalId))!.isVoided).toBe(false);
    expect((await entryRow(created.id))!.isVoided).toBe(true);
  });

  it("refuses a reversal entry on both paths, whichever way the original was voided", async () => {
    const created = await postEntry("Voided via delete");
    const caller = callerForRamesh();
    const res = await caller.journal.delete({ id: created.id });

    await expect(caller.journal.void({ id: res.reversingEntryId! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.journal.delete({ id: res.reversingEntryId! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("two concurrent deletes of one entry produce exactly one reversal", async () => {
    const created = await postEntry("Race");
    const caller = callerForRamesh();

    const results = await Promise.all([
      caller.journal.delete({ id: created.id }),
      caller.journal.delete({ id: created.id }),
    ]);

    expect(results.filter((r) => r.voided)).toHaveLength(1);
    expect(results.filter((r) => r.alreadyVoided)).toHaveLength(1);
    const db = getTenantTestDb();
    const reversals = await db.select().from(journalEntries).where(eq(journalEntries.reversesEntryId, created.id));
    expect(reversals).toHaveLength(1);
  });

  it("can void an entry that has no lines (nothing to reverse)", async () => {
    const db = getTenantTestDb();
    const [empty] = await db
      .insert(journalEntries)
      .values({
        businessId: world.business1.id,
        entryNumber: "JE-EMPTY-001",
        entryDate: new Date("2026-05-11T00:00:00.000Z"),
        narration: "No lines",
        source: "manual",
      })
      .returning();

    const res = await callerForRamesh().journal.delete({ id: empty!.id });
    expect(res.voided).toBe(true);
    expect((await entryRow(empty!.id))!.isVoided).toBe(true);
  });

  it("returns NOT_FOUND for an unknown id and for another business's entry", async () => {
    const created = await postEntry("Mine");

    await expect(
      callerForRamesh().journal.delete({ id: "00000000-0000-4000-8000-0000000000aa" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(callerForKiran().journal.delete({ id: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await entryRow(created.id))!.isVoided).toBe(false);
  });

  it("is not available to non-admin roles", async () => {
    const created = await postEntry("Seller cannot delete");
    const seller = createTestCaller({
      userId: world.suresh.id,
      email: world.suresh.email,
      name: world.suresh.name ?? null,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
    await expect(seller.journal.delete({ id: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await entryRow(created.id))!.isVoided).toBe(false);
  });
});

// journal.update used to check isVoided OUTSIDE its transaction with no row lock, so an
// update could replace the lines of an entry a concurrent void had just reversed.
describe("journal.update vs journal.void concurrency", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function linesOf(entryId: string) {
    return getTenantTestDb().select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entryId));
  }

  async function postEntry(narration: string, amount = "500.00") {
    return callerForRamesh().journal.create({
      entryDate: new Date("2026-06-10T00:00:00.000Z").toISOString(),
      narration,
      lines: [
        { accountId: cashAccountId, debit: amount, credit: "0" },
        { accountId: capitalAccountId, debit: "0", credit: amount },
      ],
    });
  }

  it("an update that starts while the entry is locked waits for it and is then refused if it was voided", async () => {
    const created = await postEntry("Locked, then voided");
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    let update!: Promise<unknown>;
    let settledWhileLocked = true;
    await db.transaction(async (tx) => {
      // Stand in for a void that is mid-flight: it holds the entry's row lock.
      await tx.select().from(journalEntries).where(eq(journalEntries.id, created.id)).for("update");

      update = caller.journal.update({ id: created.id, narration: "late edit" }).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      // The update must be waiting on the lock, not already decided from a stale read.
      await sleep(300);
      settledWhileLocked = await Promise.race([update.then(() => true), sleep(100).then(() => false)]);

      // The "void" commits.
      await tx.update(journalEntries).set({ isVoided: true }).where(eq(journalEntries.id, created.id));
    });

    expect(settledWhileLocked).toBe(false);
    const outcome = (await update) as { ok: boolean; error?: { code?: string; message?: string } };
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatchObject({ code: "BAD_REQUEST", message: "Cannot update a voided journal entry" });

    const [row] = await db.select().from(journalEntries).where(eq(journalEntries.id, created.id));
    expect(row!.narration).toBe("Locked, then voided"); // the late edit was not applied
  });

  it("an update and a void racing on one entry leave the original and its reversal in agreement", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    for (let i = 0; i < 8; i++) {
      const created = await postEntry(`Race ${i}`, "500.00");

      const [updateResult] = await Promise.allSettled([
        caller.journal.update({
          id: created.id,
          lines: [
            { accountId: cashAccountId, debit: "900.00", credit: "0" },
            { accountId: capitalAccountId, debit: "0", credit: "900.00" },
          ],
        }),
        caller.journal.void({ id: created.id }),
      ]);

      const original = (await db.select().from(journalEntries).where(eq(journalEntries.id, created.id)))[0]!;
      expect(original.isVoided).toBe(true);

      // Whatever order they ran in, the reversal mirrors the original's FINAL lines,
      // so the pair nets to zero in every account.
      const [reversal] = await db.select().from(journalEntries).where(eq(journalEntries.reversesEntryId, created.id));
      const lines = [...(await linesOf(created.id)), ...(await linesOf(reversal!.id))];
      for (const accountId of [cashAccountId, capitalAccountId]) {
        const mine = lines.filter((l) => l.accountId === accountId);
        const debit = mine.reduce((s, l) => s + Number(l.debit), 0);
        const credit = mine.reduce((s, l) => s + Number(l.credit), 0);
        expect(debit).toBeCloseTo(credit, 2);
      }

      // And an update that lost the race says why.
      if (updateResult.status === "rejected") {
        expect(String(updateResult.reason.message)).toBe("Cannot update a voided journal entry");
      }
    }
  });
});

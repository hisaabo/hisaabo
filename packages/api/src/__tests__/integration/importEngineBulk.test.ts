/**
 * importEngineBulk.test.ts — set-based (non-N+1) write paths in the importers
 * and recompute helpers. Verifies end state is identical to the per-row logic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { bankAccounts, bankTransactions, invoices, items } from "@hisaabo/db";
import { createTestWorld, createInvoiceWithItems, type TestWorld } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runTransfersImport } from "../../routers/import/engine/transfers.js";
import { runPaymentsImport } from "../../routers/import/engine/payments.js";
import { runInvoicesImport } from "../../routers/import/engine/invoices.js";
import { recomputeAmountPaid, recomputeBankBalances } from "../../lib/recomputeDerived.js";

let world: TestWorld;
beforeAll(async () => {
  await truncateAllTables();
  world = await createTestWorld();
});
afterAll(async () => {
  await closeTestDb();
});

describe("transfers import", () => {
  it("writes both legs for many rows and nets balances per account", async () => {
    const db = world.tenantDb;
    const bid = world.business1.id;
    const d = new Date("2025-01-01");
    const res = await runTransfersImport(db as never, bid, world.ramesh.id, "test", [
      { date: d, amount: "100.50", fromMode: "cash", toMode: "bank" },
      { date: d, amount: "50.25", fromMode: "cash", toMode: "bank", notes: "n1" },
      { date: d, amount: "10.00", fromMode: "bank", toMode: "upi" },
      { date: d, amount: "5.00", fromMode: "cash", toMode: "cash" }, // invalid
    ]);
    expect(res.created).toBe(3);
    expect(res.total).toBe(4);
    expect(res.errors).toHaveLength(1);

    const accts = await db.select().from(bankAccounts).where(eq(bankAccounts.businessId, bid));
    const bal = (t: string) => accts.find((a) => a.accountType === t)!.currentBalance;
    expect(bal("cash")).toBe("-150.75");
    expect(bal("savings")).toBe("140.75");
    expect(bal("upi")).toBe("10.00");

    const txns = await db.select().from(bankTransactions).where(eq(bankTransactions.businessId, bid));
    expect(txns).toHaveLength(6);
    expect(txns.filter((t) => t.type === "withdrawal")).toHaveLength(3);
    expect(txns.find((t) => t.description === "n1")).toBeTruthy();
  });
});

describe("invoice + payment import", () => {
  it("applies stock deltas and payment status updates set-based", async () => {
    const db = world.tenantDb;
    const bid = world.business1.id;
    const user = { id: world.ramesh.id, name: "Ramesh" };
    const base = {
      invoiceDate: new Date("2025-02-01"),
      partyName: world.party1.name,
      status: "sent" as const,
      subtotal: "100", taxAmount: "0", discountAmount: "0", totalAmount: "100", amountPaid: "0",
    };
    const line = (q: string) => [
      { itemName: world.item1.name, quantity: q, unitPrice: "10", taxPercent: "0", discountPercent: "0" },
    ];
    const inv = await runInvoicesImport(db as never, bid, user, "test", [
      { ...base, invoiceNumber: "S1", type: "sale", lineItems: line("3") },
      { ...base, invoiceNumber: "S2", type: "sale", lineItems: line("2.5") },
      { ...base, invoiceNumber: "P1", type: "purchase", lineItems: line("10") },
    ], { autoCreatePayments: false, defaultPaymentMode: "cash" });
    expect(inv.created).toBe(3);
    const [it1] = await db.select().from(items).where(eq(items.id, world.item1.id));
    expect(it1!.stockQuantity).toBe("104.500"); // 100 - 3 - 2.5 + 10

    const pay = await runPaymentsImport(db as never, bid, user, "test", [
      { paymentDate: new Date("2025-02-02"), partyName: world.party1.name, amount: "100", mode: "cash", invoiceNumbers: ["S1"] },
      { paymentDate: new Date("2025-02-03"), partyName: world.party1.name, amount: "30", mode: "cash", invoiceNumbers: ["S2"] },
    ], []);
    expect(pay.created).toBe(2);
    const rows = await db.select().from(invoices).where(eq(invoices.businessId, bid));
    const by = (n: string) => rows.find((r) => r.invoiceNumber === n)!;
    expect(by("S1")).toMatchObject({ status: "paid", amountPaid: "100.00" });
    expect(by("S2")).toMatchObject({ status: "partial", amountPaid: "30.00" });
    expect(by("P1")).toMatchObject({ status: "sent", amountPaid: "0.00" });
  });
});

describe("recompute drift-only writes", () => {
  it("fixes drifted rows, leaves correct rows untouched, still warns", async () => {
    const db = world.tenantDb;
    const bid = world.business1.id;
    const { invoice: ok } = await createInvoiceWithItems(db, bid, world.party1.id, [], { amountPaid: "0.00" });
    const { invoice: bad } = await createInvoiceWithItems(db, bid, world.party1.id, [], { amountPaid: "77.00" });
    const before = (await db.select().from(invoices).where(eq(invoices.id, ok.id)))[0]!.updatedAt;

    const r = await recomputeAmountPaid(db as never, [bid]);
    expect(r.warnings.some((w) => w.entityId === bad.id && w.computed === "0.00")).toBe(true);
    const after = (await db.select().from(invoices).where(eq(invoices.id, bad.id)))[0]!;
    expect(after.amountPaid).toBe("0.00");
    const okAfter = (await db.select().from(invoices).where(eq(invoices.id, ok.id)))[0]!;
    expect(okAfter.updatedAt.getTime()).toBe(before.getTime());

    await db.update(bankAccounts).set({ currentBalance: "999.00" }).where(eq(bankAccounts.businessId, bid));
    const b = await recomputeBankBalances(db as never, [bid]);
    expect(b.warnings.length).toBeGreaterThan(0);
    const accts = await db.select().from(bankAccounts).where(eq(bankAccounts.businessId, bid));
    expect(accts.find((a) => a.accountType === "cash")!.currentBalance).toBe("-150.75");
  });
});

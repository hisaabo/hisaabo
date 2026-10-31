import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { invoices, paymentAllocations, tdsSectionConfigs } from "@hisaabo/db";
import { getTdsTaxCode, money } from "@hisaabo/shared";
import { createParty, createTestWorld, type TestWorld } from "./helpers/fixtures.js";
import { createTestCaller } from "./helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { seedChartOfAccounts } from "../lib/coa-seed.js";
import { deriveLedger } from "../lib/derive-ledger.js";

let world: TestWorld;
const db = getTenantTestDb();

beforeAll(async () => {
  world = await createTestWorld();
  await seedChartOfAccounts(db, world.business1.id);
  await db.insert(tdsSectionConfigs).values({
    businessId: world.business1.id,
    sectionCode: "1001",
    sectionLabel: "Test current TDS section",
    effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
    status: "active",
    version: 1,
  });
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

describe("TDS payment allocation", () => {
  it("stores the registry label instead of a caller-supplied label", async () => {
    const config = await caller().tdsSection.create({
      sectionCode: "1001",
      sectionLabel: "Incorrect caller label",
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      status: "active",
      version: 2,
    });

    expect(config.sectionLabel).toBe(getTdsTaxCode("1001")?.label);
  });

  it("settles gross invoice amount and derives balanced cash/TDS/receivable lines", async () => {
    const invoice = await caller().invoice.create({
      type: "sale",
      partyId: world.party1.id,
      lineItems: [{
        itemId: world.item1.id,
        itemName: "TDS test item",
        quantity: "1",
        unitPrice: "100000.00",
        taxPercent: "0",
        discountPercent: "0",
        conversionFactor: "1",
      }],
    });

    const payment = await caller().payment.create({
      partyId: world.party1.id,
      amount: "98000.00",
      mode: "bank",
      paymentDate: "2026-10-12T00:00:00.000Z",
      allocations: [{
        invoiceId: invoice.id,
        amount: "100000.00",
        tdsAmount: "2000.00",
        tdsSectionCode: "1001",
        tdsRate: "2.00",
      }],
    });

    const [settled] = await db.select({
      amountPaid: invoices.amountPaid,
      totalAmount: invoices.totalAmount,
    }).from(invoices).where(eq(invoices.id, invoice.id));
    expect(settled?.totalAmount).toBe("100000.00");
    expect(settled?.amountPaid).toBe("100000.00");

    const [allocation] = await db.select({
      amount: paymentAllocations.amount,
      tdsAmount: paymentAllocations.tdsAmount,
    }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id));
    expect(allocation).toEqual({ amount: "100000.00", tdsAmount: "2000.00" });

    const [entry] = (await deriveLedger(
      db,
      world.business1.id,
      new Date("2026-01-01"),
      new Date("2026-12-31"),
    )).filter((candidate) => candidate.sourceId === payment.id);
    expect(entry).toBeDefined();
    expect(entry!.lines.find((line) => line.accountCode === "1010")?.debit).toBe("98000.00");
    expect(entry!.lines.find((line) => line.accountCode === "1600")?.debit).toBe("2000.00");
    expect(entry!.lines.find((line) => line.accountCode === "1100")?.credit).toBe("100000.00");
    expect(money.sum(entry!.lines.map((line) => line.debit))).toBe(
      money.sum(entry!.lines.map((line) => line.credit)),
    );

    await expect(caller().payment.update({
      id: payment.id,
      amount: "97000.00",
    })).rejects.toThrow("Allocations are required when changing the payment amount");

    await caller().payment.update({
      id: payment.id,
      amount: "50000.00",
      allocations: [{
        invoiceId: invoice.id,
        amount: "50000.00",
      }],
    });

    const [replaced] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(replaced?.amountPaid).toBe("50000.00");

    await caller().payment.update({
      id: payment.id,
      allocations: [],
    });

    const [cleared] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(cleared?.amountPaid).toBe("0.00");
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id))).toHaveLength(0);

    await caller().payment.delete({ id: payment.id });
    const [reversed] = await db.select({ amountPaid: invoices.amountPaid })
      .from(invoices).where(and(eq(invoices.id, invoice.id), eq(invoices.businessId, world.business1.id)));
    expect(reversed?.amountPaid).toBe("0.00");
  });

  it("rejects adding TDS to a supplier payment during update", async () => {
    const supplier = await createParty(db, world.business1.id, {
      name: "TDS Supplier",
      type: "supplier",
    });
    const invoice = await caller().invoice.create({
      type: "purchase",
      partyId: supplier.id,
      lineItems: [{
        itemId: world.item1.id,
        itemName: "TDS supplier item",
        quantity: "1",
        unitPrice: "100000.00",
        taxPercent: "0",
        discountPercent: "0",
        conversionFactor: "1",
      }],
    });
    const payment = await caller().payment.create({
      partyId: supplier.id,
      amount: "100000.00",
      mode: "bank",
      allocations: [{ invoiceId: invoice.id, amount: "100000.00" }],
    });

    await expect(caller().payment.update({
      id: payment.id,
      amount: "98000.00",
      allocations: [{
        invoiceId: invoice.id,
        amount: "100000.00",
        tdsAmount: "2000.00",
        tdsSectionCode: "1001",
        tdsRate: "2.00",
      }],
    })).rejects.toThrow("TDS is supported only for customer receipts");
  });
});

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { chartOfAccounts, invoices, payments, paymentAllocations, tdsSectionConfigs, type TenantDatabase } from "@hisaabo/db";
import { getTdsTaxCode, money } from "@hisaabo/shared";
import {
  createBusiness,
  createItem,
  createParty,
  createTestWorld,
  type TestWorld,
} from "./helpers/fixtures.js";
import { createTestCaller } from "./helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { seedChartOfAccounts } from "../lib/coa-seed.js";
import { deriveLedger } from "../lib/derive-ledger.js";
import { buildPartyLedgerStatement } from "../lib/party-ledger.js";

/**
 * Receivable-side TDS, end to end against Postgres.
 *
 * Section 1024 ("Contract payment - contractor is other than individual or
 * HUF") is the code used throughout: it is a plausible deduction on a
 * customer's receipt, unlike 1001 (salary).
 */

let world: TestWorld;
const db = getTenantTestDb();

const SECTION = "1024";
const INVOICE_DATE = "2026-10-01T00:00:00.000Z";
const PAY_DATE = "2026-10-12T00:00:00.000Z";
const RANGE_FROM = new Date("2026-01-01");
const RANGE_TO = new Date("2026-12-31");

beforeAll(async () => {
  world = await createTestWorld();
  await seedChartOfAccounts(db, world.business1.id);
  await db.insert(tdsSectionConfigs).values({
    businessId: world.business1.id,
    sectionCode: SECTION,
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

function callerFor(user: { id: string; email: string; name: string | null }, businessId = world.business1.id) {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name,
    tenantId: world.tenant1.id,
    businessId,
  });
}

/** Owner of tenant1. */
function caller(businessId = world.business1.id) {
  return callerFor(world.ramesh, businessId);
}

/** Seller in tenant1 (cannot manage the business). */
function sellerCaller() {
  return callerFor(world.suresh);
}

async function saleInvoice(
  c: ReturnType<typeof caller>,
  partyId: string,
  itemId: string,
  unitPrice: string,
  taxPercent = "0",
) {
  return c.invoice.create({
    type: "sale",
    partyId,
    invoiceDate: INVOICE_DATE,
    lineItems: [{
      itemId,
      itemName: "TDS test item",
      quantity: "1",
      unitPrice,
      taxPercent,
      discountPercent: "0",
      conversionFactor: "1",
    }],
  });
}

async function ledgerEntryFor(businessId: string, sourceId: string) {
  const entries = await deriveLedger(db, businessId, RANGE_FROM, RANGE_TO);
  return entries.find((entry) => entry.sourceId === sourceId);
}

function lineFor(entry: NonNullable<Awaited<ReturnType<typeof ledgerEntryFor>>>, code: string) {
  return entry.lines.find((line) => line.accountCode === code);
}

describe("TDS payment allocation", () => {
  it("stores the registry label instead of a caller-supplied label", async () => {
    const config = await caller().tdsSection.create({
      sectionCode: SECTION,
      sectionLabel: "Incorrect caller label",
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      status: "active",
      version: 2,
    });

    expect(config.sectionLabel).toBe(getTdsTaxCode(SECTION)?.label);
  });

  it("settles gross invoice amount and derives balanced cash/TDS/receivable lines", async () => {
    const invoice = await saleInvoice(caller(), world.party1.id, world.item1.id, "100000.00");

    const payment = await caller().payment.create({
      partyId: world.party1.id,
      amount: "98000.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{
        invoiceId: invoice.id,
        amount: "100000.00",
        tdsAmount: "2000.00",
        tdsSectionCode: SECTION,
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

    const entry = await ledgerEntryFor(world.business1.id, payment.id);
    expect(entry).toBeDefined();
    expect(lineFor(entry!, "1010")?.debit).toBe("98000.00");
    expect(lineFor(entry!, "1600")?.debit).toBe("2000.00");
    expect(lineFor(entry!, "1100")?.credit).toBe("100000.00");
    expect(money.sum(entry!.lines.map((line) => line.debit))).toBe(
      money.sum(entry!.lines.map((line) => line.credit)),
    );

    // Changing the cash amount of a TDS receipt without re-allocating is refused,
    // with a message that tells the (mobile / CLI / MCP) user what to do instead.
    await expect(caller().payment.update({
      id: payment.id,
      amount: "97000.00",
    })).rejects.toThrow(/Allocations are required when changing the payment amount.*web app/);

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

    // `[]` is the explicit "clear every allocation" signal (the web edit panel
    // sends it when all invoices are unchecked).
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

  it("validates bounds only: a deduction that is not rate x gross is accepted", async () => {
    const invoice = await saleInvoice(caller(), world.party1.id, world.item1.id, "100000.00");

    // 9,999 withheld while quoting 1%: the amount is not second-guessed.
    const payment = await caller().payment.create({
      partyId: world.party1.id,
      amount: "90001.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{
        invoiceId: invoice.id,
        amount: "100000.00",
        tdsAmount: "9999.00",
        tdsSectionCode: SECTION,
        tdsRate: "1.00",
      }],
    });
    expect(payment.id).toBeTruthy();

    // ...but it can still never exceed the gross allocation, and a rate is mandatory.
    const other = await saleInvoice(caller(), world.party1.id, world.item1.id, "1000.00");
    await expect(caller().payment.create({
      partyId: world.party1.id,
      amount: "1.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{ invoiceId: other.id, amount: "1000.00", tdsAmount: "999.00", tdsSectionCode: SECTION }],
    })).rejects.toThrow();
    await expect(caller().payment.update({
      id: payment.id,
      amount: "100.00",
      allocations: [{
        invoiceId: invoice.id,
        amount: "100000.00",
        tdsAmount: "100001.00",
        tdsSectionCode: SECTION,
        tdsRate: "1.00",
      }],
    })).rejects.toThrow();
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
        tdsSectionCode: SECTION,
        tdsRate: "2.00",
      }],
    })).rejects.toThrow("TDS is supported only for customer receipts");
  });

  it("keeps a TDS receipt editable after its section is later deactivated", async () => {
    const party = await createParty(db, world.business1.id, { name: "Carry-over TDS Customer" });
    const invoice = await saleInvoice(caller(), party.id, world.item1.id, "5000.00");
    const payment = await caller().payment.create({
      partyId: party.id,
      amount: "4500.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "5000.00", tdsAmount: "500.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
    });

    await db.update(tdsSectionConfigs)
      .set({ status: "inactive" })
      .where(and(eq(tdsSectionConfigs.businessId, world.business1.id), eq(tdsSectionConfigs.sectionCode, SECTION)));
    try {
      // A notes-only edit re-applies the stored allocation without re-validating the section.
      await caller().payment.update({ id: payment.id, notes: "edited after deactivation" });
      const [alloc] = await db.select({ tdsAmount: paymentAllocations.tdsAmount })
        .from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id));
      expect(alloc?.tdsAmount).toBe("500.00");

      // A NEW receipt against a deactivated section is still refused.
      const other = await saleInvoice(caller(), party.id, world.item1.id, "100.00");
      await expect(caller().payment.create({
        partyId: party.id,
        amount: "90.00",
        mode: "bank",
        paymentDate: PAY_DATE,
        allocations: [{ invoiceId: other.id, amount: "100.00", tdsAmount: "10.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
      })).rejects.toThrow("TDS section is not active");
    } finally {
      await db.update(tdsSectionConfigs)
        .set({ status: "active" })
        .where(and(eq(tdsSectionConfigs.businessId, world.business1.id), eq(tdsSectionConfigs.sectionCode, SECTION)));
    }
  });
});

describe("TDS on a GST invoice (deducted on the taxable value)", () => {
  let party: Awaited<ReturnType<typeof createParty>>;
  let invoiceId: string;
  let paymentId: string;
  let paymentNumber: string;

  beforeAll(async () => {
    party = await createParty(db, world.business1.id, { name: "GST TDS Customer", openingBalance: "0.00" });
    const invoice = await saleInvoice(caller(), party.id, world.item1.id, "10000.00", "18");
    expect(invoice.totalAmount).toBe("11800.00");
    expect(invoice.taxAmount).toBe("1800.00");
    invoiceId = invoice.id;

    // 10% TDS on the 10,000 taxable value = 1,000. 10% of the 11,800 gross would
    // be 1,180, so a rate x gross equality check would wrongly reject this receipt.
    const payment = await caller().payment.create({
      partyId: party.id,
      amount: "10800.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{
        invoiceId,
        amount: "11800.00",
        tdsAmount: "1000.00",
        tdsSectionCode: SECTION,
        tdsRate: "10.00",
      }],
    });
    paymentId = payment.id;
    paymentNumber = payment.paymentNumber!;
  });

  it("marks the invoice paid and derives Dr cash + Dr TDS Receivable / Cr Receivable", async () => {
    const [row] = await db.select({ amountPaid: invoices.amountPaid, status: invoices.status })
      .from(invoices).where(eq(invoices.id, invoiceId));
    expect(row).toEqual({ amountPaid: "11800.00", status: "paid" });

    const entry = await ledgerEntryFor(world.business1.id, paymentId);
    expect(lineFor(entry!, "1010")?.debit).toBe("10800.00");
    expect(lineFor(entry!, "1600")?.debit).toBe("1000.00");
    expect(lineFor(entry!, "1100")?.credit).toBe("11800.00");
  });

  it("party.ledgerReport closes at 0 and exposes the TDS separately", async () => {
    const report = await caller().party.ledgerReport({ partyId: party.id });
    expect(report).not.toBeNull();
    expect(report!.summary.closingBalance).toBe("0.00");
    expect(report!.summary.totalDebit).toBe("11800.00");
    expect(report!.summary.totalCredit).toBe("11800.00");
    const receipt = report!.entries.find((e) => e.type === "payment");
    expect(receipt).toMatchObject({ credit: "11800.00", tdsAmount: "1000.00" });
    expect(receipt!.description).toContain("incl. TDS");
  });

  it("party.ledgerReportCSV's last running balance is 0", async () => {
    const result = await caller().party.ledgerReportCSV({ partyId: party.id });
    expect(result).not.toBeNull();
    const lines = result!.csv.split("\n");
    const last = lines[lines.length - 1]!.split(",");
    expect(money.compare(last[last.length - 1]!, "0")).toBe(0);
    expect(lines.some((line) => line.includes("incl. TDS") && line.includes("11800.00"))).toBe(true);
  });

  it("party.ledger (paged running balance) ends at 0", async () => {
    const ledger = await caller().party.ledger({ partyId: party.id, page: 1, limit: 50 });
    const payment = ledger.data.find((row) => row.type === "payment");
    expect(money.compare(payment!.credit, "11800.00")).toBe(0);
    expect(money.compare(ledger.data[ledger.data.length - 1]!.runningBalance, "0")).toBe(0);
  });

  it("reports.partyStatement closes at 0", async () => {
    const statement = await caller().reports.partyStatement({ partyId: party.id });
    expect(statement!.summary.closingBalance).toBe("0.00");
    expect(statement!.summary.isDebit).toBe(true);
  });

  it("the ledger PDF statement (and its UPI QR amount) closes at 0", async () => {
    const statement = await buildPartyLedgerStatement(
      db as unknown as TenantDatabase, // the test db's schema subset omits some tenant tables
      world.business1.id,
      { id: party.id, type: party.type, openingBalance: party.openingBalance },
    );
    expect(statement.summary.closingBalance).toBe("0.00");
    expect(statement.entries.map((e) => e.runningBalance)).toEqual(["11800.00", "0.00"]);
  });

  it("party.tallyExport emits the TDS as a second Receipt leg to TDS Receivable", async () => {
    const tally = await caller().party.tallyExport({});
    const legs = tally.csv.split("\n").filter((line) => line.includes(paymentNumber));
    expect(legs).toHaveLength(2);
    expect(legs[0]).toContain("10800.00");
    expect(legs[1]).toContain("TDS Receivable");
    expect(legs[1]).toContain("1000.00");
  });

  it("collected (settled) matches invoiced in the sales trend, with cash reported apart", async () => {
    const trend = await caller().dashboard.salesTrend({ months: 24, granularity: "month" });
    const settled = money.sum(trend.map((row) => row.collected));
    const cash = money.sum(trend.map((row) => row.cashCollected));
    // At least this receipt's 1,000 of TDS is counted as settled but is not cash.
    expect(money.compare(money.sub(settled, cash), "1000.00")).toBeGreaterThanOrEqual(0);
  });
});

describe("multi-invoice TDS receipt", () => {
  it("balances the party ledger and the derived journal entry", async () => {
    const party = await createParty(db, world.business1.id, { name: "Multi-invoice TDS Customer" });
    const first = await saleInvoice(caller(), party.id, world.item1.id, "6000.00", "18"); // 7,080
    const second = await saleInvoice(caller(), party.id, world.item1.id, "4000.00", "18"); // 4,720

    const payment = await caller().payment.create({
      partyId: party.id,
      amount: "10800.00", // 11,800 gross - 1,000 TDS
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [
        { invoiceId: first.id, amount: "7080.00", tdsAmount: "600.00", tdsSectionCode: SECTION, tdsRate: "10.00" },
        { invoiceId: second.id, amount: "4720.00", tdsAmount: "400.00", tdsSectionCode: SECTION, tdsRate: "10.00" },
      ],
    });

    for (const id of [first.id, second.id]) {
      const [row] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id));
      expect(row?.status).toBe("paid");
    }

    const entry = await ledgerEntryFor(world.business1.id, payment.id);
    expect(lineFor(entry!, "1010")?.debit).toBe("10800.00");
    expect(lineFor(entry!, "1600")?.debit).toBe("1000.00");
    expect(lineFor(entry!, "1100")?.credit).toBe("11800.00");

    const report = await caller().party.ledgerReport({ partyId: party.id });
    expect(report!.summary.closingBalance).toBe("0.00");
    const receipts = report!.entries.filter((e) => e.type === "payment");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.tdsAmount).toBe("1000.00");

    // A mismatch between gross and net + TDS is still refused.
    const third = await saleInvoice(caller(), party.id, world.item1.id, "1000.00");
    await expect(caller().payment.create({
      partyId: party.id,
      amount: "900.00",
      mode: "bank",
      paymentDate: PAY_DATE,
      allocations: [{ invoiceId: third.id, amount: "1000.00", tdsAmount: "50.00", tdsSectionCode: SECTION, tdsRate: "5.00" }],
    })).rejects.toThrow("Gross allocations must equal net payment plus TDS");
  });
});

describe("section effective dates use the business-local (IST) date", () => {
  it("accepts a receipt dated 1 Apr 2026 IST and rejects 31 Mar 2026 IST", async () => {
    const party = await createParty(db, world.business1.id, { name: "IST Boundary Customer" });
    const a = await saleInvoice(caller(), party.id, world.item1.id, "1000.00");
    const b = await saleInvoice(caller(), party.id, world.item1.id, "1000.00");
    const alloc = (invoiceId: string) => [{
      invoiceId, amount: "1000.00", tdsAmount: "100.00", tdsSectionCode: SECTION, tdsRate: "10.00",
    }];

    // 00:00 IST on 1 Apr 2026 == 2026-03-31T18:30:00Z, i.e. before 2026-04-01T00:00Z.
    const ok = await caller().payment.create({
      partyId: party.id, amount: "900.00", mode: "bank",
      paymentDate: "2026-03-31T18:30:00.000Z", allocations: alloc(a.id),
    });
    expect(ok.id).toBeTruthy();

    await expect(caller().payment.create({
      partyId: party.id, amount: "900.00", mode: "bank",
      paymentDate: "2026-03-31T18:29:00.000Z", allocations: alloc(b.id),
    })).rejects.toThrow("TDS section is not active");
  });
});

describe("TDS Receivable (1600) account handling", () => {
  async function businessWithoutTdsAccount(name: string) {
    const biz = await createBusiness(db, world.ramesh.id, { name });
    await seedChartOfAccounts(db, biz.id);
    await db.delete(chartOfAccounts).where(and(
      eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "1600"),
    ));
    const party = await createParty(db, biz.id, { name: `${name} Customer` });
    const item = await createItem(db, biz.id, { name: `${name} Item` });
    return { biz, party, item, c: caller(biz.id) };
  }

  it("derives the ledger for a business that lacks 1600 as long as no payment carries TDS", async () => {
    const { biz, party, item, c } = await businessWithoutTdsAccount("No TDS Account Co");
    const invoice = await saleInvoice(c, party.id, item.id, "1000.00");
    const payment = await c.payment.create({
      partyId: party.id, amount: "1000.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
    });

    const entry = await ledgerEntryFor(biz.id, payment.id);
    expect(entry).toBeDefined();
    expect(lineFor(entry!, "1600")).toBeUndefined();
    expect(money.sum(entry!.lines.map((l) => l.debit))).toBe(money.sum(entry!.lines.map((l) => l.credit)));
  });

  it("creates the system 1600 account (and seeds sections) on the first TDS receipt", async () => {
    const { biz, party, item, c } = await businessWithoutTdsAccount("First TDS Co");
    // No section rows yet: tdsSection.list shows registry defaults without writing...
    const listed = await c.tdsSection.list();
    expect(listed.length).toBeGreaterThan(30);
    expect(await db.select().from(tdsSectionConfigs).where(eq(tdsSectionConfigs.businessId, biz.id))).toHaveLength(0);

    const invoice = await saleInvoice(c, party.id, item.id, "1000.00");
    const payment = await c.payment.create({
      partyId: party.id, amount: "900.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00", tdsAmount: "100.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
    });

    // ...and the receipt is what persists them.
    expect((await db.select().from(tdsSectionConfigs).where(eq(tdsSectionConfigs.businessId, biz.id))).length).toBeGreaterThan(30);
    const [account] = await db.select().from(chartOfAccounts).where(and(
      eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "1600"),
    ));
    expect(account).toMatchObject({ isSystem: true, isActive: true, accountType: "asset" });

    const entry = await ledgerEntryFor(biz.id, payment.id);
    expect(lineFor(entry!, "1600")?.debit).toBe("100.00");
  });

  it("reactivates a deactivated system 1600 on the next TDS receipt", async () => {
    const { biz, party, item, c } = await businessWithoutTdsAccount("Reactivate Co");
    await db.insert(chartOfAccounts).values({
      businessId: biz.id, code: "1600", name: "TDS Receivable", accountType: "asset", isSystem: true, isActive: false,
    });
    const invoice = await saleInvoice(c, party.id, item.id, "1000.00");
    const payment = await c.payment.create({
      partyId: party.id, amount: "900.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00", tdsAmount: "100.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
    });
    expect(payment.id).toBeTruthy();
    const [account] = await db.select().from(chartOfAccounts).where(and(
      eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "1600"),
    ));
    expect(account?.isActive).toBe(true);
  });

  it("rejects TDS when 1600 is a user-created account, writing nothing", async () => {
    const { biz, party, item, c } = await businessWithoutTdsAccount("Custom 1600 Co");
    await db.insert(chartOfAccounts).values({
      businessId: biz.id, code: "1600", name: "Staff Advances", accountType: "asset", isSystem: false, isActive: true,
    });
    const invoice = await saleInvoice(c, party.id, item.id, "1000.00");

    await expect(c.payment.create({
      partyId: party.id, amount: "900.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00", tdsAmount: "100.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Staff Advances") });

    expect(await db.select().from(payments).where(eq(payments.partyId, party.id))).toHaveLength(0);
    const [row] = await db.select({ amountPaid: invoices.amountPaid }).from(invoices).where(eq(invoices.id, invoice.id));
    expect(row?.amountPaid).toBe("0.00");
    // A receipt without TDS is unaffected.
    await expect(c.payment.create({
      partyId: party.id, amount: "1000.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00" }],
    })).resolves.toBeTruthy();
  });

  it("never lets the derived ledger post TDS into a non-system 1600", async () => {
    const { biz, party, item, c } = await businessWithoutTdsAccount("Hijacked 1600 Co");
    const invoice = await saleInvoice(c, party.id, item.id, "1000.00");
    await c.payment.create({
      partyId: party.id, amount: "900.00", mode: "bank", paymentDate: PAY_DATE,
      allocations: [{ invoiceId: invoice.id, amount: "1000.00", tdsAmount: "100.00", tdsSectionCode: SECTION, tdsRate: "10.00" }],
    });
    await db.update(chartOfAccounts).set({ isSystem: false }).where(and(
      eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "1600"),
    ));

    await expect(deriveLedger(db, biz.id, RANGE_FROM, RANGE_TO)).rejects.toThrow(/system "TDS Receivable"/);
  });

  it("the system 1600 account cannot be deactivated through account.update", async () => {
    const accounts = await caller().account.list();
    const tdsAccount = accounts.find((a) => a.code === "1600")!;
    expect(tdsAccount.isSystem).toBe(true);

    await expect(caller().account.update({ id: tdsAccount.id, isActive: false }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("cannot be deactivated") });
    // Renaming stays allowed.
    await expect(caller().account.update({ id: tdsAccount.id, name: "TDS Receivable" })).resolves.toBeTruthy();
  });
});

describe("tdsSection router", () => {
  it("only admins can create configurations; a seller is FORBIDDEN", async () => {
    const input = {
      sectionCode: "1027",
      sectionLabel: "ignored",
      effectiveFrom: "2020-01-01T00:00:00.000Z", // back-dated
      status: "active" as const,
      version: 1,
    };
    await expect(sellerCaller().tdsSection.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(tdsSectionConfigs).where(and(
      eq(tdsSectionConfigs.businessId, world.business1.id),
      eq(tdsSectionConfigs.sectionCode, "1027"),
    ))).toHaveLength(0);

    await expect(caller().tdsSection.create(input)).resolves.toMatchObject({ sectionCode: "1027" });
  });

  it("sellers can still list the sections they pick from when recording a receipt", async () => {
    const sections = await sellerCaller().tdsSection.list();
    expect(sections.some((s) => s.sectionCode === SECTION)).toBe(true);
  });

  it("a duplicate (business, code, version) is a CONFLICT, not a 500", async () => {
    const input = {
      sectionCode: "1028",
      sectionLabel: "ignored",
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      status: "active" as const,
      version: 7,
    };
    await caller().tdsSection.create(input);
    await expect(caller().tdsSection.create(input)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an unreasonable version", async () => {
    await expect(caller().tdsSection.create({
      sectionCode: "1028",
      sectionLabel: "ignored",
      effectiveFrom: "2026-04-01T00:00:00.000Z",
      status: "active",
      version: 1_000_000,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("list is read-only: it returns registry defaults without persisting them", async () => {
    const biz = await createBusiness(db, world.ramesh.id, { name: "Read-only List Co" });
    const sections = await caller(biz.id).tdsSection.list();
    expect(sections.length).toBeGreaterThan(30);
    expect(sections.every((s) => s.status === "active")).toBe(true);
    expect(Object.keys(sections[0]!).sort()).toEqual([
      "businessId", "createdAt", "effectiveFrom", "effectiveTo", "id",
      "sectionCode", "sectionLabel", "status", "updatedAt", "version",
    ]);
    expect(await db.select().from(tdsSectionConfigs).where(eq(tdsSectionConfigs.businessId, biz.id))).toHaveLength(0);
  });
});

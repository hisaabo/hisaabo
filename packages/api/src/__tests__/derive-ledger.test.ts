import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, type TestWorld } from "./helpers/fixtures.js";
import { createTestCaller } from "./helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";
import { seedChartOfAccounts } from "../lib/coa-seed.js";
import { money } from "@hisaabo/shared";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();

  // createTestWorld uses direct DB inserts for businesses (bypasses the router),
  // so the CoA seeding that happens in business.create is NOT triggered.
  // We seed both test businesses manually here.
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);
  await seedChartOfAccounts(db, world.business2.id);
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

describe("derive-ledger engine", () => {
  it("sale invoice produces correct journal entries (intra-state, CGST+SGST)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a sale invoice — business1 (stateCode "27") and party1 (stateCode "27") are same state
    const invoice = await caller.invoice.create({
      type: "sale",
      partyId: world.party1.id,
      lineItems: [{
        itemId: world.item1.id,
        itemName: "Test Item",
        quantity: "10",
        unitPrice: "100.00",
        taxPercent: "18",
        discountPercent: "0",
        conversionFactor: "1",
      }],
    });

    // Derive ledger entries
    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    // Find the entry for this invoice
    const invoiceEntry = entries.find((e) => e.sourceId === invoice.id && e.sourceType === "invoice");
    expect(invoiceEntry).toBeDefined();

    // Should have lines for: subtotal (debit receivable, credit sales) + tax (debit receivable, credit CGST + SGST)
    expect(invoiceEntry!.lines.length).toBeGreaterThanOrEqual(2);

    // Receivable (1100) should appear on debit side
    const receivableLine = invoiceEntry!.lines.find((l) => l.accountCode === "1100");
    expect(receivableLine).toBeDefined();

    // Sales (4000) should appear on credit side
    const salesLine = invoiceEntry!.lines.find((l) => l.accountCode === "4000");
    expect(salesLine).toBeDefined();
    expect(salesLine!.credit).not.toBe("0.00");

    // For intra-state: CGST (2100) and SGST (2101) should appear
    const cgstLine = invoiceEntry!.lines.find((l) => l.accountCode === "2100");
    const sgstLine = invoiceEntry!.lines.find((l) => l.accountCode === "2101");
    expect(cgstLine).toBeDefined();
    expect(sgstLine).toBeDefined();

    // Total debits should equal total credits
    const totalDebit = money.sum(invoiceEntry!.lines.map((l) => l.debit));
    const totalCredit = money.sum(invoiceEntry!.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("payment received produces debit Cash/Bank, credit Receivable", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a payment received from customer (party1 is a "customer" type)
    const payment = await caller.payment.create({
      partyId: world.party1.id,
      amount: "500.00",
      mode: "cash",
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    const paymentEntry = entries.find((e) => e.sourceId === payment.id && e.sourceType === "payment");
    expect(paymentEntry).toBeDefined();

    // Cash mode → debit 1000 (Cash in Hand), credit 1100 (Accounts Receivable)
    const debitLine = paymentEntry!.lines.find((l) => l.debit !== "0.00" && l.accountCode === "1000");
    const creditLine = paymentEntry!.lines.find((l) => l.credit !== "0.00" && l.accountCode === "1100");
    expect(debitLine).toBeDefined();
    expect(creditLine).toBeDefined();

    // Total debits should equal total credits
    const totalDebit = money.sum(paymentEntry!.lines.map((l) => l.debit));
    const totalCredit = money.sum(paymentEntry!.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("expense produces debit expense account, credit Cash/Bank", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    await caller.expense.create({
      category: "Rent",
      amount: "15000.00",
      mode: "bank",
      expenseDate: new Date().toISOString(),
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    const expenseEntries = entries.filter((e) => e.sourceType === "expense");
    expect(expenseEntries.length).toBeGreaterThan(0);

    // Find the Rent expense entry — should credit bank (1010) and debit expense account
    const rentEntry = expenseEntries.find((e) => e.narration.includes("Rent"));
    expect(rentEntry).toBeDefined();

    // Bank mode → credit 1010 (Bank Accounts)
    const bankCreditLine = rentEntry!.lines.find((l) => l.credit !== "0.00" && l.accountCode === "1010");
    expect(bankCreditLine).toBeDefined();

    // Total debits should equal total credits
    const totalDebit = money.sum(rentEntry!.lines.map((l) => l.debit));
    const totalCredit = money.sum(rentEntry!.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("all derived entries are balanced (debits = credits)", async () => {
    const db = getTenantTestDb();
    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    for (const entry of entries) {
      const totalDebit = money.sum(entry.lines.map((l) => l.debit));
      const totalCredit = money.sum(entry.lines.map((l) => l.credit));
      expect(totalDebit).toBe(totalCredit);
    }
  });

  it("credit note (sale return) debits Sales Returns (4010) and credits Receivable (1100)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Credit notes are created via the creditNote router (document factory), not invoice.create
    await caller.creditNote.create({
      type: "sale",
      partyId: world.party1.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{
        itemName: "Return of Goods",
        quantity: "1",
        unitPrice: "500.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    const creditNoteEntries = entries.filter((e) => e.sourceType === "invoice" && e.narration.includes("Credit Note"));
    expect(creditNoteEntries.length).toBeGreaterThan(0);

    // The credit note should debit Sales Returns (4010) and credit Receivable (1100)
    const cnEntry = creditNoteEntries[0]!;
    const salesReturnDebit = cnEntry.lines.find((l) => l.accountCode === "4010" && l.debit !== "0.00");
    const receivableCredit = cnEntry.lines.find((l) => l.accountCode === "1100" && l.credit !== "0.00");
    expect(salesReturnDebit).toBeDefined();
    expect(receivableCredit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(cnEntry.lines.map((l) => l.debit));
    const totalCredit = money.sum(cnEntry.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("sales_return produces Dr Sales Returns (4010), Cr Receivable (1100) for sale-type sales return", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a sales_return via the salesReturn router (sale-type, same state as business1)
    await caller.salesReturn.create({
      type: "sale",
      partyId: world.party1.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{
        itemName: "Returned Goods",
        quantity: "2",
        unitPrice: "300.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    // sales_return narration is "Sales Return <number>"
    const srEntries = entries.filter((e) => e.sourceType === "invoice" && e.narration.startsWith("Sales Return"));
    expect(srEntries.length).toBeGreaterThan(0);

    const srEntry = srEntries[srEntries.length - 1]!;

    // Dr Sales Returns (4010)
    const salesReturnDebit = srEntry.lines.find((l) => l.accountCode === "4010" && l.debit !== "0.00");
    expect(salesReturnDebit).toBeDefined();

    // Cr Receivable (1100)
    const receivableCredit = srEntry.lines.find((l) => l.accountCode === "1100" && l.credit !== "0.00");
    expect(receivableCredit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(srEntry.lines.map((l) => l.debit));
    const totalCredit = money.sum(srEntry.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("purchase_return produces Dr Payable (2000), Cr Purchase Returns (5010) for purchase return", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a supplier party for the purchase return
    const supplier = await caller.party.create({
      name: "Surat Fabric Suppliers",
      type: "supplier",
      phone: "9871234560",
      state: "Gujarat",
      stateCode: "24",
    });

    // Create a purchase_return via the purchaseReturn router
    await caller.purchaseReturn.create({
      type: "purchase",
      partyId: supplier.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{
        itemName: "Returned Raw Material",
        quantity: "5",
        unitPrice: "200.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    // purchase_return narration is "Purchase Return <number>"
    const prEntries = entries.filter((e) => e.sourceType === "invoice" && e.narration.startsWith("Purchase Return"));
    expect(prEntries.length).toBeGreaterThan(0);

    const prEntry = prEntries[prEntries.length - 1]!;

    // Dr Payable (2000)
    const payableDebit = prEntry.lines.find((l) => l.accountCode === "2000" && l.debit !== "0.00");
    expect(payableDebit).toBeDefined();

    // Cr Purchase Returns (5010)
    const purchaseReturnCredit = prEntry.lines.find((l) => l.accountCode === "5010" && l.credit !== "0.00");
    expect(purchaseReturnCredit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(prEntry.lines.map((l) => l.debit));
    const totalCredit = money.sum(prEntry.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("purchase invoice debits Purchases (5000), credits Payable (2000)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a supplier party for purchases
    const supplierCaller = callerForRamesh();
    const supplier = await supplierCaller.party.create({
      name: "Ahmedabad Textiles Ltd",
      type: "supplier",
      phone: "9988776655",
      state: "Gujarat",
      stateCode: "24",
    });

    // Purchase from an inter-state supplier → IGST
    await caller.invoice.create({
      type: "purchase",
      partyId: supplier.id,
      lineItems: [{
        itemName: "Raw Cotton",
        quantity: "100",
        unitPrice: "50.00",
        taxPercent: "5",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    const purchaseEntries = entries.filter((e) =>
      e.sourceType === "invoice" && e.narration.includes("Purchase")
    );
    expect(purchaseEntries.length).toBeGreaterThan(0);

    const purchEntry = purchaseEntries[purchaseEntries.length - 1]!;

    // Debit Purchases (5000)
    const purchasesDebit = purchEntry.lines.find((l) => l.accountCode === "5000" && l.debit !== "0.00");
    expect(purchasesDebit).toBeDefined();

    // Credit Payable (2000)
    const payableCredit = purchEntry.lines.find((l) => l.accountCode === "2000" && l.credit !== "0.00");
    expect(payableCredit).toBeDefined();

    // Inter-state → Input IGST (1512) should be debited
    const igstDebit = purchEntry.lines.find((l) => l.accountCode === "1512" && l.debit !== "0.00");
    expect(igstDebit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(purchEntry.lines.map((l) => l.debit));
    const totalCredit = money.sum(purchEntry.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });
});

// ── debit_note by type ─────────────────────────────────────────────────────────

describe("derive-ledger — debit_note by type", () => {
  it("sale-side debit_note produces Dr Receivable (1100), Cr Sales (4000)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a sale-side debit note via the debitNote router
    // (same-state party1: Maharashtra → CGST+SGST)
    await caller.debitNote.create({
      type: "sale",
      partyId: world.party1.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{
        itemName: "Price Correction Upward",
        quantity: "1",
        unitPrice: "400.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    // sale-side debit_note narration is "Debit Note <number>"
    const dnEntries = entries.filter((e) => e.sourceType === "invoice" && e.narration.startsWith("Debit Note"));
    expect(dnEntries.length).toBeGreaterThan(0);

    const dnEntry = dnEntries[dnEntries.length - 1]!;

    // Dr Receivable (1100)
    const receivableDebit = dnEntry.lines.find((l) => l.accountCode === "1100" && l.debit !== "0.00");
    expect(receivableDebit).toBeDefined();

    // Cr Sales (4000)
    const salesCredit = dnEntry.lines.find((l) => l.accountCode === "4000" && l.credit !== "0.00");
    expect(salesCredit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(dnEntry.lines.map((l) => l.debit));
    const totalCredit = money.sum(dnEntry.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });

  it("purchase-side debit_note produces Dr Payable (2000), Cr Purchase Returns (5010)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a purchase-side debit note — business sends a debit note TO a supplier
    // (same-state → CGST+SGST path; use party1 which is Maharashtra "27")
    await caller.debitNote.create({
      type: "purchase",
      partyId: world.party1.id,
      invoiceDate: new Date().toISOString(),
      lineItems: [{
        itemName: "Overcharge correction to supplier",
        quantity: "1",
        unitPrice: "600.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });

    const { deriveLedger } = await import("../lib/derive-ledger.js");
    const entries = await deriveLedger(db, world.business1.id, new Date("2020-01-01"), new Date("2030-12-31"));

    // purchase-side debit_note narration is also "Debit Note <number>"
    // Filter for debit notes on the purchase side (Payable debit + Purchase Returns credit)
    const dnEntries = entries.filter((e) => e.sourceType === "invoice" && e.narration.startsWith("Debit Note"));
    // Find the purchase-side one — it will have a debit on Payable (2000), not Receivable (1100)
    const purchaseDnEntry = dnEntries.find((e) =>
      e.lines.some((l) => l.accountCode === "2000" && l.debit !== "0.00"),
    );
    expect(purchaseDnEntry).toBeDefined();

    // Dr Payable (2000)
    const payableDebit = purchaseDnEntry!.lines.find((l) => l.accountCode === "2000" && l.debit !== "0.00");
    expect(payableDebit).toBeDefined();

    // Cr Purchase Returns (5010)
    const purchaseReturnCredit = purchaseDnEntry!.lines.find((l) => l.accountCode === "5010" && l.credit !== "0.00");
    expect(purchaseReturnCredit).toBeDefined();

    // Must be balanced
    const totalDebit = money.sum(purchaseDnEntry!.lines.map((l) => l.debit));
    const totalCredit = money.sum(purchaseDnEntry!.lines.map((l) => l.credit));
    expect(totalDebit).toBe(totalCredit);
  });
});

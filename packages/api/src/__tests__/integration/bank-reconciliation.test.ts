/**
 * bank-reconciliation.test.ts — Integration tests for bank statement template
 * detection, template CRUD, and the full CSV import/reconciliation lifecycle.
 *
 * WHY THIS FILE EXISTS:
 * Bank statement templates automate the tedious column-mapping step for the 10
 * most common Indian banks. These tests verify:
 *
 *   Templates:  Built-in seed on first upload (10 banks).
 *               Auto-detection from HDFC / SBI CSV headers.
 *               Graceful fallback to heuristics when no template matches.
 *               Custom template create / fork / update / delete.
 *               Guard: seeded templates cannot be edited or deleted.
 *
 *   CSV import: Upload and parse; correct preview row count.
 *               confirmMapping creates statement lines with correct amounts.
 *               Auto-match on exact payment amount + date.
 *               Create expense from unmatched debit line.
 *               Categorization rules applied on import.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  bankStatementImports,
  bankStatementLines,
} from "@hisaabo/db";
import {
  createTestWorld,
  createBankAccount,
  createPayment,
  type TestWorld,
  type TestBankAccount,
  type TestParty,
  createParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";

// ── Fixture ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let account: TestBankAccount;
let party: TestParty;

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  account = await createBankAccount(db, world.business1.id, {
    accountName: "HDFC Current Account",
    accountNumber: "12345678901234",
    ifsc: "HDFC0001234",
    bankName: "HDFC Bank",
    accountType: "current",
    openingBalance: "100000.00",
    currentBalance: "100000.00",
  });

  party = await createParty(db, world.business1.id, {
    name: "Test Party",
    type: "customer",
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Test CSV fixtures ─────────────────────────────────────────────────────────

// HDFC net-banking CSV format: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
const hdfcCSV = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "01/04/26,UPI/PAY/John/9876,UPIREF123,01/04/26,5000.00,,95000.00",
  "02/04/26,NEFT/SALARY/Company,NEFT789,02/04/26,,50000.00,145000.00",
  "03/04/26,ATM/WDL/HDFC,ATM001,03/04/26,2000.00,,143000.00",
].join("\n");

// SBI net-banking CSV format: Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance
const sbiCSV = [
  "Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance",
  "01/04/2026,01/04/2026,UPI Transfer,UPIREF999,1000.00,,99000.00",
  "02/04/2026,02/04/2026,NEFT Received,NEFTXYZ,,25000.00,124000.00",
].join("\n");

// Unknown bank CSV with unknown headers — no template should match
const unknownCSV = [
  "TransDate,Details,Amount,RunningBalance",
  "2026-04-01,Payment to vendor,5000,45000",
  "2026-04-02,Received from client,10000,55000",
].join("\n");

// Simple CSV for general import tests
const simpleCSV = [
  "Date,Description,Debit,Credit,Balance",
  "01/04/2026,Office Supplies Purchase,1500.00,,98500.00",
  "02/04/2026,Client Payment Received,,25000.00,123500.00",
].join("\n");

// CSV with SALARY narration for rule-based categorisation test
const salaryCSV = [
  "Date,Description,Debit,Credit,Balance",
  "01/04/2026,SALARY CREDIT MARCH 2026,,80000.00,180000.00",
].join("\n");

// ── Template seeding ──────────────────────────────────────────────────────────

describe("Bank Statement Templates", () => {
  it("seeds built-in templates (10 banks) on first uploadCSV call", async () => {
    const caller = callerForRamesh();

    // Upload triggers lazy seed
    await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "test.csv",
      csvContent: simpleCSV,
    });

    // Template list must now include all 10 built-in banks
    const templates = await caller.bankRecon.templateList();
    expect(templates.length).toBeGreaterThanOrEqual(10);

    const seeded = templates.filter((t) => t.isSeeded);
    expect(seeded.length).toBeGreaterThanOrEqual(10);

    // Verify slug variety — at least SBI and HDFC
    const slugs = seeded.map((t) => t.bankSlug);
    expect(slugs).toContain("hdfc");
    expect(slugs).toContain("sbi");
  });

  it("auto-detects HDFC template from HDFC-style CSV headers", async () => {
    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "hdfc-statement.csv",
      csvContent: hdfcCSV,
    });

    expect(result.detectedTemplate).not.toBeNull();
    expect(result.detectedTemplate!.bankSlug).toBe("hdfc");
    expect(result.detectedTemplate!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("auto-detects SBI template from SBI-style CSV headers", async () => {
    // Create an SBI bank account for better hint-based detection
    const db = getTenantTestDb();
    const sbiAccount = await createBankAccount(db, world.business1.id, {
      accountName: "SBI Savings",
      accountNumber: "99887766554411",
      ifsc: "SBIN0001234",
      bankName: "State Bank of India",
      accountType: "savings",
      openingBalance: "0.00",
      currentBalance: "0.00",
    });

    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: sbiAccount.id,
      fileName: "sbi-statement.csv",
      csvContent: sbiCSV,
    });

    expect(result.detectedTemplate).not.toBeNull();
    expect(result.detectedTemplate!.bankSlug).toBe("sbi");
  });

  it("falls back to heuristic mapping when no template matches unknown headers", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a bank account with no recognizable IFSC or bank-name hints
    const neutralAccount = await createBankAccount(db, world.business1.id, {
      accountName: "Regional Co-op Bank",
      accountNumber: "00000000001",
      ifsc: "RCOP0001234",
      bankName: "Regional Cooperative Bank",
      accountType: "savings",
      openingBalance: "0.00",
      currentBalance: "0.00",
    });

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: neutralAccount.id,
      fileName: "unknown-bank.csv",
      csvContent: unknownCSV,
    });

    // No template detected, but detectedMapping from heuristics must still be present
    expect(result.detectedTemplate).toBeNull();
    expect(result.detectedMapping).toBeDefined();
  });

  it("creates a custom template and it appears in templateList", async () => {
    const caller = callerForRamesh();

    const tmpl = await caller.bankRecon.templateCreate({
      bankDisplayName: "Custom Regional Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
      label: "Test custom template",
    });

    expect(tmpl.isSeeded).toBe(false);
    expect(tmpl.bankDisplayName).toBe("Custom Regional Bank");
    expect(tmpl.version).toBe(1);

    const list = await caller.bankRecon.templateList();
    const found = list.find((t) => t.id === tmpl.id);
    expect(found).toBeDefined();
  });

  it("forks a seeded template into an editable copy with forkedFromId set", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    const forked = await caller.bankRecon.templateFork({
      templateId: seeded!.id,
      label: "My custom HDFC",
    });

    expect(forked.isSeeded).toBe(false);
    expect(forked.forkedFromId).toBe(seeded!.id);
    expect(forked.bankSlug).toBe(seeded!.bankSlug);
    expect(forked.version).toBeGreaterThan(seeded!.version);
    expect(forked.label).toBe("My custom HDFC");
  });

  it("rejects editing a seeded template", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    await expect(
      caller.bankRecon.templateUpdate({
        id: seeded!.id,
        label: "Should fail",
      }),
    ).rejects.toThrow(/seeded|fork/i);
  });

  it("edits a custom template and persists the change", async () => {
    const caller = callerForRamesh();

    const created = await caller.bankRecon.templateCreate({
      bankDisplayName: "Editable Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const updated = await caller.bankRecon.templateUpdate({
      id: created.id,
      label: "Updated label",
      isActive: false,
    });

    expect(updated.label).toBe("Updated label");
    expect(updated.isActive).toBe(false);
  });

  it("rejects deleting a seeded template", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    await expect(
      caller.bankRecon.templateDelete({ id: seeded!.id }),
    ).rejects.toThrow(/seeded/i);
  });

  it("deletes a custom template and it no longer appears in templateList", async () => {
    const caller = callerForRamesh();

    const created = await caller.bankRecon.templateCreate({
      bankDisplayName: "Delete Me Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    await caller.bankRecon.templateDelete({ id: created.id });

    const list = await caller.bankRecon.templateList();
    const found = list.find((t) => t.id === created.id);
    expect(found).toBeUndefined();
  });
});

// ── CSV Import lifecycle ──────────────────────────────────────────────────────

describe("Bank Reconciliation — CSV Import", () => {
  it("uploads a CSV and returns correct preview row count and headers", async () => {
    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "simple.csv",
      csvContent: simpleCSV,
    });

    expect(result.importId).toBeDefined();
    expect(result.headers).toEqual(["Date", "Description", "Debit", "Credit", "Balance"]);
    // simpleCSV has 2 data rows; preview is min(5, rows)
    expect(result.previewRows.length).toBe(2);
    expect(result.totalRows).toBe(2);
  });

  it("confirmMapping creates statement lines with correct dates and amounts", async () => {
    const caller = callerForRamesh();

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "simple2.csv",
      csvContent: simpleCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: simpleCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    expect(lines.length).toBe(2);
    // First line: debit 1500
    const debitLine = lines.find((l) => parseFloat(l.debit) > 0);
    expect(debitLine).toBeDefined();
    expect(parseFloat(debitLine!.debit)).toBeCloseTo(1500, 1);
    // Second line: credit 25000
    const creditLine = lines.find((l) => parseFloat(l.credit) > 0);
    expect(creditLine).toBeDefined();
    expect(parseFloat(creditLine!.credit)).toBeCloseTo(25000, 1);
  });

  it("auto-matches a statement line when an exact payment exists", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Create a payment that will match the credit line
    const paymentDate = new Date("2026-04-02");
    await createPayment(db, world.business1.id, party.id, {
      amount: "25000.00",
      paymentDate,
      mode: "bank",
      referenceNumber: "REF001",
    });

    // Upload CSV with that same credit amount on the same date
    const matchCSV = [
      "Date,Description,Debit,Credit,Balance",
      "02/04/2026,Client Payment Received,,25000.00,125000.00",
    ].join("\n");

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "match-test.csv",
      csvContent: matchCSV,
    });

    const result = await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: matchCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    expect(result.matchedLines).toBeGreaterThanOrEqual(1);

    // Check the statement line has auto_matched status
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    const matched = lines.find((l) => l.matchStatus === "auto_matched");
    expect(matched).toBeDefined();
    expect(matched!.matchedPaymentId).not.toBeNull();
  });

  it("creates an expense from an unmatched debit line and marks it as created", async () => {
    const caller = callerForRamesh();

    const debitCSV = [
      "Date,Description,Debit,Credit,Balance",
      "03/04/2026,Office Supplies,3000.00,,97000.00",
    ].join("\n");

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "debit-test.csv",
      csvContent: debitCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: debitCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    const debitLine = lines.find((l) => parseFloat(l.debit) > 0);
    expect(debitLine).toBeDefined();
    expect(debitLine!.matchStatus).toBe("unmatched");

    // Create an expense from the unmatched line
    const expense = await caller.bankRecon.createExpense({
      lineId: debitLine!.id,
      expense: {
        category: "Office Supplies",
        description: "Office Supplies purchase",
        amount: "3000.00",
        mode: "bank",
        expenseDate: new Date("2026-04-03").toISOString(),
      },
    });

    expect(expense).toBeDefined();
    expect(expense.category).toBe("Office Supplies");
    expect(expense.amount).toBe("3000.00");

    // Verify line is now marked as "created"
    const refreshed = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, debitLine!.id));

    expect(refreshed[0]!.matchStatus).toBe("created");
    expect(refreshed[0]!.matchedExpenseId).toBe(expense.id);
  });

  it("applies a categorization rule to auto-categorize a matching line on import", async () => {
    const caller = callerForRamesh();

    // Create a rule: narration contains SALARY → expense in Salary category
    await caller.bankRecon.ruleCreate({
      matchField: "narration",
      matchType: "contains",
      matchValue: "SALARY",
      action: "create_expense",
      expenseCategory: "Salary",
      priority: 10,
    });

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "salary.csv",
      csvContent: salaryCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: salaryCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    // The credit line should have auto_category = Salary
    const salaryLine = lines.find((l) => l.narration?.toUpperCase().includes("SALARY"));
    expect(salaryLine).toBeDefined();
    expect(salaryLine!.autoCategory).toBe("Salary");
  });

  it("saves templateId and templateVersion on import when templateId provided", async () => {
    const caller = callerForRamesh();

    // Get the HDFC template (seeded by first test)
    const templates = await caller.bankRecon.templateList();
    const hdfcTemplate = templates.find((t) => t.bankSlug === "hdfc" && t.isSeeded);
    expect(hdfcTemplate).toBeDefined();

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "hdfc-import.csv",
      csvContent: hdfcCSV,
    });

    // Confirm with explicit templateId
    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: hdfcCSV,
      templateId: hdfcTemplate!.id,
      columnMapping: {
        date: 0,
        narration: 1,
        reference: 2,
        debit: 4,
        credit: 5,
        balance: 6,
        dateFormat: "DD/MM/YY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const [importRecord] = await db
      .select()
      .from(bankStatementImports)
      .where(eq(bankStatementImports.id, upload.importId));

    expect(importRecord!.templateId).toBe(hdfcTemplate!.id);
    expect(importRecord!.templateVersion).toBe(hdfcTemplate!.version);
  });
});

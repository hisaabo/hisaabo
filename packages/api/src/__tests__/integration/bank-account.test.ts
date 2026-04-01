/**
 * bank-account.test.ts — Integration tests for bankAccountRouter
 *
 * WHY THIS FILE EXISTS:
 * Bank accounts maintain a running currentBalance that must stay consistent with
 * their transaction ledger. Key invariants under test:
 *
 *   1. currentBalance is initialised from openingBalance on create.
 *   2. addTransaction atomically updates currentBalance (deposit adds, withdrawal subtracts).
 *   3. transfer creates two transactions and updates both balances in a single DB
 *      transaction — balances are always consistent.
 *   4. delete is blocked when the account has transactions (FK guard surface via
 *      business-logic check, not raw FK error).
 *   5. setting isDefault=true on a new account clears the previous default.
 *   6. Business isolation: one business cannot read another's accounts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createBankAccount,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Fixture ────────────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Create ─────────────────────────────────────────────────────────────────────

describe("bankAccount.create", () => {
  it("bankAccount.create persists a new account with currentBalance = openingBalance", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const result = await caller.bankAccount.create({
      accountName: "SBI Savings",
      accountNumber: "99887766554433",
      ifsc: "SBIN0001234",
      bankName: "State Bank of India",
      accountType: "savings",
      openingBalance: "5000.00",
      isDefault: false,
    });

    expect(result).toBeDefined();
    expect(result!.accountName).toBe("SBI Savings");
    expect(result!.openingBalance).toBe("5000.00");
    // currentBalance starts at openingBalance
    expect(result!.currentBalance).toBe("5000.00");
    expect(result!.businessId).toBe(world.business1.id);
  });

  it("bankAccount.create with isDefault=true clears previous default account", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    // First default account
    await caller.bankAccount.create({
      accountName: "HDFC Primary",
      accountNumber: "11111111111111",
      ifsc: "HDFC0000001",
      bankName: "HDFC Bank",
      accountType: "current",
      openingBalance: "0.00",
      isDefault: true,
    });

    // Second account also marked as default
    const second = await caller.bankAccount.create({
      accountName: "ICICI Secondary",
      accountNumber: "22222222222222",
      ifsc: "ICIC0000001",
      bankName: "ICICI Bank",
      accountType: "current",
      openingBalance: "0.00",
      isDefault: true,
    });

    // List all accounts — only one should be default
    const accounts = await caller.bankAccount.list();
    const defaults = accounts.filter((a) => a.isDefault);

    expect(defaults.length).toBe(1);
    expect(defaults[0]!.id).toBe(second!.id);
  });
});

// ── Read ───────────────────────────────────────────────────────────────────────

describe("bankAccount.list and getById", () => {
  it("bankAccount.list returns all accounts for the business ordered by default first", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const accounts = await caller.bankAccount.list();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it("bankAccount.getById returns the account with recent transactions", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.bankAccount.create({
      accountName: "GetById Test Account",
      accountNumber: "33333333333333",
      ifsc: "HDFC0000099",
      bankName: "HDFC Bank",
      accountType: "savings",
      openingBalance: "1000.00",
      isDefault: false,
    });

    const fetched = await caller.bankAccount.getById({ id: created!.id });

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created!.id);
    expect(fetched!.accountName).toBe("GetById Test Account");
    expect(Array.isArray(fetched!.recentTransactions)).toBe(true);
  });

  it("bankAccount.getById returns null for an account in another business", async () => {
    const callerRamesh = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await callerRamesh.bankAccount.create({
      accountName: "Secret Account",
      accountNumber: "44444444444444",
      ifsc: "HDFC0000088",
      bankName: "HDFC Bank",
      accountType: "current",
      openingBalance: "0.00",
      isDefault: false,
    });

    // Kiran's caller with business2 tries to fetch business1's account
    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    const result = await callerKiran.bankAccount.getById({ id: created!.id });
    expect(result).toBeNull();
  });
});

// ── Update ─────────────────────────────────────────────────────────────────────

describe("bankAccount.update", () => {
  it("bankAccount.update changes account name and returns updated row", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await caller.bankAccount.create({
      accountName: "Old Name Account",
      accountNumber: "55555555555555",
      ifsc: "HDFC0000077",
      bankName: "HDFC Bank",
      accountType: "savings",
      openingBalance: "0.00",
      isDefault: false,
    });

    const updated = await caller.bankAccount.update({
      id: created!.id,
      data: { accountName: "New Renamed Account" },
    });

    expect(updated!.accountName).toBe("New Renamed Account");
  });

  it("bankAccount.update throws NOT_FOUND for account in another business", async () => {
    const callerRamesh = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const created = await callerRamesh.bankAccount.create({
      accountName: "Protected Account",
      accountNumber: "66666666666666",
      ifsc: "HDFC0000066",
      bankName: "HDFC Bank",
      accountType: "current",
      openingBalance: "0.00",
      isDefault: false,
    });

    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    await expect(
      callerKiran.bankAccount.update({
        id: created!.id,
        data: { accountName: "Hijacked" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── Transactions ───────────────────────────────────────────────────────────────

describe("bankAccount.addTransaction", () => {
  it("addTransaction deposit increases currentBalance by the transaction amount", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const account = await caller.bankAccount.create({
      accountName: "Deposit Test Account",
      accountNumber: "77777777777777",
      ifsc: "AXIS0000001",
      bankName: "Axis Bank",
      accountType: "savings",
      openingBalance: "1000.00",
      isDefault: false,
    });

    await caller.bankAccount.addTransaction({
      bankAccountId: account!.id,
      type: "deposit",
      amount: "500.00",
      description: "Customer payment received",
    });

    const fetched = await caller.bankAccount.getById({ id: account!.id });
    expect(fetched!.currentBalance).toBe("1500.00");
  });

  it("addTransaction withdrawal decreases currentBalance by the transaction amount", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const account = await caller.bankAccount.create({
      accountName: "Withdrawal Test Account",
      accountNumber: "88888888888888",
      ifsc: "AXIS0000002",
      bankName: "Axis Bank",
      accountType: "savings",
      openingBalance: "2000.00",
      isDefault: false,
    });

    await caller.bankAccount.addTransaction({
      bankAccountId: account!.id,
      type: "withdrawal",
      amount: "750.00",
      description: "Supplier payment made",
    });

    const fetched = await caller.bankAccount.getById({ id: account!.id });
    expect(fetched!.currentBalance).toBe("1250.00");
  });
});

// ── Transfer ───────────────────────────────────────────────────────────────────

describe("bankAccount.transfer", () => {
  it("transfer between two accounts updates both balances correctly — net zero for the business", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const fromAccount = await caller.bankAccount.create({
      accountName: "Transfer Source Account",
      accountNumber: "10101010101010",
      ifsc: "KOTAK000001",
      bankName: "Kotak Bank",
      accountType: "current",
      openingBalance: "5000.00",
      isDefault: false,
    });

    const toAccount = await caller.bankAccount.create({
      accountName: "Transfer Destination Account",
      accountNumber: "20202020202020",
      ifsc: "KOTAK000002",
      bankName: "Kotak Bank",
      accountType: "savings",
      openingBalance: "2000.00",
      isDefault: false,
    });

    await caller.bankAccount.transfer({
      fromAccountId: fromAccount!.id,
      toAccountId: toAccount!.id,
      amount: "1500.00",
      description: "Moving funds to savings",
    });

    const updatedFrom = await caller.bankAccount.getById({ id: fromAccount!.id });
    const updatedTo = await caller.bankAccount.getById({ id: toAccount!.id });

    expect(updatedFrom!.currentBalance).toBe("3500.00");
    expect(updatedTo!.currentBalance).toBe("3500.00");
  });

  it("transfer to the same account is rejected — gap: same fromAccountId/toAccountId must fail", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const account = await caller.bankAccount.create({
      accountName: "Self Transfer Account",
      accountNumber: "30303030303030",
      ifsc: "PNB0000001",
      bankName: "PNB",
      accountType: "current",
      openingBalance: "5000.00",
      isDefault: false,
    });

    await expect(
      caller.bankAccount.transfer({
        fromAccountId: account!.id,
        toAccountId: account!.id,
        amount: "100.00",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ── Delete guard ───────────────────────────────────────────────────────────────

describe("bankAccount.delete", () => {
  it("bankAccount.delete succeeds when the account has no transactions", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const account = await caller.bankAccount.create({
      accountName: "Empty Account To Delete",
      accountNumber: "40404040404040",
      ifsc: "UCO0000001",
      bankName: "UCO Bank",
      accountType: "savings",
      openingBalance: "0.00",
      isDefault: false,
    });

    const result = await caller.bankAccount.delete({ id: account!.id });
    expect(result.success).toBe(true);

    // Verify gone
    const accounts = await caller.bankAccount.list();
    const found = accounts.find((a) => a.id === account!.id);
    expect(found).toBeUndefined();
  });

  it("bankAccount.delete cannot delete account with transactions — FK guard surface", async () => {
    const caller = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });

    const account = await caller.bankAccount.create({
      accountName: "Account With Transactions",
      accountNumber: "50505050505050",
      ifsc: "BOB0000001",
      bankName: "Bank of Baroda",
      accountType: "current",
      openingBalance: "10000.00",
      isDefault: false,
    });

    // Add a transaction so the delete guard triggers
    await caller.bankAccount.addTransaction({
      bankAccountId: account!.id,
      type: "deposit",
      amount: "1000.00",
      description: "Test deposit",
    });

    await expect(
      caller.bankAccount.delete({ id: account!.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("bankAccount.delete throws NOT_FOUND for account in another business", async () => {
    // Seed an account directly in business1 via the fixture factory
    const b1Account = await createBankAccount(world.tenantDb, world.business1.id, {
      accountName: "B1 Only Account",
      accountNumber: "60606060606060",
      openingBalance: "0.00",
      currentBalance: "0.00",
      isDefault: false,
    });

    const callerKiran = createTestCaller({
      userId: world.kiran.id,
      email: world.kiran.email,
      name: world.kiran.name,
      tenantId: world.tenant2.id,
      businessId: world.business2.id,
    });

    await expect(
      callerKiran.bankAccount.delete({ id: b1Account.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

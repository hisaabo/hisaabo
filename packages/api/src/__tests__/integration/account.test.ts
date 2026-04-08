import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { chartOfAccounts } from "@hisaabo/db";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

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

describe("Chart of Accounts", () => {
  describe("account.list", () => {
    it("returns seeded system accounts after business creation", async () => {
      const caller = callerForRamesh();
      const accounts = await caller.account.list();
      expect(accounts.length).toBeGreaterThan(20); // ~36 seeded accounts
      expect(accounts.some((a) => a.code === "1000" && a.name === "Cash in Hand")).toBe(true);
      expect(accounts.some((a) => a.code === "4000" && a.name === "Sales")).toBe(true);
      expect(accounts.some((a) => a.code === "5000" && a.name === "Purchases")).toBe(true);
      expect(accounts.every((a) => a.isSystem)).toBe(true); // all seeded are system
    });
  });

  describe("account.create", () => {
    it("creates a custom account", async () => {
      const caller = callerForRamesh();
      const account = await caller.account.create({
        code: "5995",
        name: "Tea & Snacks",
        accountType: "expense",
      });
      expect(account.code).toBe("5995");
      expect(account.name).toBe("Tea & Snacks");
      expect(account.isSystem).toBe(false);
    });

    it("rejects duplicate code within same business", async () => {
      const caller = callerForRamesh();
      await expect(
        caller.account.create({
          code: "1000", // already exists (Cash in Hand)
          name: "Duplicate",
          accountType: "asset",
        }),
      ).rejects.toThrow();
    });
  });

  describe("account.update", () => {
    it("renames a custom account", async () => {
      const caller = callerForRamesh();
      // Create, then update
      const account = await caller.account.create({
        code: "5996",
        name: "Old Name",
        accountType: "expense",
      });
      const updated = await caller.account.update({
        id: account.id,
        name: "New Name",
      });
      expect(updated.name).toBe("New Name");
    });
  });

  describe("account.delete", () => {
    it("deletes a custom (non-system) account", async () => {
      const caller = callerForRamesh();
      const account = await caller.account.create({
        code: "5997",
        name: "Temporary",
        accountType: "expense",
      });
      await caller.account.delete({ id: account.id });
      const accounts = await caller.account.list();
      expect(accounts.find((a) => a.id === account.id)).toBeUndefined();
    });

    it("rejects deletion of system account", async () => {
      const caller = callerForRamesh();
      const accounts = await caller.account.list();
      const cashAccount = accounts.find((a) => a.code === "1000");
      expect(cashAccount).toBeDefined();
      await expect(caller.account.delete({ id: cashAccount!.id })).rejects.toThrow(/system/i);
    });
  });

  describe("business isolation", () => {
    it("cannot see accounts from another business", async () => {
      // Each business has its own seeded CoA rows — same codes but different IDs
      const db = getTenantTestDb();
      const b1Accounts = await db
        .select()
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, world.business1.id));
      const b2Accounts = await db
        .select()
        .from(chartOfAccounts)
        .where(eq(chartOfAccounts.businessId, world.business2.id));

      // Both have accounts seeded
      expect(b1Accounts.length).toBeGreaterThan(0);
      expect(b2Accounts.length).toBeGreaterThan(0);

      // The row IDs are different (they are isolated per-business)
      const b1Ids = new Set(b1Accounts.map((a) => a.id));
      const b2Ids = new Set(b2Accounts.map((a) => a.id));
      for (const id of b2Ids) {
        expect(b1Ids.has(id)).toBe(false);
      }

      // Kiran's caller only sees business2 accounts
      const kiranCaller = createTestCaller({
        userId: world.kiran.id,
        email: world.kiran.email,
        name: world.kiran.name ?? null,
        tenantId: world.tenant2.id,
        businessId: world.business2.id,
      });
      const kiranAccounts = await kiranCaller.account.list();
      expect(kiranAccounts.every((a) => a.businessId === world.business2.id)).toBe(true);
    });
  });
});

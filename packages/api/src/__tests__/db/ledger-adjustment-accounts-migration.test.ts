/**
 * Migration 0023_ledger_adjustment_accounts (drizzle/) and its tenant twin
 * 0010_ledger_adjustment_accounts (drizzle-tenant/): adds the Round Off (5030),
 * Discount Allowed (5020) and Other Charges (4020) system accounts to every
 * EXISTING business. Runs the committed SQL itself against the test database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { chartOfAccounts } from "@hisaabo/db";
import { createUser, createBusiness } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts, DEFAULT_ACCOUNTS } from "../../lib/coa-seed.js";

const NEW_ACCOUNTS = [
  { code: "4020", name: "Other Charges", accountType: "income" },
  { code: "5020", name: "Discount Allowed", accountType: "expense" },
  { code: "5030", name: "Round Off", accountType: "expense" },
] as const;

const dbDir = new URL("../../../../db/", import.meta.url);
const UNIFIED = fileURLToPath(new URL("drizzle/0023_ledger_adjustment_accounts.sql", dbDir));
const TENANT = fileURLToPath(new URL("drizzle-tenant/0010_ledger_adjustment_accounts.sql", dbDir));

const db = () => getTenantTestDb();

async function applyMigration(file: string): Promise<void> {
  const statements = readFileSync(file, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await db().execute(sql.raw(stmt));
}

async function accountsOf(businessId: string, codes: readonly string[]) {
  const rows = await db()
    .select()
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.businessId, businessId));
  return rows.filter((r) => codes.includes(r.code)).sort((a, b) => a.code.localeCompare(b.code));
}

let userId: string;
beforeAll(async () => {
  await truncateAllTables();
  userId = (await createUser()).id;
});
afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("migration: ledger adjustment accounts", () => {
  it("the drizzle/ and drizzle-tenant/ copies are the same SQL", () => {
    expect(readFileSync(TENANT, "utf8")).toBe(readFileSync(UNIFIED, "utf8"));
  });

  it("the fresh-business seed contains exactly the accounts the migration adds", () => {
    for (const a of NEW_ACCOUNTS) {
      expect(DEFAULT_ACCOUNTS).toContainEqual(a);
    }
  });

  it("adds the three system accounts to a business that has the OLD chart, and is idempotent", async () => {
    const biz = await createBusiness(db(), userId, { name: "Old chart" });
    // An existing business: the chart as seeded before this release.
    await seedChartOfAccounts(db(), biz.id);
    await db().delete(chartOfAccounts).where(
      and(eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.isSystem, true), sql`${chartOfAccounts.code} IN ('4020', '5020', '5030')`),
    );
    expect(await accountsOf(biz.id, ["4020", "5020", "5030"])).toEqual([]);

    await applyMigration(UNIFIED);
    const after = await accountsOf(biz.id, ["4020", "5020", "5030"]);
    expect(after.map((a) => [a.code, a.name, a.accountType, a.isSystem, a.isActive])).toEqual([
      ["4020", "Other Charges", "income", true, true],
      ["5020", "Discount Allowed", "expense", true, true],
      ["5030", "Round Off", "expense", true, true],
    ]);

    // Running it again (and the tenant copy after the unified one) changes nothing.
    await applyMigration(UNIFIED);
    await applyMigration(TENANT);
    const again = await accountsOf(biz.id, ["4020", "5020", "5030"]);
    expect(again.map((a) => a.id)).toEqual(after.map((a) => a.id));
  });

  it("covers every business, including one with no chart at all, and leaves other accounts alone", async () => {
    const a = await createBusiness(db(), userId, { name: "A" });
    const b = await createBusiness(db(), userId, { name: "B" });
    await seedChartOfAccounts(db(), a.id);
    const before = (await db().select().from(chartOfAccounts).where(eq(chartOfAccounts.businessId, a.id))).length;

    await applyMigration(UNIFIED);

    expect((await accountsOf(a.id, ["4020", "5020", "5030"])).length).toBe(3);
    expect((await accountsOf(b.id, ["4020", "5020", "5030"])).length).toBe(3);
    // A already had them from the fresh seed: no duplicate rows, nothing else touched.
    expect((await db().select().from(chartOfAccounts).where(eq(chartOfAccounts.businessId, a.id))).length).toBe(before);
  });

  it("skips a code the user already took, without failing and without overwriting it", async () => {
    const biz = await createBusiness(db(), userId, { name: "User code" });
    await db().insert(chartOfAccounts).values({
      businessId: biz.id,
      code: "5030",
      name: "My own thing",
      accountType: "asset",
      isSystem: false,
      isActive: true,
    });

    await applyMigration(UNIFIED);

    const mine = await accountsOf(biz.id, ["5030"]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "My own thing", accountType: "asset", isSystem: false });
    // The other two were still added.
    expect((await accountsOf(biz.id, ["4020", "5020"])).length).toBe(2);
  });
});

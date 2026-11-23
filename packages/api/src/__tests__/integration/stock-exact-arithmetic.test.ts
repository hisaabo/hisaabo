/**
 * Stock quantities are NUMERIC(15,3) and move in exact decimal arithmetic.
 *
 * Three code paths used to do the arithmetic with the money helpers (two decimals) or JS floats:
 *   item.switchBaseUnit  - converted the stock with money.toNumber (0.125 became 0.13) x factor
 *   item.merge           - the merged stock went through money.add(.., x.toFixed(3)), which prints 2 decimals
 *   the invoice import   - qty x conversion factor with money.toNumber on both (0.125 -> 0.13, 0.333333 -> 0.33)
 *   item.adjustStock     - a float sum
 * so 3-decimal stock (a kilo sold in 125 g steps) was silently rounded to the paisa.
 *
 * Every expected value is a hand-computed literal with the arithmetic beside it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { items } from "@hisaabo/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { addMember, createBusiness, createItem, createParty, createTenant, createUser, type TestBusiness, type TestTenant } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { runInvoicesImport } from "../../routers/import/engine/invoices.js";

let tenant: TestTenant;
let business: TestBusiness;
let owner: Awaited<ReturnType<typeof createUser>>;
let asOwner: ReturnType<typeof createTestCaller>;

async function stockOf(id: string) {
  const db = getTenantTestDb();
  const [row] = await db.select({ s: items.stockQuantity }).from(items).where(eq(items.id, id));
  return row!.s;
}

beforeAll(async () => {
  const db = getTenantTestDb();
  owner = await createUser({ email: "owner.stock@acme.in", name: "Owner" });
  tenant = await createTenant({ name: "Stock Exact Co" });
  await addMember(tenant.id, owner.id, "owner");
  business = await createBusiness(db, owner.id, { name: "Stock Exact Co" });
  asOwner = createTestCaller({ userId: owner.id, email: owner.email, name: owner.name ?? null, tenantId: tenant.id, businessId: business.id });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("item.switchBaseUnit converts 3-decimal stock exactly", () => {
  it.each([
    // stock (kg), 1 kg = factor g, expected stock in g, arithmetic
    ["0.125", 1000, "125.000", "0.125 x 1000 = 125 (it was 0.13 x 1000 = 130)"],
    ["1.125", 1000, "1125.000", "1.125 x 1000 = 1125 (it was 1.13 x 1000 = 1130)"],
    ["2.375", 4, "9.500", "2.375 x 4 = 9.5 (it was 2.38 x 4 = 9.52)"],
    ["0.001", 1000, "1.000", "0.001 x 1000 = 1 (it was 0.00 x 1000 = 0)"],
    ["10.000", 0.333, "3.330", "10 x 0.333 = 3.33"],
    ["0.007", 0.5, "0.004", "0.007 x 0.5 = 0.0035, rounded half up to 0.004"],
  ])("stock %s kg, factor %s -> %s (%s)", async (stock, factor, expected) => {
    const db = getTenantTestDb();
    const item = await createItem(db, business.id, { name: `Loose ${stock}/${factor}`, unit: "kg", stockQuantity: stock, salePrice: "100.00", purchasePrice: "80.00" });
    await asOwner.item.switchBaseUnit({ id: item.id, newUnit: "g", conversionFactor: factor });
    expect(await stockOf(item.id)).toBe(expected);
  });

  it("a factor that is not a plain decimal (1e-7) is refused, nothing changes", async () => {
    const db = getTenantTestDb();
    const item = await createItem(db, business.id, { name: "Tiny factor", unit: "kg", stockQuantity: "3.000" });
    await expect(asOwner.item.switchBaseUnit({ id: item.id, newUnit: "g", conversionFactor: 1e-7 })).rejects.toThrow(/plain decimal/);
    expect(await stockOf(item.id)).toBe("3.000");
  });
});

describe("item.merge adds the converted stock exactly", () => {
  it.each([
    // source stock, target stock, factor (1 source unit = factor target units), merged stock
    ["0.125", "2.000", 1, "2.125", "2.000 + 0.125 = 2.125 (it was 2.13)"],
    ["1.375", "0.250", 1, "1.625", "0.250 + 1.375 = 1.625 (it was 1.63)"],
    ["0.333", "1.000", 3, "1.999", "1.000 + 0.333 x 3 = 1.999 (it was 2.00)"],
    ["10.000", "0.005", 0.2, "2.005", "0.005 + 10 x 0.2 = 2.005 (it was 2.01)"],
  ])("source %s into target %s, factor %s -> %s (%s)", async (sourceStock, targetStock, factor, expected) => {
    const db = getTenantTestDb();
    const source = await createItem(db, business.id, { name: `Src ${sourceStock}/${targetStock}/${factor}`, unit: "kg", stockQuantity: sourceStock });
    const target = await createItem(db, business.id, { name: `Tgt ${sourceStock}/${targetStock}/${factor}`, unit: "kg", stockQuantity: targetStock });
    await asOwner.item.merge({ sourceId: source.id, targetId: target.id, stockConversionFactor: factor });
    expect(await stockOf(target.id)).toBe(expected);
  });
});

describe("item.adjustStock adds exactly", () => {
  it("0.125 + 0.125 and a large stock keep every decimal", async () => {
    const db = getTenantTestDb();
    const item = await createItem(db, business.id, { name: "Adjusted", unit: "kg", stockQuantity: "9999999999.999" });
    await asOwner.item.adjustStock({ itemId: item.id, quantity: "0.001" });
    expect(await stockOf(item.id)).toBe("10000000000.000"); // 9,999,999,999.999 + 0.001
    await asOwner.item.adjustStock({ itemId: item.id, quantity: "-0.125" });
    expect(await stockOf(item.id)).toBe("9999999999.875"); // 10,000,000,000.000 - 0.125
  });
});

describe("invoice import: stock movement is quantity x conversion factor, exactly", () => {
  it("a sale of 0.125 kg takes stock from 10.000 to 9.875 (it took 0.13: 9.870)", async () => {
    const db = getTenantTestDb();
    const party = await createParty(db, business.id, { name: "Import Customer A", type: "customer" });
    const item = await createItem(db, business.id, { name: "Saffron Import A", unit: "kg", stockQuantity: "10.000" });
    const res = await runInvoicesImport(db as never, business.id, { id: owner.id, name: "Owner" }, "test", [
      {
        invoiceNumber: "IMP-A1", type: "sale", invoiceDate: new Date("2025-02-01"), partyName: party.name, status: "sent",
        subtotal: "12.50", taxAmount: "0", discountAmount: "0", totalAmount: "12.50", amountPaid: "0",
        lineItems: [{ itemName: item.name, quantity: "0.125", unitPrice: "100", taxPercent: "0", discountPercent: "0" }],
      },
    ] as never, { autoCreatePayments: false, defaultPaymentMode: "cash" });
    expect(res.created).toBe(1);
    expect(await stockOf(item.id)).toBe("9.875"); // 10 - 0.125
  });

  it("an alternate unit with factor 0.333333: 3 x 0.333333 = 0.999999 leaves 9.000 (the 2-dp factor 0.33 left 9.010)", async () => {
    const db = getTenantTestDb();
    const party = await createParty(db, business.id, { name: "Import Customer B", type: "customer" });
    const item = await createItem(db, business.id, { name: "Rice Import B", unit: "kg", stockQuantity: "10.000" });
    await runInvoicesImport(db as never, business.id, { id: owner.id, name: "Owner" }, "test", [
      {
        invoiceNumber: "IMP-B1", type: "sale", invoiceDate: new Date("2025-02-01"), partyName: party.name, status: "sent",
        subtotal: "30.00", taxAmount: "0", discountAmount: "0", totalAmount: "30.00", amountPaid: "0",
        lineItems: [{ itemName: item.name, quantity: "3", unit: "packet", conversionFactor: "0.333333", unitPrice: "10", taxPercent: "0", discountPercent: "0" }],
      },
    ] as never, { autoCreatePayments: false, defaultPaymentMode: "cash" });
    expect(await stockOf(item.id)).toBe("9.000"); // 10 - 0.999999 = 9.000001, kept to 3 decimals
  });

  it("many small lines add up exactly: 8 sales of 0.125 take a kilo, a purchase of 0.375 adds back: 10.000 -> 9.375", async () => {
    const db = getTenantTestDb();
    const party = await createParty(db, business.id, { name: "Import Customer C", type: "customer" });
    const item = await createItem(db, business.id, { name: "Cumin Import C", unit: "kg", stockQuantity: "10.000" });
    const sale = (n: number) => ({
      invoiceNumber: `IMP-C${n}`, type: "sale" as const, invoiceDate: new Date("2025-02-01"), partyName: party.name, status: "sent" as const,
      subtotal: "12.50", taxAmount: "0", discountAmount: "0", totalAmount: "12.50", amountPaid: "0",
      lineItems: [{ itemName: item.name, quantity: "0.125", unitPrice: "100", taxPercent: "0", discountPercent: "0" }],
    });
    const purchase = {
      invoiceNumber: "IMP-CP", type: "purchase" as const, invoiceDate: new Date("2025-02-01"), partyName: party.name, status: "sent" as const,
      subtotal: "37.50", taxAmount: "0", discountAmount: "0", totalAmount: "37.50", amountPaid: "0",
      lineItems: [{ itemName: item.name, quantity: "0.375", unitPrice: "100", taxPercent: "0", discountPercent: "0" }],
    };
    await runInvoicesImport(db as never, business.id, { id: owner.id, name: "Owner" }, "test", [1, 2, 3, 4, 5, 6, 7, 8].map(sale).concat([purchase as never]) as never, {
      autoCreatePayments: false, defaultPaymentMode: "cash",
    });
    expect(await stockOf(item.id)).toBe("9.375"); // 10 - 8 x 0.125 + 0.375
  });
});

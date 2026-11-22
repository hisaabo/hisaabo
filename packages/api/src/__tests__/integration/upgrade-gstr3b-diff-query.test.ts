/**
 * The read-only "which months change" query in docs/UPGRADING.md is executable: this runs the
 * query printed there against a scenario and checks it against both the corrected API figures
 * and the old rules' hand-computed numbers.
 *
 * August 2025, intra-state, 18% GST:
 *   sale invoice 10 x 1000 (tax 1800); credit note 2 x 1000 (360); sales return 1 x 1000 (180);
 *   sale debit note 1 x 500 (90)
 *       old output = 1800                        new output = 1800 - 360 - 180 + 90 = 1350
 *   purchase invoice 10 x 1000 (1800); purchase return 2 x 1000 (360); purchase debit note
 *   1 x 500 (90); credit note raised from a purchase invoice 1 x 1000 (180);
 *   a purchase QUOTATION 1 x 1000 (180, never a bill)
 *       old ITC = 1800 + 360 + 90 + 180 + 180 = 2610   new ITC = 1800 - 360 - 90 - 180 = 1170
 *   old net tax = 1800 - 2610 = -810 ; new net tax = 1350 - 1170 = 180 ; change = +990
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { getTenantTestDb } from "../helpers/test-db.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const UPGRADING = fileURLToPath(new URL("../../../../../docs/UPGRADING.md", import.meta.url));

function diffQuery(): string {
  return sqlAfter("<!-- gstr3b-diff-query -->");
}

function sqlAfter(markerText: string): string {
  const md = readFileSync(UPGRADING, "utf8");
  const marker = md.indexOf(markerText);
  expect(marker).toBeGreaterThan(-1);
  const open = md.indexOf("```sql", marker);
  const close = md.indexOf("```", open + 6);
  // strip the list indentation of the fenced block
  return md
    .slice(open + 6, close)
    .split("\n")
    .map((l) => l.replace(/^ {3}/, ""))
    .join("\n")
    .trim();
}

const line = (qty: string, price = "1000.00") => [{ name: "Goods", qty, price, tax: "18" }];

describe("docs/UPGRADING.md: the per-month GSTR-3B old-vs-new query", () => {
  let w: GoldenWorld;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = (await addParty(w, "customer", "MH")).id;
    const supplier = (await addParty(w, "supplier", "MH")).id;
    const d = (day: number) => `2025-08-${String(day).padStart(2, "0")}T10:00:00.000Z`;
    await addInvoice(w, "sale", customer, line("10"), { date: d(3) });
    await addAdjustmentDoc(w, "creditNote", "sale", customer, line("2"), { date: d(5) });
    await addAdjustmentDoc(w, "salesReturn", "sale", customer, line("1"), { date: d(6) });
    await addAdjustmentDoc(w, "debitNote", "sale", customer, line("1", "500.00"), { date: d(7) });
    await addInvoice(w, "purchase", supplier, line("10"), { date: d(4) });
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", supplier, line("2"), { date: d(8) });
    await addAdjustmentDoc(w, "debitNote", "purchase", supplier, line("1", "500.00"), { date: d(9) });
    await addAdjustmentDoc(w, "creditNote", "purchase", supplier, line("1"), { date: d(10) });
    await w.caller.quotation.create({
      partyId: supplier,
      type: "purchase",
      invoiceDate: d(11),
      lineItems: [{ itemName: "Quoted", quantity: "1", unitPrice: "1000.00", taxPercent: "18", discountPercent: "0" }],
    });
  });

  it("lists the month with the old and the corrected figures", async () => {
    const rows = (await getTenantTestDb().execute(
      sql.raw(`SELECT * FROM (${diffQuery()}) q WHERE business_id = '${w.businessId}'`),
    )) as unknown as Array<Record<string, string>>;
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.month).toBe("2025-08");
    expect([r.old_output, r.new_output, r.old_itc, r.new_itc].map((v) => Number(v))).toEqual([1800, 1350, 2610, 1170]);
    expect([r.old_net_tax, r.new_net_tax, r.change].map((v) => Number(v))).toEqual([-810, 180, 990]);
  });

  it("its corrected columns equal what GSTR-3B now reports", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 8 });
    const output = r.taxPayable.cgst + r.taxPayable.sgst + r.taxPayable.igst;
    const itc = r.itc.cgst + r.itc.sgst + r.itc.igst;
    expect(Math.round(output * 100)).toBe(135000);
    expect(Math.round(itc * 100)).toBe(117000);
    expect(Math.round(r.netTax.total * 100)).toBe(18000);
  });

  it("a business whose figures do not change is not listed", async () => {
    const w2 = await createGoldenWorld();
    const c = (await addParty(w2, "customer", "MH")).id;
    await addInvoice(w2, "sale", c, line("1"), { date: "2025-08-03T10:00:00.000Z" });
    const rows = (await getTenantTestDb().execute(
      sql.raw(`SELECT * FROM (${diffQuery()}) q WHERE business_id = '${w2.businessId}'`),
    )) as unknown as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe("docs/UPGRADING.md: the opening-balance review query and the per-party sign flip", () => {
  async function seed() {
    const w = await createGoldenWorld();
    const mk = (type: "customer" | "supplier", name: string, openingBalance: string) =>
      w.caller.party.create({ type, name, state: "Maharashtra", stateCode: "27", openingBalance });
    const supPos = await mk("supplier", "Supplier positive", "14000.00"); // typed as "we owe them" under 0.10.0
    await mk("supplier", "Supplier negative", "-3000.00"); // already the documented sign
    await mk("supplier", "Supplier zero", "0");
    await mk("customer", "Customer positive", "500.00"); // the usual direction
    const custNeg = await mk("customer", "Customer negative", "-200.00"); // an advance (or a sign typed the other way)
    return { w, supPos, custNeg };
  }

  it("lists suppliers with a positive and customers with a negative opening balance, and only them", async () => {
    const { w } = await seed();
    const rows = (await getTenantTestDb().execute(
      sql.raw(`SELECT * FROM (${sqlAfter("<!-- opening-balance-review-query -->")}) q WHERE business_id = '${w.businessId}'`),
    )) as unknown as Array<Record<string, string>>;
    expect(rows.map((r) => [r.party, r.opening_balance])).toEqual([
      ["Customer negative", "-200.00"],
      ["Supplier positive", "14000.00"],
    ]);
    expect(rows.map((r) => r.meaning_now)).toEqual([
      "negative: YOU now owe the customer this",
      "positive: the supplier now OWES YOU this",
    ]);
  });

  it("the optional flip statement flips exactly the party it names, and flipping twice restores it", async () => {
    const { w, supPos } = await seed();
    const flip = sqlAfter("<!-- opening-balance-flip -->")
      .replace("<party_id from the query>", supPos.id)
      .replace("<business_id from the query>", w.businessId);
    const db = getTenantTestDb();
    await db.execute(sql.raw(flip));
    expect((await w.caller.party.getById({ id: supPos.id }))?.openingBalance).toBe("-14000.00");
    // the other parties are untouched
    const list = await w.caller.party.list({ page: 1, limit: 50 });
    const seeded = list.data.filter((p) => /^(Customer|Supplier) /.test(p.name)); // not the walk-in party
    expect(seeded.map((p) => [p.name, p.openingBalance]).sort()).toEqual([
      ["Customer negative", "-200.00"],
      ["Customer positive", "500.00"],
      ["Supplier negative", "-3000.00"],
      ["Supplier positive", "-14000.00"],
      ["Supplier zero", "0.00"],
    ]);
    await db.execute(sql.raw(flip));
    expect((await w.caller.party.getById({ id: supPos.id }))?.openingBalance).toBe("14000.00");
  });
});

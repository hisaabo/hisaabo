/**
 * Scenario 24 — Every date a GST output prints is the IST day.
 *
 * The GSTR-1 portal JSON took the UTC date of an instant ("idt" / "nt_dt"): an invoice dated
 * 1 April 00:00 IST is stored as 2026-03-31T18:30Z, so it was filed as 31-03-2026, in the PREVIOUS
 * financial year and a day away from the date the IRN was registered under. All dates here are
 * IST-midnight instants (18:30 UTC of the day before); the old tests only used UTC midnight.
 *
 *   A  sale   2026-03-31T18:29:59.500Z  [31 Mar 23:59:59.500 IST]   JSON idt "31-03-2026" (GSTR-1 of Mar 2026)
 *   B  sale   2026-03-31T18:30:00.000Z  [ 1 Apr 00:00:00.000 IST]   JSON idt "01-04-2026" (GSTR-1 of Apr 2026)
 *   N  credit note 2026-10-31T18:30:00.000Z [1 Nov 00:00 IST]       JSON nt_dt "01-11-2026" (GSTR-1 of Nov 2026)
 * The GSTR-1 CSV prints B as "1/4/2026" (en-IN, IST); the party statement CSV as "01/04/2026" and
 * its file name carries the IST day of the range start (ledger_<party>_2026-04-01.csv, not 03-31).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { resolveDatePreset, windowToQuery } from "@hisaabo/shared";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, addAdjustmentDoc, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const A = "2026-03-31T18:29:59.500Z";
const B = "2026-03-31T18:30:00.000Z";
const N = "2026-10-31T18:30:00.000Z";

describe("golden 24: GSTR-1 JSON, CSV and statement dates are IST days", () => {
  let w: GoldenWorld;
  let partyId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const item = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "pcs", taxPercent: "18" })).id;
    partyId = (await w.caller.party.create({
      type: "customer", name: "Date Buyer", state: "Maharashtra", stateCode: "27", gstin: "27AABCM0000R1ZM", openingBalance: "0",
    })).id;
    const line = (price: string) => [{ name: "Steel Rods", itemId: item, qty: "1", price, tax: "18" }];
    await addInvoice(w, "sale", partyId, line("1000.00"), { date: A });
    await addInvoice(w, "sale", partyId, line("2000.00"), { date: B });
    await addAdjustmentDoc(w, "creditNote", "sale", partyId, line("500.00"), { date: N });
  });

  type B2b = Array<{ ctin: string; inv: Array<{ inum: string; idt: string }> }>;
  type Cdnr = Array<{ ctin: string; nt: Array<{ ntty: string; nt_num: string; nt_dt: string }> }>;

  it("an invoice of 31 March 23:59:59.500 IST is 31-03-2026 and sits in the March return", async () => {
    const r = await w.caller.gst.gstr1Json({ year: 2026, month: 3 });
    const b2b = (r.json as { b2b: B2b }).b2b;
    expect(b2b.map((c) => c.inv.map((i) => i.idt))).toEqual([["31-03-2026"]]);
  });

  it("an invoice of 1 April 00:00:00.000 IST (stored 31 March 18:30 UTC) is 01-04-2026 and sits in the April return", async () => {
    const r = await w.caller.gst.gstr1Json({ year: 2026, month: 4 });
    const b2b = (r.json as { b2b: B2b }).b2b;
    expect(b2b.map((c) => c.inv.map((i) => i.idt))).toEqual([["01-04-2026"]]);
  });

  it("a credit note of 1 November 00:00 IST is 01-11-2026", async () => {
    const r = await w.caller.gst.gstr1Json({ year: 2026, month: 11 });
    const cdnr = (r.json as { cdnr: Cdnr }).cdnr;
    expect(cdnr.map((c) => c.nt.map((n) => [n.ntty, n.nt_dt]))).toEqual([[["C", "01-11-2026"]]]);
  });

  it("the GSTR-1 CSV prints the IST day (en-IN: 1/4/2026), not 31/3/2026", async () => {
    const r = await w.caller.gst.gstr1CSV({ year: 2026, month: 4 });
    expect(r.csv).toContain('"1/4/2026"');
    expect(r.csv).not.toContain("31/3/2026");
  });

  it("the party statement CSV prints 01/04/2026 and names the file with the IST day of the range start", async () => {
    const r = (await w.caller.party.ledgerReportCSV({ partyId, fromDate: B, limit: 100 }))!;
    expect(r.filename).toBe("ledger_Date_Buyer_2026-04-01.csv");
    expect(r.csv).toContain("01/04/2026");
    expect(r.csv).not.toContain("31/03/2026");
  });
});

/**
 * A period filter is half-open: a stored timestamp with MICROSECONDS in the last millisecond of the
 * range (2026-11-30T18:29:59.999500Z = 23:59:59.9995 IST on 30 Nov) is in November and in no other
 * period. `<= ...59.999` dropped it from November while December (`>= ...18:30:00.000`) did not take it.
 */
describe("golden 24: the upper bound takes a timestamp with microseconds", () => {
  it("23:59:59.9995 IST on 30 November is listed by the November range", async () => {
    const w2 = await createGoldenWorld();
    const party = (await w2.caller.party.create({ type: "customer", name: "Micro Buyer", state: "Maharashtra", stateCode: "27", openingBalance: "0" })).id;
    const inv = await addInvoice(w2, "sale", party, [{ name: "Goods", qty: "1", price: "10.00", tax: "0" }], { date: "2026-11-15T10:00:00.000Z" });
    await getTenantTestDb().execute(sql`UPDATE invoices SET invoice_date = '2026-11-30T18:29:59.999500Z'::timestamptz WHERE id = ${inv.id}`);

    const nov = windowToQuery(resolveDatePreset("this-month", new Date("2026-11-15T09:00:00.000Z")));
    expect(nov.toDate).toBe("2026-11-30T18:29:59.999Z");
    const inNov = await w2.caller.invoice.list({ ...nov, page: 1, limit: 10 });
    expect(inNov.data.map((i) => i.id)).toEqual([inv.id]);

    const dec = windowToQuery(resolveDatePreset("this-month", new Date("2026-12-15T09:00:00.000Z")));
    const inDec = await w2.caller.invoice.list({ ...dec, page: 1, limit: 10 });
    expect(inDec.data).toEqual([]);
  });
});

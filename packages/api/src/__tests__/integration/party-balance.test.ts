/**
 * Party balance surfaces agree: party.getById, party.list, party.ledger,
 * party.ledgerReport (+ CSV) and reports.partyStatement all follow the same
 * document-type rules (lib/party-balance.ts). Hand-computed; goes beyond the
 * golden scenarios 05B / 10 / 13.
 *
 * ONE sign convention, the documented one (see party-balance.ts and the MCP /
 * WebMCP text): every balance is SIGNED, debit minus credit. Positive = they owe
 * you, negative = you owe them, for customers AND suppliers. The opening balance
 * is used as stored (a supplier you owe 2000 is entered as -2000).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getTenantTestDb } from "../helpers/test-db.js";
import { buildPartyLedgerStatement } from "../../lib/party-ledger.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addAdjustmentDoc,
  addPayment,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const D = (day: number) => `2025-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const GOODS = (qty: string, price = "1000.00", tax = "18") => [{ name: "Goods", qty, price, tax }];

async function balances(w: GoldenWorld, partyId: string, type: "customer" | "supplier") {
  const byId = (await w.caller.party.getById({ id: partyId }))?.balance;
  const list = await w.caller.party.list({ type, page: 1, limit: 50 });
  const inList = list.data.find((p) => p.id === partyId)?.balance;
  const report = (await w.caller.party.ledgerReport({ partyId }))?.summary.closingBalance;
  const tab = await w.caller.party.ledger({ partyId });
  const statement = (await w.caller.reports.partyStatement({ partyId }))?.summary.closingBalance;
  return { byId, inList, report, tabClosing: tab.data.at(-1)?.runningBalance, statement };
}

describe("party balance ignores documents that never post", () => {
  let w: GoldenWorld;
  let customerId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    customerId = (await addParty(w, "customer", "MH")).id;
    await addInvoice(w, "sale", customerId, GOODS("5", "1000.00", "0"), { date: D(3) }); // 5000.00
    const common = { partyId: customerId, type: "sale" as const, invoiceDate: D(4) };
    const lineItems = [{ itemName: "X", quantity: "1", unitPrice: "70000.00", taxPercent: "0", discountPercent: "0" }];
    await w.caller.quotation.create({ ...common, lineItems });
    await w.caller.proforma.create({ ...common, lineItems });
    await w.caller.deliveryChallan.create({ ...common, lineItems });
  });

  it("getById, list and the ledgers all say 5000.00 (not 215000.00)", async () => {
    const b = await balances(w, customerId, "customer");
    expect(b.byId).toBe("5000.00");
    expect(b.inList).toBe("5000.00");
    expect(b.report).toBe("5000.00");
    expect(b.tabClosing).toBe("5000.00");
  });

  it("the 'outstanding' list filter agrees", async () => {
    const out = await w.caller.party.list({ filter: "outstanding", page: 1, limit: 50 });
    expect(out.data.map((p) => p.id)).toContain(customerId);
  });

  it("a customer with only non-posting documents is not 'outstanding'", async () => {
    const w2 = await createGoldenWorld();
    const c = (await addParty(w2, "customer", "MH")).id;
    await w2.caller.quotation.create({
      partyId: c,
      type: "sale",
      invoiceDate: D(4),
      lineItems: [{ itemName: "X", quantity: "1", unitPrice: "900.00", taxPercent: "0", discountPercent: "0" }],
    });
    const out = await w2.caller.party.list({ filter: "outstanding", page: 1, limit: 50 });
    expect(out.data.map((p) => p.id)).not.toContain(c);
    expect((await w2.caller.party.getById({ id: c }))?.balance).toBe("0.00");
  });
});

describe("a supplier we owe: purchase, purchase return, purchase-side debit note, payment made", () => {
  let w: GoldenWorld;
  let supplierId: string;

  beforeAll(async () => {
    w = await createGoldenWorld();
    // We owe this supplier 2000 from before Hisaabo: negative, "you owe them".
    supplierId = (await addParty(w, "supplier", "MH", { openingBalance: "-2000.00" })).id;
    const purchase = await addInvoice(w, "purchase", supplierId, GOODS("10"), { date: D(3) }); // 11800.00
    await addAdjustmentDoc(w, "purchaseReturn", "purchase", supplierId, GOODS("2"), { date: D(10) }); // 2360.00
    await addAdjustmentDoc(w, "debitNote", "purchase", supplierId, GOODS("1", "500.00"), { date: D(12) }); // 590.00
    await addPayment(w, { partyId: supplierId, invoiceId: purchase.id, amount: "5000.00", mode: "cash", date: D(15) });
  });

  it("balance is -5850.00 on every surface: -2000 opening - (11800 - 5000 paid) + 2360 + 590", async () => {
    // The purchase is a credit (we owe more): -(11800 - 5000 paid) = -6800 still unpaid; the
    // purchase return (+2360) and the purchase-side debit note (+590) are debits (we owe less).
    const b = await balances(w, supplierId, "supplier");
    expect(b.byId).toBe("-5850.00");
    expect(b.inList).toBe("-5850.00");
    // The statements add the payment as its own debit row (+5000) instead of netting it
    // against the invoice: -2000 - 11800 + 2360 + 590 + 5000 = -5850. Same number.
    expect(b.report).toBe("-5850.00");
    expect(b.tabClosing).toBe("-5850.00");
  });

  it("the 'outstanding' filter keeps a supplier we owe (balance not zero), and drops one that is settled", async () => {
    const out = await w.caller.party.list({ filter: "outstanding", page: 1, limit: 50 });
    expect(out.data.map((p) => p.id)).toContain(supplierId);

    const w2 = await createGoldenWorld();
    const settled = (await addParty(w2, "supplier", "MH")).id;
    const purchase = await addInvoice(w2, "purchase", settled, GOODS("1"), { date: D(3) }); // 1180.00
    await addPayment(w2, { partyId: settled, invoiceId: purchase.id, amount: "1180.00", mode: "cash", date: D(4) });
    const out2 = await w2.caller.party.list({ filter: "outstanding", page: 1, limit: 50 });
    expect(out2.data.map((p) => p.id)).not.toContain(settled);
  });

  it("the dashboard payable card is the positive mirror: 5850.00 owed to suppliers", async () => {
    // 6800 unpaid on the purchase - 2360 purchase return - 590 debit note + 2000 opening owed
    expect((await w.caller.dashboard.summary()).payable).toBe("5850.00");
  });

  it("the ledger report rows: purchase credit, return and debit note debit, payment debit, opening -2000", async () => {
    const r = await w.caller.party.ledgerReport({ partyId: supplierId });
    expect(r?.entries.map((e) => [e.description, e.debit, e.credit, e.runningBalance])).toEqual([
      ["Purchase Invoice", "0", "11800.00", "-13800.00"],
      ["Purchase Return", "2360.00", "0", "-11440.00"],
      ["Debit Note", "590.00", "0", "-10850.00"],
      ["Payment (cash)", "5000.00", "0", "-5850.00"],
    ]);
    expect(r?.summary).toEqual({ totalDebit: "7950.00", totalCredit: "11800.00", closingBalance: "-5850.00" });
  });

  it("the CSV ledger starts from the opening balance as stored (-2000)", async () => {
    const csv = (await w.caller.party.ledgerReportCSV({ partyId: supplierId }))?.csv ?? "";
    const lines = csv.split("\n");
    expect(lines[1]).toMatch(/"Opening Balance","","","","-2000\.00"$/);
    expect(lines.at(-1)).toMatch(/-5850\.00"$/);
  });

  it("the party statement report and the ledger PDF statement start from the same opening (-2000)", async () => {
    // These two list invoices and payments only (no returns / notes): opening -2000,
    // purchase -11800, payment +5000 = -8800.
    const st = await w.caller.reports.partyStatement({ partyId: supplierId });
    expect(st?.summary.closingBalance).toBe("-8800.00");
    expect(st?.summary.isDebit).toBe(false);

    const db = getTenantTestDb() as unknown as Parameters<typeof buildPartyLedgerStatement>[0];
    const pdf = await buildPartyLedgerStatement(db, w.businessId, {
      id: supplierId,
      type: "supplier",
      openingBalance: "-2000.00",
    });
    expect(pdf.entries[0]?.runningBalance).toBe("-13800.00");
    expect(pdf.summary.closingBalance).toBe("-8800.00");
  });

  it("a deleted payment leaves the ledger tab and re-opens the payable", async () => {
    const w2 = await createGoldenWorld();
    const s = (await addParty(w2, "supplier", "MH")).id;
    const purchase = await addInvoice(w2, "purchase", s, GOODS("10"), { date: D(3) });
    const pay = await addPayment(w2, { partyId: s, invoiceId: purchase.id, amount: "5000.00", mode: "cash", date: D(15) });
    expect((await w2.caller.party.ledger({ partyId: s })).data.at(-1)?.runningBalance).toBe("-6800.00");
    await w2.caller.payment.delete({ id: pay.id });
    expect((await w2.caller.party.ledger({ partyId: s })).data.at(-1)?.runningBalance).toBe("-11800.00");
    expect((await w2.caller.party.getById({ id: s }))?.balance).toBe("-11800.00");
  });
});

describe("a customer: sale, credit note, sale debit note, receipt, opening balance", () => {
  it("balance 1000 opening + 11800 - 2360 + 590 - 3000 received = 8030.00, statements agree", async () => {
    const w = await createGoldenWorld();
    const c = (await addParty(w, "customer", "MH", { openingBalance: "1000.00" })).id;
    const sale = await addInvoice(w, "sale", c, GOODS("10"), { date: D(3) });
    await addAdjustmentDoc(w, "creditNote", "sale", c, GOODS("2"), { date: D(10) });
    await addAdjustmentDoc(w, "debitNote", "sale", c, GOODS("1", "500.00"), { date: D(12) });
    await addPayment(w, { partyId: c, invoiceId: sale.id, amount: "3000.00", mode: "cash", date: D(15) });

    const b = await balances(w, c, "customer");
    expect(b.byId).toBe("8030.00");
    expect(b.inList).toBe("8030.00");
    expect(b.report).toBe("8030.00");
    expect(b.tabClosing).toBe("8030.00");
  });
});

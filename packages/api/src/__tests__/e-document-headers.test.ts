/**
 * The HEADER of the e-invoice (IRP ValDtls) and of the e-way bill, and the per-item rules.
 *
 * NIC e-invoice schema:
 *   item:    AssAmt = TotAmt - Discount            TotItemVal = AssAmt + CgstAmt + SgstAmt + IgstAmt + CesAmt + OthChrg
 *   header:  TotInvVal = AssVal + CgstVal + SgstVal + IgstVal + CesVal + StCesVal + OthChrg - Discount + RndOffAmt
 * where the header Discount is the INVOICE-LEVEL discount only: line discounts are already netted into each AssAmt, so the
 * header used to subtract them a second time (it carried the SUM of the line discounts) and TotInvVal missed the stored
 * invoice total whenever a line was discounted.
 *
 * E-way bill: totInvValue = totalValue + cgstValue + sgstValue + igstValue + cessValue + otherValue, with otherValue =
 * additional charges + round-off - invoice-level discount (it may be negative).
 *
 * Every expected value is a hand-computed literal with the arithmetic beside it; the invariants are also swept over
 * thousands of generated invoices built with the server's own line maths.
 */
import { describe, it, expect } from "vitest";
import { calcLineItem } from "@hisaabo/shared";
import {
  EInvoicePayloadError, mapInvoiceToIRP, type IRPBusiness, type IRPInvoice, type IRPLineItem, type IRPParty,
} from "../lib/invoice-to-irp.js";
import {
  EWBPayloadError, mapInvoiceToEWB, type InvoiceForEWB, type LineItemForEWB, type TransportDetails,
} from "../lib/invoice-to-ewb.js";
import { priceStoreOrderLines } from "../lib/store-order-pricing.js";

const business: IRPBusiness = {
  gstin: "27AAAAA0000A1Z5", legalName: "Seller Pvt Ltd", name: "Seller", address: "1 Road", city: "Mumbai", state: "Maharashtra",
  stateCode: "27", pincode: "400001", phone: null, email: null,
};
const buyerMH: IRPParty = {
  gstin: "27BBBBB1111B1Z5", name: "Buyer MH", billingAddress: "2 Lane", city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411001", phone: null, email: null,
};
const buyerKA: IRPParty = { ...buyerMH, gstin: "29CCCCC2222C1Z5", name: "Buyer KA", state: "Karnataka", stateCode: "29", city: "Bengaluru", pincode: "560001" };
const DATE = new Date("2025-06-10T10:00:00.000Z");
const transport: TransportDetails = { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 20 };

interface Stored {
  subtotal: string; taxAmount: string; discountAmount: string | null; additionalCharges: string | null; roundOff: string | null; totalAmount: string;
}
type Row = Pick<IRPLineItem, "itemName" | "quantity" | "unitPrice" | "taxPercent" | "taxAmount" | "discountPercent" | "totalAmount">;

const irpInvoice = (h: Stored): IRPInvoice => ({
  invoiceNumber: "INV-00001", invoiceDate: DATE, type: "sale", documentType: "invoice", isReverseCharge: false, ...h,
});
const irpLines = (rows: Row[]): IRPLineItem[] => rows.map((r) => ({ description: null, selectedUnit: null, ...r }));

function ewbOf(h: Stored, rows: Row[], intra = true) {
  const invoice: InvoiceForEWB = {
    id: "i1", invoiceNumber: "INV-00001", invoiceDate: DATE, type: "sale", documentType: "invoice", isReverseCharge: false, ...h,
    partyGstin: buyerMH.gstin, partyName: "Buyer", partyAddress: "2 Lane", partyCity: "Pune", partyPincode: "411001", partyStateCode: intra ? "27" : "29",
    businessGstin: business.gstin, businessName: "Seller", businessAddress: "1 Road", businessCity: "Mumbai", businessPincode: "400001", businessStateCode: "27",
  };
  const lines: LineItemForEWB[] = rows.map((r) => ({
    itemName: r.itemName, description: null, quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: r.taxPercent,
    taxAmount: r.taxAmount, totalAmount: r.totalAmount, hsn: "8517", unit: "pcs", itemType: "product",
  }));
  return mapInvoiceToEWB(invoice, lines, transport);
}

/** paise sum for comparing payload numbers in the test (no arithmetic on money elsewhere) */
const p = (x: number) => Math.round(x * 100);

// ── Hand-computed stored invoices ────────────────────────────────────────────────────────────────────────────────
//   L1  3 x 99.99 @ 12%, 10% line discount:  gross 299.97, discount 29.997 -> 30.00, taxable 269.97, GST 32.3964 -> 32.40 (16.20 + 16.20), total 302.37
//   L2  2 x 500.00 @ 18%:                    taxable 1000.00, GST 180.00 (90.00 + 90.00), total 1180.00
//   L3  1 x 99.99 @ 5%:                      taxable 99.99, GST 4.9995 -> 5.00 (2.50 + 2.50), total 104.99
const L1: Row = { itemName: "Gadget", quantity: "3", unitPrice: "99.99", taxPercent: "12", taxAmount: "32.40", discountPercent: "10", totalAmount: "302.37" };
const L2: Row = { itemName: "Cable", quantity: "2", unitPrice: "500.00", taxPercent: "18", taxAmount: "180.00", discountPercent: "0", totalAmount: "1180.00" };
const L3: Row = { itemName: "Pen", quantity: "1", unitPrice: "99.99", taxPercent: "5", taxAmount: "5.00", discountPercent: "0", totalAmount: "104.99" };

describe("IRP header: ValDtls.Discount is the invoice-level discount only", () => {
  it("A. a LINE discount only: Discount 0 (it was 30.00), TotInvVal 302.37 = 269.97 + 16.20 + 16.20", () => {
    const h: Stored = { subtotal: "269.97", taxAmount: "32.40", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "302.37" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L1]), buyerMH, business).ValDtls;
    expect(v).toMatchObject({ AssVal: 269.97, CgstVal: 16.2, SgstVal: 16.2, IgstVal: 0, Discount: 0, TotInvVal: 302.37 });
    expect(v.OthChrg).toBeUndefined();
    expect(v.RndOffAmt).toBeUndefined();
  });

  it("B. an INVOICE discount only (50.00 off 1000.00 + 180.00 GST): Discount 50, TotInvVal 1130.00", () => {
    // L2 alone: taxable 1000.00, GST 180.00; invoice discount 50.00; total 1000.00 + 180.00 - 50.00 = 1130.00
    const h: Stored = { subtotal: "1000.00", taxAmount: "180.00", discountAmount: "50.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "1130.00" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L2]), buyerMH, business).ValDtls;
    expect(v).toMatchObject({ AssVal: 1000, CgstVal: 90, SgstVal: 90, Discount: 50, TotInvVal: 1130 });
  });

  it("C. BOTH: a line discount (30.00, inside AssVal) and a 10% invoice discount (127.00): Discount 127, TotInvVal 1355.37", () => {
    // L1 + L2: subtotal 269.97 + 1000.00 = 1269.97 ; GST 32.40 + 180.00 = 212.40
    // invoice discount 10% of 1269.97 = 126.997 -> 127.00 ; total 1269.97 + 212.40 - 127.00 = 1355.37
    const h: Stored = { subtotal: "1269.97", taxAmount: "212.40", discountAmount: "127.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "1355.37" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L1, L2]), buyerMH, business).ValDtls;
    expect(v).toMatchObject({ AssVal: 1269.97, CgstVal: 106.2, SgstVal: 106.2, IgstVal: 0, Discount: 127, TotInvVal: 1355.37 }); // 16.20 + 90.00 = 106.20 each
  });

  it("D. charges + round-off: OthChrg 50.00, RndOffAmt +0.01, TotInvVal 155.00 = 99.99 + 5.00 + 50.00 + 0.01", () => {
    const h: Stored = { subtotal: "99.99", taxAmount: "5.00", discountAmount: "0.00", additionalCharges: "50.00", roundOff: "0.01", totalAmount: "155.00" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L3]), buyerMH, business).ValDtls;
    expect(v).toMatchObject({ AssVal: 99.99, CgstVal: 2.5, SgstVal: 2.5, Discount: 0, OthChrg: 50, RndOffAmt: 0.01, TotInvVal: 155 });
  });

  it("D'. a negative round-off: RndOffAmt -0.01, TotInvVal 154.98", () => {
    const h: Stored = { subtotal: "99.99", taxAmount: "5.00", discountAmount: "0.00", additionalCharges: "50.00", roundOff: "-0.01", totalAmount: "154.98" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L3]), buyerMH, business).ValDtls;
    expect(v).toMatchObject({ OthChrg: 50, RndOffAmt: -0.01, TotInvVal: 154.98 });
  });

  it("D''. everything at once, inter-state: line discount, invoice discount 127.00, charges 50.00, round-off -0.37", () => {
    // L1 + L2 as in C (IGST 212.40), discount 127.00, charges 50.00, round-off -0.37: 1269.97 + 212.40 - 127.00 + 50.00 - 0.37 = 1405.00
    const h: Stored = { subtotal: "1269.97", taxAmount: "212.40", discountAmount: "127.00", additionalCharges: "50.00", roundOff: "-0.37", totalAmount: "1405.00" };
    const v = mapInvoiceToIRP(irpInvoice(h), irpLines([L1, L2]), buyerKA, business).ValDtls;
    expect(v).toMatchObject({ AssVal: 1269.97, CgstVal: 0, SgstVal: 0, IgstVal: 212.4, Discount: 127, OthChrg: 50, RndOffAmt: -0.37, TotInvVal: 1405 });
  });

  it("E. the store order 3 x 99.00 incl. 18%: item Discount 0.01 (the residue), header Discount 0 and TotInvVal 297.00", () => {
    const priced = priceStoreOrderLines([{ itemId: "n", name: "Notebook", quantity: "3", unitPrice: "99.00", taxPercent: "18.00", taxInclusive: true, discountPercent: "0" }]);
    // stored: rate 83.90, tax 45.31, total 297.00 ; header subtotal 251.69, tax 45.31, total 297.00
    const rows: Row[] = priced.rows.map((r) => ({ itemName: r.itemName, quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: r.taxPercent, taxAmount: r.taxAmount, discountPercent: r.discountPercent, totalAmount: r.totalAmount }));
    const h: Stored = { subtotal: "251.69", taxAmount: "45.31", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "297.00" };
    const irp = mapInvoiceToIRP(irpInvoice(h), irpLines(rows), buyerMH, business);
    expect(irp.ItemList[0]).toMatchObject({ AssAmt: 251.69, Discount: 0.01 }); // 251.70 - 0.01
    expect(irp.ValDtls).toMatchObject({ AssVal: 251.69, CgstVal: 22.66, SgstVal: 22.65, Discount: 0, TotInvVal: 297 }); // before: Discount 0.01 and 296.99 by the formula
  });
});

describe("IRP header invariant: a payload that does not add up to the stored total is refused", () => {
  const good: Stored = { subtotal: "269.97", taxAmount: "32.40", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "302.37" };

  it("the stored total off by a paisa -> EInvoicePayloadError, with the figures in the message", () => {
    const run = () => mapInvoiceToIRP(irpInvoice({ ...good, totalAmount: "302.38" }), irpLines([L1]), buyerMH, business);
    expect(run).toThrow(EInvoicePayloadError);
    expect(run).toThrow(/AssVal 269\.97 \+ GST 32\.40 \+ OthChrg 0\.00 - Discount 0\.00 \+ RndOffAmt 0\.00 = 302\.37, but the stored total is 302\.38/);
    expect(run).toThrow(/not sent to the IRP/);
  });

  it("an invoice discount missing from the header (stored total 1130.00 but discount_amount 0) is refused", () => {
    const h: Stored = { subtotal: "1000.00", taxAmount: "180.00", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "1130.00" };
    expect(() => mapInvoiceToIRP(irpInvoice(h), irpLines([L2]), buyerMH, business)).toThrow(EInvoicePayloadError);
  });

  it("a line that does not belong to the stored header (a second line added) is refused", () => {
    expect(() => mapInvoiceToIRP(irpInvoice(good), irpLines([L1, L3]), buyerMH, business)).toThrow(EInvoicePayloadError);
  });

  it("null discount / charges / round-off read as zero", () => {
    const h: Stored = { subtotal: "269.97", taxAmount: "32.40", discountAmount: null, additionalCharges: null, roundOff: null, totalAmount: "302.37" };
    expect(mapInvoiceToIRP(irpInvoice(h), irpLines([L1]), buyerMH, business).ValDtls.TotInvVal).toBe(302.37);
  });
});

describe("e-way bill header: totalValue, otherValue and totInvValue add up to the stored total", () => {
  it("A. a line discount only: totalValue 269.97, otherValue 0, totInvValue 302.37", () => {
    const e = ewbOf({ subtotal: "269.97", taxAmount: "32.40", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "302.37" }, [L1]);
    expect([e.totalValue, e.cgstValue, e.sgstValue, e.igstValue, e.cessValue, e.otherValue, e.totInvValue]).toEqual([269.97, 16.2, 16.2, 0, 0, 0, 302.37]);
  });

  it("B. an invoice discount only: otherValue -50.00, totInvValue 1130.00 (1000.00 + 90.00 + 90.00 - 50.00)", () => {
    const e = ewbOf({ subtotal: "1000.00", taxAmount: "180.00", discountAmount: "50.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "1130.00" }, [L2]);
    expect([e.totalValue, e.cgstValue, e.sgstValue, e.otherValue, e.totInvValue]).toEqual([1000, 90, 90, -50, 1130]);
  });

  it("C. both: totalValue 1269.97, otherValue -127.00, totInvValue 1355.37", () => {
    const e = ewbOf({ subtotal: "1269.97", taxAmount: "212.40", discountAmount: "127.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "1355.37" }, [L1, L2]);
    expect([e.totalValue, e.cgstValue, e.sgstValue, e.otherValue, e.totInvValue]).toEqual([1269.97, 106.2, 106.2, -127, 1355.37]);
  });

  it("D. charges + round-off: otherValue 50.01 (50.00 + 0.01), totInvValue 155.00; round-off -0.01 -> 49.99 and 154.98", () => {
    const a = ewbOf({ subtotal: "99.99", taxAmount: "5.00", discountAmount: "0.00", additionalCharges: "50.00", roundOff: "0.01", totalAmount: "155.00" }, [L3]);
    expect([a.totalValue, a.cgstValue, a.sgstValue, a.otherValue, a.totInvValue]).toEqual([99.99, 2.5, 2.5, 50.01, 155]);
    const b = ewbOf({ subtotal: "99.99", taxAmount: "5.00", discountAmount: "0.00", additionalCharges: "50.00", roundOff: "-0.01", totalAmount: "154.98" }, [L3]);
    expect([b.otherValue, b.totInvValue]).toEqual([49.99, 154.98]);
  });

  it("D''. everything at once, inter-state: IGST 212.40, otherValue -77.37 (50.00 - 0.37 - 127.00), totInvValue 1405.00", () => {
    const e = ewbOf({ subtotal: "1269.97", taxAmount: "212.40", discountAmount: "127.00", additionalCharges: "50.00", roundOff: "-0.37", totalAmount: "1405.00" }, [L1, L2], false);
    expect([e.totalValue, e.cgstValue, e.sgstValue, e.igstValue, e.otherValue, e.totInvValue]).toEqual([1269.97, 0, 0, 212.4, -77.37, 1405]);
  });

  it("E. the store order 3 x 99.00 incl. 18%: totalValue 251.69, tax 22.66 + 22.65, otherValue 0, totInvValue 297.00", () => {
    const priced = priceStoreOrderLines([{ itemId: "n", name: "Notebook", quantity: "3", unitPrice: "99.00", taxPercent: "18.00", taxInclusive: true, discountPercent: "0" }]);
    const rows: Row[] = priced.rows.map((r) => ({ itemName: r.itemName, quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: r.taxPercent, taxAmount: r.taxAmount, discountPercent: r.discountPercent, totalAmount: r.totalAmount }));
    const e = ewbOf({ subtotal: "251.69", taxAmount: "45.31", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "297.00" }, rows);
    expect([e.totalValue, e.cgstValue, e.sgstValue, e.otherValue, e.totInvValue]).toEqual([251.69, 22.66, 22.65, 0, 297]);
  });

  it("an e-way bill that does not add up to the stored total is refused with EWBPayloadError", () => {
    const h = { subtotal: "269.97", taxAmount: "32.40", discountAmount: "0.00", additionalCharges: "0.00", roundOff: "0.00", totalAmount: "302.38" };
    expect(() => ewbOf(h, [L1])).toThrow(EWBPayloadError);
    expect(() => ewbOf(h, [L1])).toThrow(/totalValue 269\.97 \+ GST 32\.40 \+ otherValue 0\.00 = 302\.37, but the stored total is 302\.38/);
  });

  it("an invoice without the optional header fields (older callers) reads them as zero", () => {
    const e = ewbOf({ subtotal: "269.97", taxAmount: "32.40", totalAmount: "302.37" } as Stored, [L1]);
    expect([e.otherValue, e.totInvValue]).toEqual([0, 302.37]);
  });
});

// ── Per-item rules and the whole-invoice invariant, over generated invoices ──────────────────────────────────────

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
const money2 = (r: () => number, maxRupees: number) => {
  const paise = 1 + Math.floor(r() * maxRupees * 100);
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
};

/** integer paise of a stored 2-dp amount string ("-12.05" -> -1205), without float arithmetic */
const toP = (s: string) => Number(s.replace(".", ""));
const fmtP = (v: bigint) => `${v < 0n ? "-" : ""}${(v < 0n ? -v : v) / 100n}.${String((v < 0n ? -v : v) % 100n).padStart(2, "0")}`;

describe("per-item NIC rules hold for every generated line, and every generated invoice adds up", () => {
  const GST = ["0", "5", "12", "18", "28", "40"] as const;
  const QTY = ["1", "2", "3", "7", "10", "0.5", "1.25", "0.125", "2.375", "12.5"] as const;
  const DISC = ["0", "0", "5", "10", "12.5", "25"] as const;

  it("3,000 invoices of 1-6 lines (a quarter of the lines store-priced inclusive), with invoice discount, charges and round-off", () => {
    const r = rng(20250610);
    for (let n = 0; n < 3000; n++) {
      const rows: Row[] = [];
      const count = 1 + Math.floor(r() * 6);
      for (let i = 0; i < count; i++) {
        const quantity = pick(r, QTY);
        const taxPercent = pick(r, GST);
        const discountPercent = pick(r, DISC);
        if (r() < 0.25) {
          // an online-store line of a tax-inclusive price: the stored rate is exclusive, the amounts are the exact inclusive ones
          const row = priceStoreOrderLines([{ itemId: "x", name: "S", quantity, unitPrice: money2(r, 500), taxPercent, taxInclusive: true, discountPercent }]).rows[0]!;
          rows.push({ itemName: "S", quantity, unitPrice: row.unitPrice, taxPercent, taxAmount: row.taxAmount, discountPercent, totalAmount: row.totalAmount });
        } else {
          // an ordinary bill line, stored as the server stores it
          const unitPrice = money2(r, 800);
          const line = calcLineItem({ quantity, unitPrice, taxPercent, discountPercent });
          rows.push({ itemName: "E", quantity, unitPrice, taxPercent, taxAmount: line.taxAmount, discountPercent, totalAmount: line.total });
        }
      }
      // the header as the server stores it: subtotal = sum of taxable (total - tax), tax = sum of line tax,
      // total = subtotal + tax - invoice discount + charges + round-off
      const subtotalPaise = rows.reduce((s, x) => s + BigInt(toP(x.totalAmount) - toP(x.taxAmount)), 0n);
      const taxPaise = rows.reduce((s, x) => s + BigInt(toP(x.taxAmount)), 0n);
      const discountPaise = r() < 0.25 ? BigInt(Math.floor(r() * Number(subtotalPaise) * 0.2)) : 0n;
      const chargesPaise = r() < 0.33 ? BigInt(Math.floor(r() * 20000)) : 0n;
      const roundOffPaise = r() < 0.33 ? BigInt(Math.floor(r() * 199) - 99) : 0n;
      const totalPaise = subtotalPaise + taxPaise - discountPaise + chargesPaise + roundOffPaise;
      const h: Stored = {
        subtotal: fmtP(subtotalPaise), taxAmount: fmtP(taxPaise), discountAmount: fmtP(discountPaise),
        additionalCharges: fmtP(chargesPaise), roundOff: fmtP(roundOffPaise), totalAmount: fmtP(totalPaise),
      };

      for (const buyer of [buyerMH, buyerKA]) {
        const irp = mapInvoiceToIRP(irpInvoice(h), irpLines(rows), buyer, business);
        // per item: AssAmt = TotAmt - Discount, TotItemVal = AssAmt + GST (no cess, no item OthChrg), and the stored amounts
        irp.ItemList.forEach((it, i) => {
          const tag = `invoice ${n} item ${i} ${JSON.stringify(rows[i])}`;
          expect(p(it.AssAmt), tag).toBe(p(it.TotAmt) - p(it.Discount));
          expect(it.Discount, tag).toBeGreaterThanOrEqual(0);
          expect(p(it.TotItemVal), tag).toBe(p(it.AssAmt) + p(it.CgstAmt) + p(it.SgstAmt) + p(it.IgstAmt));
          expect(p(it.CgstAmt) + p(it.SgstAmt) + p(it.IgstAmt), tag).toBe(toP(rows[i]!.taxAmount));
          expect(p(it.TotItemVal), tag).toBe(toP(rows[i]!.totalAmount));
          expect(p(it.AssAmt), tag).toBe(toP(rows[i]!.totalAmount) - toP(rows[i]!.taxAmount));
          expect(Object.keys(it)).not.toContain("OthChrg");
          expect(Object.keys(it)).not.toContain("CesAmt");
        });
        // header: the NIC formula, and the stored figures
        const v = irp.ValDtls;
        expect(p(v.AssVal), `invoice ${n}`).toBe(Number(subtotalPaise));
        expect(p(v.CgstVal) + p(v.SgstVal) + p(v.IgstVal), `invoice ${n}`).toBe(Number(taxPaise));
        expect(p(v.Discount ?? 0), `invoice ${n}`).toBe(Number(discountPaise));
        expect(
          p(v.AssVal) + p(v.CgstVal) + p(v.SgstVal) + p(v.IgstVal) + p(v.OthChrg ?? 0) - p(v.Discount ?? 0) + p(v.RndOffAmt ?? 0),
          `invoice ${n}`,
        ).toBe(p(v.TotInvVal));
        expect(p(v.TotInvVal), `invoice ${n}`).toBe(Number(totalPaise));
      }

      const e = ewbOf(h, rows, n % 2 === 0);
      expect(p(e.totalValue) + p(e.cgstValue) + p(e.sgstValue) + p(e.igstValue) + p(e.cessValue) + p(e.otherValue), `ewb ${n}`).toBe(p(e.totInvValue));
      expect(p(e.totInvValue), `ewb ${n}`).toBe(Number(totalPaise));
      expect(e.itemList.reduce((s, i) => s + p(i.taxableAmount), 0), `ewb ${n}`).toBe(p(e.totalValue));
    }
  });
});

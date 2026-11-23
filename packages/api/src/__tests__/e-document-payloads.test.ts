/**
 * The e-invoice (IRP) and e-way bill payloads are built from the STORED line values (taxable = total - tax, tax,
 * total), so the payload adds up to the stored invoice exactly. They used to recompute qty x unitPrice x rate in
 * floating point, which disagrees with what is stored whenever the stored line is not qty x rate x GST% to the
 * paisa:
 *   - an online-store order of tax-inclusive items (rate 83.90 x 3 = 251.70 but the stored taxable value is 251.69),
 *   - a quantity with a third decimal (0.125 kg was rounded to 0.13 before multiplying),
 *   - the e-way bill, which ignored the line discount.
 *
 * Every expected value below is a hand-computed literal, with the arithmetic beside it.
 */
import { describe, it, expect } from "vitest";
import { mapInvoiceToIRP, type IRPInvoice, type IRPLineItem, type IRPBusiness, type IRPParty } from "../lib/invoice-to-irp.js";
import { mapInvoiceToEWB, type InvoiceForEWB, type LineItemForEWB, type TransportDetails } from "../lib/invoice-to-ewb.js";
import { priceStoreOrderLines, type StoreOrderLineInput } from "../lib/store-order-pricing.js";

const business: IRPBusiness = {
  gstin: "27AAAAA0000A1Z5", legalName: "Seller Pvt Ltd", name: "Seller", address: "1 Road", city: "Mumbai", state: "Maharashtra",
  stateCode: "27", pincode: "400001", phone: null, email: null,
};
const buyerMH: IRPParty = {
  gstin: "27BBBBB1111B1Z5", name: "Buyer MH", billingAddress: "2 Lane", city: "Pune", state: "Maharashtra", stateCode: "27", pincode: "411001", phone: null, email: null,
};
const buyerKA: IRPParty = { ...buyerMH, gstin: "29CCCCC2222C1Z5", name: "Buyer KA", state: "Karnataka", stateCode: "29", city: "Bengaluru", pincode: "560001" };

const DATE = new Date("2025-06-10T10:00:00.000Z");

/** The invoice header and lines as they would be STORED for the given priced lines. */
function stored(rows: Array<Omit<IRPLineItem, "description" | "selectedUnit"> & { selectedUnit?: string | null }>, header: { subtotal: string; taxAmount: string; totalAmount: string }) {
  const invoice: IRPInvoice = {
    invoiceNumber: "INV-00001", invoiceDate: DATE, type: "sale", documentType: "invoice",
    discountAmount: null, additionalCharges: null, roundOff: null, isReverseCharge: false, ...header,
  };
  // every line needs a valid HSN (4 digits up to ₹5 Cr turnover) or the mapper refuses to build the payload
  const lines: IRPLineItem[] = rows.map((r) => ({ description: null, selectedUnit: null, itemHsn: "8517", ...r }));
  return { invoice, lines };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100; // paise sum, only to compare totals in the test

describe("IRP payload: store order of tax-inclusive items (the stored line is not qty x rate x GST%)", () => {
  // 3 x ₹99.00 incl. 18%, an online-store order. The store prices the line directly (calcLineItem, inclusive):
  //   gross 3 x 9900 = 29700p = total; taxable = round(29700 x 100 / 118) = 25169.49 -> 25169p = 251.69; tax = 29700 - 25169 = 4531p = 45.31
  // and keeps the exclusive rate 83.90 (8389.83 -> 8390p) on the line. So the stored line is rate 83.90, qty 3, tax 45.31, total 297.00,
  // whereas 3 x 83.90 = 251.70 and 18% of that is 45.31 -> 251.70 + 45.31 = 297.01.
  const order: StoreOrderLineInput[] = [
    { itemId: "n", name: "Notebook", quantity: "3", unitPrice: "99.00", taxPercent: "18.00", taxInclusive: true, discountPercent: "0" },
  ];
  const priced = priceStoreOrderLines(order);

  it("the stored row is rate 83.90, tax 45.31, total 297.00 (the fixture really is the case that disagrees)", () => {
    expect(priced.rows.map((r) => [r.unitPrice, r.quantity, r.taxAmount, r.totalAmount])).toEqual([["83.90", "3", "45.31", "297.00"]]);
    expect([priced.totals.subtotal, priced.totals.taxTotal, priced.totals.total]).toEqual(["251.69", "45.31", "297.00"]);
  });

  const { invoice, lines } = stored(
    priced.rows.map((r) => ({ itemName: r.itemName, quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: r.taxPercent, taxAmount: r.taxAmount, discountPercent: r.discountPercent, totalAmount: r.totalAmount })),
    { subtotal: "251.69", taxAmount: "45.31", totalAmount: "297.00" },
  );

  it("intra-state: AssAmt 251.69, CGST 22.66 + SGST 22.65, TotItemVal 297.00; header sums equal the stored invoice", () => {
    const irp = mapInvoiceToIRP(invoice, lines, buyerMH, business);
    const item = irp.ItemList[0]!;
    expect(item).toMatchObject({
      UnitPrice: 83.9, Qty: 3,
      TotAmt: 251.7, // 3 x 83.90
      Discount: 0.01, // the rounding residue: AssAmt = TotAmt - Discount exactly (251.70 - 0.01)
      AssAmt: 251.69, // stored taxable value (297.00 - 45.31)
      CgstAmt: 22.66, SgstAmt: 22.65, IgstAmt: 0, // 4531p: odd paisa to CGST
      TotItemVal: 297, // = AssAmt + CGST + SGST = 251.69 + 22.66 + 22.65
    });
    expect(irp.ValDtls).toMatchObject({ AssVal: 251.69, CgstVal: 22.66, SgstVal: 22.65, IgstVal: 0, TotInvVal: 297 });
    expect(sum([irp.ValDtls.AssVal, irp.ValDtls.CgstVal, irp.ValDtls.SgstVal, irp.ValDtls.IgstVal])).toBe(297);
  });

  it("inter-state: IGST 45.31", () => {
    const irp = mapInvoiceToIRP(invoice, lines, buyerKA, business);
    expect(irp.ItemList[0]).toMatchObject({ AssAmt: 251.69, IgstAmt: 45.31, CgstAmt: 0, SgstAmt: 0, TotItemVal: 297 });
    expect(irp.ValDtls).toMatchObject({ AssVal: 251.69, IgstVal: 45.31, TotInvVal: 297 });
  });

  it("the three IRP item identities hold exactly: AssAmt = TotAmt - Discount, TotItemVal = AssAmt + taxes", () => {
    const item = mapInvoiceToIRP(invoice, lines, buyerMH, business).ItemList[0]!;
    expect(sum([item.TotAmt, -item.Discount])).toBe(item.AssAmt);
    expect(sum([item.AssAmt, item.CgstAmt, item.SgstAmt, item.IgstAmt])).toBe(item.TotItemVal);
  });

  it("e-way bill: item taxable 251.69 (not 251.70), items add up to the stored subtotal, tax 22.66 + 22.65", () => {
    const ewbInvoice: InvoiceForEWB = {
      id: "i1", invoiceNumber: "INV-00001", invoiceDate: DATE, type: "sale", documentType: "invoice",
      subtotal: "251.69", taxAmount: "45.31", totalAmount: "297.00", isReverseCharge: false,
      partyGstin: buyerMH.gstin, partyName: buyerMH.name, partyAddress: "2 Lane", partyCity: "Pune", partyPincode: "411001", partyStateCode: "27",
      businessGstin: business.gstin, businessName: "Seller", businessAddress: "1 Road", businessCity: "Mumbai", businessPincode: "400001", businessStateCode: "27",
    };
    const ewbLines: LineItemForEWB[] = priced.rows.map((r) => ({
      itemName: r.itemName, description: null, quantity: r.quantity, unitPrice: r.unitPrice, taxPercent: r.taxPercent,
      taxAmount: r.taxAmount, totalAmount: r.totalAmount, hsn: "4820", unit: "pcs", itemType: "product",
    }));
    const transport: TransportDetails = { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 20 };
    const ewb = mapInvoiceToEWB(ewbInvoice, ewbLines, transport);
    expect(ewb.itemList[0]!.taxableAmount).toBe(251.69);
    expect(ewb.totalValue).toBe(251.69);
    expect(ewb.itemList.reduce((s, i) => s + Math.round(i.taxableAmount * 100), 0)).toBe(Math.round(ewb.totalValue * 100));
    expect([ewb.cgstValue, ewb.sgstValue, ewb.igstValue]).toEqual([22.66, 22.65, 0]);
  });
});

describe("IRP and e-way bill payloads: an ordinary invoice (stored = qty x rate x GST%) is unchanged", () => {
  // 3 x 99.99 with 10% off and 12% GST:
  //   gross 3 x 99.99 = 299.97; discount 10% = 29.997 -> 30.00; taxable 299.97 - 30.00 = 269.97
  //   GST 12% of 269.97 = 32.3964 -> 32.40 (CGST 16.20 / SGST 16.20); total 269.97 + 32.40 = 302.37
  const { invoice, lines } = stored(
    [{ itemName: "Gadget", quantity: "3", unitPrice: "99.99", taxPercent: "12", taxAmount: "32.40", discountPercent: "10", totalAmount: "302.37" }],
    { subtotal: "269.97", taxAmount: "32.40", totalAmount: "302.37" },
  );

  it("IRP: TotAmt 299.97, Discount 30.00, AssAmt 269.97, CGST 16.20, SGST 16.20, TotItemVal 302.37", () => {
    const irp = mapInvoiceToIRP(invoice, lines, buyerMH, business);
    expect(irp.ItemList[0]).toMatchObject({ UnitPrice: 99.99, Qty: 3, TotAmt: 299.97, Discount: 30, AssAmt: 269.97, CgstAmt: 16.2, SgstAmt: 16.2, TotItemVal: 302.37 });
    expect(irp.ValDtls).toMatchObject({ AssVal: 269.97, CgstVal: 16.2, SgstVal: 16.2, TotInvVal: 302.37 });
  });

  it("e-way bill: taxable value is AFTER the line discount (269.97), so the items add up to the invoice subtotal", () => {
    // before: qty x rate = 299.97 for the item while totalValue (the subtotal) was 269.97
    const ewbInvoice: InvoiceForEWB = {
      id: "i2", invoiceNumber: "INV-00002", invoiceDate: DATE, type: "sale", documentType: "invoice",
      subtotal: "269.97", taxAmount: "32.40", totalAmount: "302.37", isReverseCharge: false,
      partyGstin: buyerMH.gstin, partyName: "Buyer MH", partyAddress: "2 Lane", partyCity: "Pune", partyPincode: "411001", partyStateCode: "27",
      businessGstin: business.gstin, businessName: "Seller", businessAddress: "1 Road", businessCity: "Mumbai", businessPincode: "400001", businessStateCode: "27",
    };
    const ewb = mapInvoiceToEWB(
      ewbInvoice,
      [{ itemName: "Gadget", description: null, quantity: "3", unitPrice: "99.99", taxPercent: "12", taxAmount: "32.40", totalAmount: "302.37", hsn: "8517", unit: "pcs", itemType: "product" }],
      { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 20 },
    );
    expect(ewb.itemList[0]!.taxableAmount).toBe(269.97);
    expect(ewb.totalValue).toBe(269.97);
    expect([ewb.cgstValue, ewb.sgstValue]).toEqual([16.2, 16.2]);
  });
});

describe("IRP payload: a quantity with three decimals is not rounded to two before multiplying", () => {
  // 0.125 kg at 100.00, 18%: gross 12.50, GST 2.25 (CGST 1.13 / SGST 1.12: 225p, odd paisa to CGST), total 14.75
  // (the old mapper used Qty 0.13: gross 13.00, GST 2.34, item total 15.34, not what was stored)
  const { invoice, lines } = stored(
    [{ itemName: "Saffron", quantity: "0.125", unitPrice: "100.00", taxPercent: "18", taxAmount: "2.25", discountPercent: "0", totalAmount: "14.75" }],
    { subtotal: "12.50", taxAmount: "2.25", totalAmount: "14.75" },
  );

  it("Qty 0.125, TotAmt 12.50, AssAmt 12.50, CGST 1.13, SGST 1.12, TotItemVal 14.75", () => {
    const irp = mapInvoiceToIRP(invoice, lines, buyerMH, business);
    expect(irp.ItemList[0]).toMatchObject({ Qty: 0.125, UnitPrice: 100, TotAmt: 12.5, Discount: 0, AssAmt: 12.5, CgstAmt: 1.13, SgstAmt: 1.12, TotItemVal: 14.75 });
    expect(irp.ValDtls).toMatchObject({ AssVal: 12.5, CgstVal: 1.13, SgstVal: 1.12, TotInvVal: 14.75 });
  });
});

describe("IRP payload: a stored taxable value above qty x rate never produces a negative discount", () => {
  // stored line: rate 0.33, qty 3 = 0.99, but stored taxable 1.00 (e.g. an inclusive line whose total was split directly)
  it("TotAmt is raised to AssAmt and Discount is 0", () => {
    const { invoice, lines } = stored(
      [{ itemName: "Sweet", quantity: "3", unitPrice: "0.33", taxPercent: "0", taxAmount: "0.00", discountPercent: "0", totalAmount: "1.00" }],
      { subtotal: "1.00", taxAmount: "0.00", totalAmount: "1.00" },
    );
    const item = mapInvoiceToIRP(invoice, lines, buyerMH, business).ItemList[0]!;
    expect(item).toMatchObject({ TotAmt: 1, Discount: 0, AssAmt: 1, TotItemVal: 1 });
  });
});

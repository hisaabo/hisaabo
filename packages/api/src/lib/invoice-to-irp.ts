/**
 * invoice-to-irp.ts — Transform Hisaabo invoice to IRP JSON Schema v1.1.
 *
 * WHY THIS FILE EXISTS:
 * The NIC IRP has a specific JSON schema that differs from Hisaabo's internal
 * data model. This module handles all field mapping, UQC code translation,
 * GST split (CGST/SGST for intra-state, IGST for inter-state), and
 * document type mapping (invoice → INV, credit_note → CRN, debit_note → DBN).
 *
 * Money: all internal amounts are strings (NUMERIC(15,2)), IRP requires numbers.
 * We parse only at the boundary here — never accumulate JS floats.
 */

import type { IRPInvoiceJson } from "./irp-client.js";
import { money } from "@hisaabo/shared";

/** The payload built from a stored invoice does not add up to that invoice's stored total (an internal inconsistency, not an IRP rejection). */
export class EInvoicePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EInvoicePayloadError";
  }
}

// ── Types (subset of what we need from DB rows) ────────────────────────────────

export interface IRPBusiness {
  gstin: string | null;
  legalName: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface IRPParty {
  gstin: string | null;
  name: string;
  billingAddress: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface IRPInvoice {
  invoiceNumber: string;
  invoiceDate: Date;
  type: string; // "sale" | "purchase"
  documentType: string; // "invoice" | "credit_note" | "debit_note" etc.
  subtotal: string;
  taxAmount: string;
  discountAmount: string | null;
  additionalCharges: string | null;
  roundOff: string | null;
  totalAmount: string;
  isReverseCharge: boolean;
}

export interface IRPLineItem {
  /** Required snapshot of the item name at billing time. */
  itemName: string;
  /** Optional free-text line notes (from invoice_items.description). */
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  discountPercent: string;
  totalAmount: string;
  selectedUnit: string | null;
  itemType?: string | null; // "product" | "service"
  itemHsn?: string | null;
}

// ── UQC mapping (Hisaabo unit → IRP UQC code) ─────────────────────────────────
// Reference: https://einvoice1.gst.gov.in/Others/MasterCodes

const UQC_MAP: Record<string, string> = {
  pcs: "PCS",
  kg: "KGS",
  g: "GMS",
  l: "LTR",
  ml: "MLT",
  m: "MTR",
  cm: "CMT",
  ft: "FT",
  in: "INH",
  box: "BOX",
  dozen: "DZN",
  pair: "PAR",
  set: "SET",
  pkt: "PAC",
  bun: "BUN",
  pouch: "BAG",
  jar: "JAR",
  btl: "BTL",
  bag: "BAG",
  ton: "TON",
  pack: "PAC",
  pet: "NOS",
  person: "NOS",
  other: "OTH",
};

function toUQC(unit: string | null | undefined): string {
  if (!unit) return "OTH";
  return UQC_MAP[unit.toLowerCase()] ?? "OTH";
}

// ── Document type mapping ──────────────────────────────────────────────────────

function toIRPDocType(documentType: string): string {
  switch (documentType) {
    case "credit_note":
    case "sales_return":
      return "CRN";
    case "debit_note":
    case "purchase_return":
      return "DBN";
    default:
      return "INV";
  }
}

// ── Date formatting ────────────────────────────────────────────────────────────

function toIRPDate(date: Date): string {
  // IRP requires DD/MM/YYYY
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Number helpers ─────────────────────────────────────────────────────────────

function n(s: string | null | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

// ── Main mapping function ──────────────────────────────────────────────────────

/**
 * Map a Hisaabo invoice to the NIC IRP JSON Schema v1.1.
 *
 * @param invoice   - Invoice row from DB
 * @param lineItems - Invoice line items
 * @param party     - Customer/supplier party
 * @param business  - Seller business (must have GSTIN)
 */
export function mapInvoiceToIRP(
  invoice: IRPInvoice,
  lineItems: IRPLineItem[],
  party: IRPParty,
  business: IRPBusiness,
): IRPInvoiceJson {
  if (!business.gstin) {
    throw new Error("Business GSTIN is required for e-invoicing");
  }
  if (!party.gstin) {
    throw new Error("Party GSTIN is required for e-invoicing (B2B only)");
  }

  const sellerStateCode = business.stateCode ?? "00";
  const buyerStateCode = party.stateCode ?? sellerStateCode;
  const isInterState = sellerStateCode !== buyerStateCode;

  const supplyType = isInterState ? "EXPWP" : "B2B";

  // Map line items. Every amount comes from the line's STORED values, never recomputed from qty x unitPrice x rate:
  // the stored taxable value (total - tax), tax and total are what the invoice, ledger, GST returns and PDF report,
  // and they are not always qty x rate x GST% to the paisa (an online-store order of tax-inclusive items stores the
  // exact inclusive amounts next to the tax-exclusive rate). UnitPrice is the stored rate.
  //   AssAmt     = stored taxable value
  //   TotAmt     = qty x unitPrice, and Discount = TotAmt - AssAmt, so the IRP rule AssAmt = TotAmt - Discount is exact.
  //                (When the stored taxable value is above qty x rate, by a paisa of rounding, TotAmt is raised to
  //                AssAmt and Discount is 0: a discount is never negative.)
  //   Cgst/Sgst  = the stored tax split with money.splitHalf (odd paisa to CGST: the ledger's and the returns' rule)
  //   TotItemVal = stored line total
  const itemList = lineItems.map((li, idx) => {
    const qty = Number(li.quantity) || 0;
    const unitPrice = money.toNumber(li.unitPrice);
    const taxPct = n(li.taxPercent);

    const taxable = money.sub(li.totalAmount, li.taxAmount);
    const totalTax = money.add(li.taxAmount, "0");
    let grossAmt = money.mul(li.unitPrice, li.quantity);
    let discAmt = money.sub(grossAmt, taxable);
    if (money.compare(discAmt, "0") < 0) {
      grossAmt = taxable;
      discAmt = "0.00";
    }

    let cgstAmt = 0;
    let sgstAmt = 0;
    let igstAmt = 0;

    if (isInterState) {
      igstAmt = money.toNumber(totalTax);
    } else {
      // CGST = round-half-up(tax / 2), SGST = the remainder (odd paisa to CGST). Done in integer
      // paise through the shared split: `round2(totalTax / 2)` in floating point rounded some odd
      // paise down (0.29 / 2 = 0.145 is 0.14499...), which is not what the rule says and not what
      // the ledger and the GST returns, which use the same function, report.
      const [cgstHalf, sgstHalf] = money.splitHalf(totalTax);
      cgstAmt = money.toNumber(cgstHalf);
      sgstAmt = money.toNumber(sgstHalf);
    }

    const totItemVal = money.toNumber(li.totalAmount);
    const isService = li.itemType === "service" ? "Y" : "N";

    return {
      SlNo: String(idx + 1),
      // IRP PrdDesc is the product-line display — use itemName (required
      // snapshot). The free-text notes field is intentionally NOT included
      // here, as IRP's PrdDesc is meant to identify the product, not capture
      // per-line comments.
      PrdDesc: li.itemName.slice(0, 300),
      IsServc: isService,
      HsnCd: li.itemHsn ?? "9999",
      Qty: qty,
      Unit: toUQC(li.selectedUnit),
      UnitPrice: unitPrice,
      TotAmt: money.toNumber(grossAmt),
      Discount: money.toNumber(discAmt),
      AssAmt: money.toNumber(taxable),
      GstRt: taxPct,
      IgstAmt: igstAmt,
      CgstAmt: cgstAmt,
      SgstAmt: sgstAmt,
      TotItemVal: totItemVal,
    };
  });

  // Aggregate ValDtls from itemList (sum of individual items), in integer paise: the sums are the stored invoice's
  // subtotal and tax exactly.
  const sumOf = (pick: (item: (typeof itemList)[number]) => number) =>
    money.toNumber(money.sum(itemList.map((item) => pick(item).toFixed(2))));
  const assVal = sumOf((item) => item.AssAmt);
  const cgstVal = sumOf((item) => item.CgstAmt);
  const sgstVal = sumOf((item) => item.SgstAmt);
  const igstVal = sumOf((item) => item.IgstAmt);

  // The header comes from the STORED invoice, and ValDtls.Discount is the INVOICE-LEVEL discount only (invoices.discount_amount):
  // the line discounts are already netted into each item's AssAmt, so AssVal is net of them and putting their sum in the
  // header would subtract them twice. The NIC rule:
  //   TotInvVal = AssVal + CgstVal + SgstVal + IgstVal + CesVal + StCesVal + OthChrg - Discount + RndOffAmt
  const othChrg = money.add(invoice.additionalCharges ?? "0", "0");
  const invoiceDiscount = money.add(invoice.discountAmount ?? "0", "0");
  const rndOffAmt = money.add(invoice.roundOff ?? "0", "0");
  const totInvVal = money.add(invoice.totalAmount, "0");
  const addsUpTo = money.add(
    money.sub(money.add(money.sum([assVal, cgstVal, sgstVal, igstVal].map((v) => v.toFixed(2))), othChrg), invoiceDiscount),
    rndOffAmt,
  );
  if (money.compare(addsUpTo, totInvVal) !== 0) {
    throw new EInvoicePayloadError(
      `The e-invoice for ${invoice.invoiceNumber} does not add up to the invoice total, so it was not sent to the IRP: ` +
        `AssVal ${assVal.toFixed(2)} + GST ${money.sum([cgstVal, sgstVal, igstVal].map((v) => v.toFixed(2)))} + OthChrg ${othChrg} ` +
        `- Discount ${invoiceDiscount} + RndOffAmt ${rndOffAmt} = ${addsUpTo}, but the stored total is ${totInvVal}. ` +
        `The line amounts and the invoice totals disagree; correct the invoice before submitting it.`,
    );
  }

  const sellerPin = parseInt(business.pincode ?? "000000", 10);
  const buyerPin = parseInt(party.pincode ?? "000000", 10);

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: supplyType,
      RegRev: invoice.isReverseCharge ? "Y" : "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: toIRPDocType(invoice.documentType),
      No: invoice.invoiceNumber,
      Dt: toIRPDate(invoice.invoiceDate),
    },
    SellerDtls: {
      Gstin: business.gstin,
      LglNm: (business.legalName ?? business.name).slice(0, 100),
      TrdNm: business.name.slice(0, 100),
      Addr1: (business.address ?? "").slice(0, 100),
      Loc: (business.city ?? business.state ?? "").slice(0, 50),
      Pin: isNaN(sellerPin) ? 0 : sellerPin,
      Stcd: sellerStateCode,
      Ph: business.phone ?? undefined,
      Em: business.email ?? undefined,
    },
    BuyerDtls: {
      Gstin: party.gstin,
      LglNm: party.name.slice(0, 100),
      TrdNm: party.name.slice(0, 100),
      Pos: buyerStateCode,
      Addr1: (party.billingAddress ?? "").slice(0, 100),
      Loc: (party.city ?? party.state ?? "").slice(0, 50),
      Pin: isNaN(buyerPin) ? 0 : buyerPin,
      Stcd: buyerStateCode,
      Ph: party.phone ?? undefined,
      Em: party.email ?? undefined,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: assVal,
      CgstVal: cgstVal,
      SgstVal: sgstVal,
      IgstVal: igstVal,
      Discount: money.toNumber(invoiceDiscount),
      OthChrg: money.isPositive(othChrg) ? money.toNumber(othChrg) : undefined,
      RndOffAmt: money.isZero(rndOffAmt) ? undefined : money.toNumber(rndOffAmt),
      TotInvVal: money.toNumber(totInvVal),
    },
  };
}

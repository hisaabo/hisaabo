/**
 * invoice-to-ewb.ts — Map a Hisaabo invoice to NIC E-Way Bill generation payload.
 *
 * WHY THIS FILE EXISTS:
 * The NIC EWB API expects a very specific JSON shape with numeric codes (state
 * codes, transport mode codes, etc.) whereas Hisaabo stores human-readable text.
 * This module isolates that transformation so the router stays clean.
 *
 * Key mappings:
 *   - Invoice type  → supplyType ("O" outward / "I" inward)
 *   - Document type → docType    ("INV" / "CRN" / "DBN")
 *   - Transport mode string → NIC code ("1"=road, "2"=rail …)
 *   - GST tax percent → CGST/SGST/IGST split based on same-state vs inter-state
 *   - Monetary values: string → number (NIC API expects numeric JSON values)
 */

import type { GenerateEWBPayload, EWBItemPayload } from "./ewb-client.js";
import { transportModeCode } from "./ewb-client.js";
import { money, splitDocumentGst } from "@hisaabo/shared";

/** The payload built from a stored invoice does not add up to that invoice's stored total (an internal inconsistency). */
export class EWBPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EWBPayloadError";
  }
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface InvoiceForEWB {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  type: "sale" | "purchase";
  documentType: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  /** Invoice-level discount, additional charges and round-off as stored; they make up `otherValue` (absent = 0). */
  discountAmount?: string | null;
  additionalCharges?: string | null;
  roundOff?: string | null;
  isReverseCharge: boolean;
  // Party
  partyGstin: string | null;
  partyName: string;
  partyAddress: string | null;
  partyCity: string | null;
  partyPincode: string | null;
  partyStateCode: string | null;
  // Business
  businessGstin: string | null;
  businessName: string;
  businessAddress: string | null;
  businessCity: string | null;
  businessPincode: string | null;
  businessStateCode: string | null;
}

export interface LineItemForEWB {
  /** Required snapshot of the item name (mapped to EWB productName/productDesc). */
  itemName: string;
  /** Optional free-text line notes — not used by EWB payload. */
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  totalAmount: string;
  hsn: string | null;
  unit: string | null;
  itemType: "product" | "service" | null;
}

export interface TransportDetails {
  transporterId?: string;
  transporterName?: string;
  vehicleNumber: string;
  vehicleType: "regular" | "over_dimensional";
  transportMode: "road" | "rail" | "air" | "ship";
  distance: number;
  fromAddress?: string;
  fromPincode?: string;
  toAddress?: string;
  toPincode?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function docTypeCode(documentType: string, _invoiceType: "sale" | "purchase"): "INV" | "CRN" | "DBN" {
  switch (documentType) {
    case "credit_note":   return "CRN";
    case "debit_note":    return "DBN";
    default:              return "INV";
  }
}

/**
 * Format Date to DD/MM/YYYY as required by NIC.
 */
function formatNICDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Determine if a transaction is inter-state based on state codes.
 * If either side is missing, we conservatively return false (use CGST/SGST).
 */
function isInterState(fromStateCode: string | null, toStateCode: string | null): boolean {
  if (!fromStateCode || !toStateCode) return false;
  return fromStateCode !== toStateCode;
}

/**
 * Split tax amount into CGST/SGST/IGST based on supply type.
 * For intra-state: CGST + SGST = the sum of each line's split, odd paisa to CGST (the
 * e-invoice rule, shared with the ledger and the GST returns); IGST = 0
 * For inter-state: IGST = taxAmount, CGST = SGST = 0
 */
function splitTax(
  taxAmount: number,
  lineTaxes: string[],
  interState: boolean,
): { cgst: number; sgst: number; igst: number } {
  if (interState) {
    return { cgst: 0, sgst: 0, igst: taxAmount };
  }
  const [cgst, sgst] = splitDocumentGst(taxAmount, lineTaxes);
  return { cgst: money.toNumber(cgst), sgst: money.toNumber(sgst), igst: 0 };
}

/**
 * Split tax rate into CGST/SGST/IGST rates.
 */
function splitTaxRate(
  taxPercent: number,
  interState: boolean,
): { cgstRate: number; sgstRate: number; igstRate: number } {
  if (interState) {
    return { cgstRate: 0, sgstRate: 0, igstRate: taxPercent };
  }
  const half = taxPercent / 2;
  return { cgstRate: half, sgstRate: half, igstRate: 0 };
}

/**
 * Pad pincode to 6 digits or return 0 if missing.
 */
function parsePincode(pincode: string | null | undefined): number {
  if (!pincode) return 0;
  const n = parseInt(pincode, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse state code to number (NIC expects integer).
 */
function parseStateCode(code: string | null | undefined): number {
  if (!code) return 0;
  const n = parseInt(code, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Map item unit to NIC-recognised unit code.
 * NIC has ~40 units; we map our enum values to the closest NIC code.
 */
function mapUnit(unit: string | null): string {
  if (!unit) return "OTH";
  const map: Record<string, string> = {
    pcs: "NOS",
    kg:  "KGS",
    g:   "GMS",
    l:   "LTR",
    ml:  "MLT",
    m:   "MTR",
    cm:  "CMS",
    ft:  "FT",
    in:  "INH",
    box: "BOX",
    dozen: "DOZ",
    pair:  "PAR",
    set:   "SET",
    pkt:   "PKT",
    bag:   "BAG",
    ton:   "TNE",
    btl:   "BTL",
    bun:   "BDL",
    jar:   "JAR",
    pack:  "PAC",
    other: "OTH",
  };
  return map[unit] ?? "OTH";
}

// ── Main mapper ───────────────────────────────────────────────────────────────

/**
 * Map a Hisaabo invoice to the NIC EWB generation payload.
 *
 * @param invoice      - invoice header (type, numbers, dates, GSTIN, address)
 * @param lineItems    - invoice line items
 * @param transport    - transport details provided by user at EWB generation time
 */
export function mapInvoiceToEWB(
  invoice: InvoiceForEWB,
  lineItems: LineItemForEWB[],
  transport: TransportDetails,
): GenerateEWBPayload {
  const isSale = invoice.type === "sale";

  // Determine from/to parties based on supply direction
  const fromGstin = isSale ? (invoice.businessGstin ?? "URP") : (invoice.partyGstin ?? "URP");
  const fromName  = isSale ? invoice.businessName           : invoice.partyName;
  const fromAddr  = isSale
    ? (transport.fromAddress ?? invoice.businessAddress ?? "")
    : (transport.fromAddress ?? invoice.partyAddress ?? "");
  const fromCity  = isSale ? (invoice.businessCity ?? "") : (invoice.partyCity ?? "");
  const fromPin   = isSale
    ? parsePincode(transport.fromPincode ?? invoice.businessPincode)
    : parsePincode(transport.fromPincode ?? invoice.partyPincode);
  const fromState = isSale
    ? parseStateCode(invoice.businessStateCode)
    : parseStateCode(invoice.partyStateCode);

  const toGstin   = isSale ? (invoice.partyGstin ?? "URP")    : (invoice.businessGstin ?? "URP");
  const toName    = isSale ? invoice.partyName                 : invoice.businessName;
  const toAddr    = isSale
    ? (transport.toAddress ?? invoice.partyAddress ?? "")
    : (transport.toAddress ?? invoice.businessAddress ?? "");
  const toCity    = isSale ? (invoice.partyCity ?? "") : (invoice.businessCity ?? "");
  const toPin     = isSale
    ? parsePincode(transport.toPincode ?? invoice.partyPincode)
    : parsePincode(transport.toPincode ?? invoice.businessPincode);
  const toState   = isSale
    ? parseStateCode(invoice.partyStateCode)
    : parseStateCode(invoice.businessStateCode);

  // Inter-state detection
  const interState = isInterState(
    isSale ? invoice.businessStateCode : invoice.partyStateCode,
    isSale ? invoice.partyStateCode    : invoice.businessStateCode,
  );

  // Every amount comes from the line's STORED values (taxable = total - tax, after the line discount), not from
  // qty x unitPrice: an online-store order of tax-inclusive items stores the exact inclusive amounts next to the
  // tax-exclusive rate, and a discounted line's taxable value is not qty x rate. The items then add up to the
  // invoice's stored subtotal and tax exactly.
  const itemList: EWBItemPayload[] = lineItems.map((li) => {
    const taxPct   = parseFloat(li.taxPercent) || 0;
    const qty      = parseFloat(li.quantity) || 0;
    const taxable  = money.sub(li.totalAmount, li.taxAmount); // stored pre-tax amount of the line

    const rates = splitTaxRate(taxPct, interState);

    return {
      // EWB payload needs a human-readable product name — use itemName
      // (required). productDesc historically mirrored productName in our
      // payload; keep that behaviour.
      productName: li.itemName.slice(0, 100),
      productDesc: li.itemName.slice(0, 100),
      hsnCode: li.hsn ?? "",
      quantity: qty,
      qtyUnit: mapUnit(li.unit),
      cgstRate: rates.cgstRate,
      sgstRate: rates.sgstRate,
      igstRate: rates.igstRate,
      cessRate: 0,
      taxableAmount: money.toNumber(taxable),
    };
  });

  const totalTaxRounded = money.toNumber(money.sum(lineItems.map((li) => li.taxAmount)));
  const taxSplit = splitTax(totalTaxRounded, lineItems.map((li) => li.taxAmount), interState);
  // The header is the stored invoice's. NIC: totInvValue = totalValue + cgstValue + sgstValue + igstValue + cessValue + otherValue,
  // where totalValue is the taxable value (the items, net of line discounts) and otherValue carries what is not tax and not
  // an item: additional charges + round-off - the invoice-level discount (it may be negative).
  const totalValue = money.sum(itemList.map((i) => i.taxableAmount.toFixed(2)));
  const otherValue = money.sub(
    money.add(invoice.additionalCharges ?? "0", invoice.roundOff ?? "0"),
    invoice.discountAmount ?? "0",
  );
  const totInvValue = money.add(invoice.totalAmount, "0");
  const addsUpTo = money.add(
    money.add(totalValue, money.sum([taxSplit.cgst, taxSplit.sgst, taxSplit.igst].map((v) => v.toFixed(2)))),
    otherValue,
  );
  if (money.compare(addsUpTo, totInvValue) !== 0) {
    throw new EWBPayloadError(
      `The e-way bill for ${invoice.invoiceNumber} does not add up to the invoice total, so it was not sent: ` +
        `totalValue ${totalValue} + GST ${money.sum([taxSplit.cgst, taxSplit.sgst, taxSplit.igst].map((v) => v.toFixed(2)))} + ` +
        `otherValue ${otherValue} = ${addsUpTo}, but the stored total is ${totInvValue}. ` +
        `The line amounts and the invoice totals disagree; correct the invoice before generating the e-way bill.`,
    );
  }

  return {
    supplyType:     isSale ? "O" : "I",
    subSupplyType:  "1", // 1 = Supply (default for regular invoices)
    docType:        docTypeCode(invoice.documentType, invoice.type),
    docNo:          invoice.invoiceNumber,
    docDate:        formatNICDate(invoice.invoiceDate),
    fromGstin,
    fromTrdName:    fromName.slice(0, 100),
    fromAddr1:      fromAddr.slice(0, 120),
    fromPlace:      fromCity.slice(0, 50),
    fromPincode:    fromPin,
    fromStateCode:  fromState,
    toGstin,
    toTrdName:      toName.slice(0, 100),
    toAddr1:        toAddr.slice(0, 120),
    toPlace:        toCity.slice(0, 50),
    toPincode:      toPin,
    toStateCode:    toState,
    totalValue:     money.toNumber(totalValue),
    cgstValue:      taxSplit.cgst,
    sgstValue:      taxSplit.sgst,
    igstValue:      taxSplit.igst,
    cessValue:      0,
    otherValue:     money.toNumber(otherValue),
    totInvValue:    money.toNumber(totInvValue),
    transMode:      transportModeCode(transport.transportMode),
    transDistance:  transport.distance,
    transporterId:  transport.transporterId,
    transporterName: transport.transporterName,
    vehicleNo:      transport.vehicleNumber,
    vehicleType:    transport.vehicleType === "over_dimensional" ? "O" : "R",
    itemList,
  };
}

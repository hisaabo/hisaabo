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
  description: string;
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
 * For intra-state: CGST = SGST = taxAmount / 2, IGST = 0
 * For inter-state: IGST = taxAmount, CGST = SGST = 0
 */
function splitTax(
  taxAmount: number,
  interState: boolean,
): { cgst: number; sgst: number; igst: number } {
  if (interState) {
    return { cgst: 0, sgst: 0, igst: taxAmount };
  }
  const half = Math.round((taxAmount / 2) * 100) / 100;
  return { cgst: half, sgst: half, igst: 0 };
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

  // Aggregate tax values
  let totalTax = 0;
  const itemList: EWBItemPayload[] = lineItems.map((li) => {
    const taxPct   = parseFloat(li.taxPercent) || 0;
    const qty      = parseFloat(li.quantity) || 0;
    const price    = parseFloat(li.unitPrice) || 0;
    const taxAmt   = parseFloat(li.taxAmount) || 0;
    const taxable  = qty * price; // pre-tax amount per line

    totalTax += taxAmt;

    const rates = splitTaxRate(taxPct, interState);

    return {
      productName: li.description.slice(0, 100),
      productDesc: li.description.slice(0, 100),
      hsnCode: li.hsn ?? "",
      quantity: qty,
      qtyUnit: mapUnit(li.unit),
      cgstRate: rates.cgstRate,
      sgstRate: rates.sgstRate,
      igstRate: rates.igstRate,
      cessRate: 0,
      taxableAmount: Math.round(taxable * 100) / 100,
    };
  });

  const totalTaxRounded = Math.round(totalTax * 100) / 100;
  const taxSplit = splitTax(totalTaxRounded, interState);
  const totalValue = parseFloat(invoice.subtotal) || 0;

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
    totalValue:     Math.round(totalValue * 100) / 100,
    cgstValue:      taxSplit.cgst,
    sgstValue:      taxSplit.sgst,
    igstValue:      taxSplit.igst,
    cessValue:      0,
    transMode:      transportModeCode(transport.transportMode),
    transDistance:  transport.distance,
    transporterId:  transport.transporterId,
    transporterName: transport.transporterName,
    vehicleNo:      transport.vehicleNumber,
    vehicleType:    transport.vehicleType === "over_dimensional" ? "O" : "R",
    itemList,
  };
}

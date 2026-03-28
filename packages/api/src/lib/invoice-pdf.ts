import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../fonts/NotoSans-Bold.ttf");

// ── Types ──────────────────────────────────────────────────────

export interface InvoicePDFData {
  // Business
  businessName: string;
  businessLegalName?: string;
  businessGstin?: string;
  businessPan?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  businessCity?: string;
  businessState?: string;
  businessPincode?: string;

  // Party
  partyName: string;
  partyPhone?: string;
  partyEmail?: string;
  partyGstin?: string;
  partyBillingAddress?: string;
  partyCity?: string;
  partyState?: string;

  // Invoice
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  type: "sale" | "purchase";

  // Line items
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    taxAmount: string;
    discountPercent: string;
    totalAmount: string;
  }>;

  // Totals
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  amountPaid: string;

  // Optional
  notes?: string;
  termsAndConditions?: string;

  // Payment info (shown on invoice for customer)
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  upiId?: string;        // e.g., "business@upi"
  upiQrDataUrl?: string; // pre-generated QR code as data URL

  // GST
  gstRegistrationType?: "regular" | "composition" | "unregistered";
  businessStateCode?: string; // 2-digit state code
  partyStateCode?: string;
  lineItemHsn?: string[]; // HSN/SAC code per line item (parallel array)
}

export type PDFFormat = "a5" | "a4" | "thermal";

// ── Helpers ────────────────────────────────────────────────────

function fmt(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(num);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

// Number to words for Indian billing
function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + chunk(n % 100) : "");
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = Math.floor(num % 1000);
  const paise = Math.round((num % 1) * 100);

  let words = "";
  if (crore) words += chunk(crore) + " Crore ";
  if (lakh) words += chunk(lakh) + " Lakh ";
  if (thousand) words += chunk(thousand) + " Thousand ";
  if (rest) words += chunk(rest);
  words = words.trim() + " Rupees";
  if (paise) words += " and " + chunk(paise) + " Paise";
  return words + " Only";
}

// ── GST helpers ────────────────────────────────────────────────

function getInvoiceTitle(data: InvoicePDFData): string {
  if (data.type === "purchase") return "PURCHASE INVOICE";
  if (!data.gstRegistrationType || data.gstRegistrationType === "unregistered") return "INVOICE";
  if (data.gstRegistrationType === "composition") return "BILL OF SUPPLY";
  return "TAX INVOICE";
}

function isGstRegistered(data: InvoicePDFData): boolean {
  return data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition";
}

function isSameState(data: InvoicePDFData): boolean {
  if (data.businessStateCode && data.partyStateCode) {
    return data.businessStateCode === data.partyStateCode;
  }
  if (data.businessState && data.partyState) {
    return data.businessState.toLowerCase() === data.partyState.toLowerCase();
  }
  return false;
}

interface GstBreakdown {
  rate: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

function buildGstBreakdown(data: InvoicePDFData): GstBreakdown[] {
  const sameState = isSameState(data);
  const map = new Map<string, GstBreakdown>();

  for (const item of data.lineItems) {
    const rate = item.taxPercent;
    const taxable = parseFloat(item.totalAmount) - parseFloat(item.taxAmount);
    const taxAmt = parseFloat(item.taxAmount);

    if (!map.has(rate)) {
      map.set(rate, { rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    }
    const entry = map.get(rate)!;
    entry.taxable += taxable;
    if (sameState) {
      entry.cgst += taxAmt / 2;
      entry.sgst += taxAmt / 2;
    } else {
      entry.igst += taxAmt;
    }
  }

  return Array.from(map.values());
}

// ── Drawing primitives ────────────────────────────────────────

function hLine(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  color: string,
  weight = 0.5
) {
  doc.save();
  doc.strokeColor(color).lineWidth(weight)
    .moveTo(x, y).lineTo(x + w, y).stroke();
  doc.restore();
}

function filledRect(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
) {
  doc.save();
  doc.rect(x, y, w, h).fill(color);
  doc.restore();
}

function borderedRect(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  weight = 0.5
) {
  doc.save();
  doc.rect(x, y, w, h).stroke(strokeColor);
  doc.restore();
}

// ── A4 GST Invoice ─────────────────────────────────────────────
// Full GST-compliant Tax Invoice layout for registered businesses

function generateA4Invoice(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 595.28; // A4
  const pageH = 841.89;
  const margin = 36;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Design tokens
  const cPrimary   = "#111827"; // near-black for headings/body
  const cSecondary = "#374151"; // dark gray for content
  const cMuted     = "#6b7280"; // mid gray for labels
  const cLight     = "#9ca3af"; // light gray for fine print
  const cAccent    = "#4f46e5"; // indigo accent
  const cBorder    = "#d1d5db"; // light gray border
  const cBg        = "#f9fafb"; // near-white background fill
  const cHeaderBg  = "#f3f4f6"; // section header background

  const gstMode = isGstRegistered(data);
  const sameState = isSameState(data);
  const titleLabel = getInvoiceTitle(data);

  // ── Page outer border ──────────────────────────────────────
  borderedRect(doc, margin - 4, margin - 4, contentW + 8, pageH - margin * 2 + 8, cBorder, 0.75);

  // ── Title banner ──────────────────────────────────────────
  filledRect(doc, margin - 4, y - 4, contentW + 8, 28, cAccent);
  doc.fontSize(13).fillColor("#ffffff").font("NotoSans-Bold")
    .text(titleLabel, margin - 4, y + 4, { width: contentW + 8, align: "center" });
  y += 32;

  // ── Top section: Seller | Invoice Details ─────────────────
  const topSectionH = 120;
  const leftW = contentW * 0.56;
  const rightW = contentW - leftW;
  const rightX = margin + leftW;

  // Background fills
  filledRect(doc, margin - 4, y, leftW + 4, topSectionH, cBg);
  filledRect(doc, rightX, y, rightW + 4, topSectionH, "#ffffff");

  // Vertical divider between left and right
  doc.save();
  doc.strokeColor(cBorder).lineWidth(0.5)
    .moveTo(rightX, y).lineTo(rightX, y + topSectionH).stroke();
  doc.restore();

  // Bottom border for the top section
  hLine(doc, margin - 4, y + topSectionH, contentW + 8, cBorder);

  // Left: Seller details
  let ly = y + 8;
  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("SELLER DETAILS", margin, ly);
  ly += 12;

  doc.fontSize(11).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, ly, { width: leftW - 10 });
  ly += 16;

  if (data.businessLegalName && data.businessLegalName !== data.businessName) {
    doc.fontSize(8).fillColor(cSecondary).font("NotoSans")
      .text(data.businessLegalName, margin, ly, { width: leftW - 10 });
    ly += 11;
  }

  const bizAddrParts: string[] = [];
  if (data.businessAddress) bizAddrParts.push(data.businessAddress);
  const bizCityLine = [data.businessCity, data.businessState, data.businessPincode].filter(Boolean).join(", ");
  if (bizCityLine) bizAddrParts.push(bizCityLine);

  doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans");
  for (const line of bizAddrParts) {
    doc.text(line, margin, ly, { width: leftW - 10 });
    ly += 10;
  }

  if (gstMode && data.businessGstin) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, ly, { width: leftW - 10 });
    ly += 10;
  }

  const stateDisplay = [data.businessState, data.businessStateCode ? `(${data.businessStateCode})` : ""].filter(Boolean).join(" ");
  if (stateDisplay) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`State: ${stateDisplay}`, margin, ly, { width: leftW - 10 });
    ly += 10;
  }

  if (data.businessPan) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`PAN: ${data.businessPan}`, margin, ly, { width: leftW - 10 });
    ly += 10;
  }

  if (data.businessPhone) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(`Ph: ${data.businessPhone}`, margin, ly);
    ly += 10;
  }
  if (data.businessEmail) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(data.businessEmail, margin, ly, { width: leftW - 10 });
  }

  // Right: Invoice metadata
  let ry = y + 8;
  const labelX = rightX + 8;
  const valueX = rightX + 90;
  const metaW = rightW - 16;

  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("INVOICE DETAILS", labelX, ry);
  ry += 14;

  function metaRow(label: string, value: string) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(label, labelX, ry, { width: 78 });
    doc.fontSize(7.5).fillColor(cPrimary).font("NotoSans-Bold")
      .text(value, valueX, ry, { width: metaW - 78 });
    ry += 12;
  }

  metaRow("Invoice No:", data.invoiceNumber);
  metaRow("Date:", fmtDate(data.invoiceDate));
  if (data.dueDate) metaRow("Due Date:", fmtDate(data.dueDate));

  if (gstMode) {
    const posDisplay = [
      data.partyState || data.businessState,
      (data.partyStateCode || data.businessStateCode) ? `(${data.partyStateCode || data.businessStateCode})` : "",
    ].filter(Boolean).join(" ");
    if (posDisplay) metaRow("Place of Supply:", posDisplay);
    metaRow("Reverse Charge:", "No");
  }

  y += topSectionH + 1;

  // ── Buyer section ─────────────────────────────────────────
  const buyerSectionH = 60;
  filledRect(doc, margin - 4, y, contentW + 8, 16, cHeaderBg);
  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("BUYER / BILL TO", margin, y + 4);
  hLine(doc, margin - 4, y + 16, contentW + 8, cBorder);
  y += 22;

  // Buyer info in two columns
  const buyerLeftW = contentW * 0.56;
  const buyerRightX = margin + buyerLeftW;
  const buyerRightW = contentW - buyerLeftW;

  doc.fontSize(9.5).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.partyName, margin, y, { width: buyerLeftW - 10 });
  y += 13;

  const buyerAddrParts: string[] = [];
  if (data.partyBillingAddress) buyerAddrParts.push(data.partyBillingAddress);
  const partyCityLine = [data.partyCity, data.partyState].filter(Boolean).join(", ");
  if (partyCityLine) buyerAddrParts.push(partyCityLine);

  doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans");
  for (const line of buyerAddrParts) {
    doc.text(line, margin, y, { width: buyerLeftW - 10 });
    y += 10;
  }

  // Buyer right column: GSTIN / state / phone
  let bry = y - (buyerAddrParts.length * 10) - 13;
  if (data.partyPhone) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`Ph: ${data.partyPhone}`, buyerRightX, bry, { width: buyerRightW - 4 });
    bry += 10;
  }
  if (data.partyGstin) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.partyGstin}`, buyerRightX, bry, { width: buyerRightW - 4 });
    bry += 10;
  }
  if (data.partyState) {
    const partyStateDisplay = [data.partyState, data.partyStateCode ? `(${data.partyStateCode})` : ""].filter(Boolean).join(" ");
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`State: ${partyStateDisplay}`, buyerRightX, bry, { width: buyerRightW - 4 });
  }

  y = Math.max(y, bry + 10) + 8;
  hLine(doc, margin - 4, y, contentW + 8, cBorder);
  y += 1;

  // ── Items table ───────────────────────────────────────────
  const showHsn = gstMode && data.lineItemHsn?.some(h => h);

  // Column layout (A4, 515pt content width)
  // #(16) | HSN(45) | Description(flex) | Qty(36) | Rate(64) | Tax%(28) | Tax Amt(54) | Amount(64)
  const COL_IDX  = margin;
  const COL_HSN  = COL_IDX + 20;
  const COL_DESC = showHsn ? COL_HSN + 46 : COL_IDX + 20;
  const COL_AMT  = margin + contentW - 60;
  const COL_TAXAMT = COL_AMT - 56;
  const COL_TAXPCT = COL_TAXAMT - 30;
  const COL_RATE = COL_TAXPCT - 66;
  const COL_QTY  = COL_RATE - 38;
  const DESCW = COL_QTY - COL_DESC - 8;

  // Table header row
  const tableHeaderH = 20;
  filledRect(doc, margin - 4, y, contentW + 8, tableHeaderH, cHeaderBg);

  doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold");
  doc.text("#", COL_IDX, y + 6, { width: 16 });
  if (showHsn) doc.text("HSN/SAC", COL_HSN, y + 6, { width: 44 });
  doc.text("DESCRIPTION", COL_DESC, y + 6, { width: DESCW });
  doc.text("QTY", COL_QTY, y + 6, { width: 36, align: "right" });
  doc.text("RATE", COL_RATE, y + 6, { width: 62, align: "right" });
  doc.text("TAX%", COL_TAXPCT, y + 6, { width: 28, align: "right" });
  doc.text("TAX AMT", COL_TAXAMT, y + 6, { width: 54, align: "right" });
  doc.text("AMOUNT", COL_AMT, y + 6, { width: 60, align: "right" });

  y += tableHeaderH;
  hLine(doc, margin - 4, y, contentW + 8, cBorder);

  // Table rows
  data.lineItems.forEach((item, i) => {
    const rowH = 18;
    if (i % 2 === 1) {
      filledRect(doc, margin - 4, y, contentW + 8, rowH, "#f9fafb");
    }
    const rowY = y + 5;

    doc.fontSize(8).fillColor(cSecondary).font("NotoSans");
    doc.text(`${i + 1}`, COL_IDX, rowY, { width: 16 });
    if (showHsn) {
      doc.fontSize(7).text(data.lineItemHsn?.[i] || "—", COL_HSN, rowY, { width: 44 });
    }
    doc.fontSize(8).text(item.description, COL_DESC, rowY, { width: DESCW });
    doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), COL_QTY, rowY, { width: 36, align: "right" });
    doc.text(fmt(item.unitPrice), COL_RATE, rowY, { width: 62, align: "right" });
    doc.text(`${item.taxPercent}%`, COL_TAXPCT, rowY, { width: 28, align: "right" });
    doc.text(fmt(item.taxAmount), COL_TAXAMT, rowY, { width: 54, align: "right" });
    doc.font("NotoSans-Bold").text(fmt(item.totalAmount), COL_AMT, rowY, { width: 60, align: "right" });

    y += rowH;
  });

  hLine(doc, margin - 4, y, contentW + 8, cBorder, 0.75);
  y += 1;

  // ── GST Breakdown table (only for registered, when tax > 0) ──
  if (gstMode && parseFloat(data.taxAmount) > 0) {
    const breakdown = buildGstBreakdown(data);

    filledRect(doc, margin - 4, y, contentW * 0.62 + 8, 16, cHeaderBg);
    doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
      .text("TAX SUMMARY", margin, y + 4);

    // GST breakdown header columns
    const G1 = margin;
    const G2 = margin + 65;
    const G3 = margin + 150;
    const G4 = margin + 230;
    const G5 = margin + 290;
    const GW = 70;

    doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
      .text("TAX RATE", G1 + 4, y + 4)
      .text("TAXABLE VALUE", G2, y + 4, { width: GW, align: "right" });

    if (sameState) {
      doc.text("CGST", G3, y + 4, { width: GW, align: "right" });
      doc.text("SGST", G4, y + 4, { width: GW, align: "right" });
    } else {
      doc.text("IGST", G3, y + 4, { width: GW, align: "right" });
    }

    y += 16;
    hLine(doc, margin - 4, y, contentW * 0.62 + 8, cBorder);

    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans");
    for (const row of breakdown) {
      doc.text(`GST @ ${row.rate}%`, G1 + 4, y + 3);
      doc.text(fmt(row.taxable), G2, y + 3, { width: GW, align: "right" });
      if (sameState) {
        doc.text(fmt(row.cgst), G3, y + 3, { width: GW, align: "right" });
        doc.text(fmt(row.sgst), G4, y + 3, { width: GW, align: "right" });
      } else {
        doc.text(fmt(row.igst), G3, y + 3, { width: GW, align: "right" });
      }
      y += 14;
    }

    hLine(doc, margin - 4, y, contentW * 0.62 + 8, cBorder);
    y += 4;
  }

  // ── Totals (right-aligned block) ─────────────────────────
  // We go back up to align totals with the right side of the table
  const totalsTop = y;
  // Re-position y for the bottom of totals after they are drawn

  const totalLabelX = margin + contentW * 0.6;
  const totalValX   = margin + contentW - 60;
  const totalLabelW = totalValX - totalLabelX - 8;

  function totalRow(label: string, value: string, bold = false, accent = false) {
    doc.fontSize(bold ? 9 : 8)
      .fillColor(accent ? cAccent : bold ? cPrimary : cMuted)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(label, totalLabelX, y, { width: totalLabelW });
    doc.fontSize(bold ? 9 : 8)
      .fillColor(bold ? cPrimary : cSecondary)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(fmt(value), totalValX, y, { width: 60, align: "right" });
    y += bold ? 16 : 13;
  }

  // Subtotal = taxable value
  const taxableTotal = parseFloat(data.subtotal) - parseFloat(data.discountAmount);
  totalRow("Taxable Value", taxableTotal.toFixed(2));

  if (parseFloat(data.discountAmount) > 0) {
    totalRow("Discount", data.discountAmount);
  }

  if (gstMode && parseFloat(data.taxAmount) > 0) {
    if (sameState) {
      const halfTax = (parseFloat(data.taxAmount) / 2).toFixed(2);
      totalRow("CGST", halfTax);
      totalRow("SGST", halfTax);
    } else {
      totalRow("IGST", data.taxAmount);
    }
  } else if (parseFloat(data.taxAmount) > 0) {
    totalRow("Tax", data.taxAmount);
  }

  // Round off
  const roundOff = Math.round(parseFloat(data.totalAmount)) - parseFloat(data.totalAmount);
  if (Math.abs(roundOff) > 0.005) {
    totalRow("Round Off", roundOff.toFixed(2));
  }

  hLine(doc, totalLabelX, y, 60 + totalLabelW + 8, cBorder);
  y += 5;

  totalRow("TOTAL", data.totalAmount, true, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalRow("Amount Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0.005) totalRow("Balance Due", balance.toFixed(2), true);
  }

  y += 4;
  hLine(doc, margin - 4, y, contentW + 8, cBorder);
  y += 8;

  // ── Amount in words ───────────────────────────────────────
  filledRect(doc, margin - 4, y, contentW + 8, 14, cBg);
  doc.fontSize(7.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("Amount in words: ", margin, y + 3);
  const wordsLabelW = doc.widthOfString("Amount in words: ");
  doc.fontSize(7.5).fillColor(cPrimary).font("NotoSans")
    .text(numberToWords(parseFloat(data.totalAmount)), margin + wordsLabelW, y + 3,
      { width: contentW - wordsLabelW - 4 });
  y += 18;
  hLine(doc, margin - 4, y, contentW + 8, cBorder);
  y += 1;

  // ── Payment Info & Bank Details ───────────────────────────
  const hasPaymentInfo = data.type === "sale" && (data.bankAccountNumber || data.upiId);

  if (hasPaymentInfo) {
    const payLeft = margin;
    const payRight = margin + contentW * 0.5 + 10;
    const payColW  = contentW * 0.5 - 10;

    filledRect(doc, margin - 4, y, contentW + 8, 14, cHeaderBg);
    doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
      .text("BANK & PAYMENT DETAILS", payLeft, y + 4);
    hLine(doc, margin - 4, y + 14, contentW + 8, cBorder);
    y += 20;

    let bankY = y;
    const hasQr = !!data.upiQrDataUrl;
    const qrSize = 68;
    const textW = hasQr ? payColW - qrSize - 12 : payColW - 4;

    if (data.bankAccountNumber) {
      function bankRow(label: string, value: string) {
        doc.fontSize(7.5).fillColor(cMuted).font("NotoSans-Bold")
          .text(label, payLeft, bankY, { width: 44 });
        doc.font("NotoSans").fillColor(cSecondary)
          .text(value, payLeft + 44, bankY, { width: textW - 44 });
        bankY += 11;
      }
      if (data.bankName) bankRow("Bank:", data.bankName);
      bankRow("A/C No:", data.bankAccountNumber);
      if (data.bankIfsc) bankRow("IFSC:", data.bankIfsc);
      if (data.bankAccountName) bankRow("A/C Name:", data.bankAccountName);
    }

    if (data.upiId) {
      doc.fontSize(7.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("UPI:", payLeft, bankY, { width: 44 });
      doc.font("NotoSans").fillColor(cSecondary)
        .text(data.upiId, payLeft + 44, bankY, { width: textW - 44 });
      bankY += 11;
    }

    if (hasQr && data.upiQrDataUrl) {
      const qrX = payLeft + payColW - qrSize;
      const qrYPos = y;
      try {
        const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, qrX, qrYPos, { width: qrSize, height: qrSize });
        const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
        if (balance > 0) {
          doc.fontSize(6).fillColor(cMuted).font("NotoSans")
            .text(`Scan to pay ${fmt(balance)}`, qrX, qrYPos + qrSize + 2,
              { width: qrSize, align: "center" });
        }
      } catch {
        // skip QR if image decoding fails
      }
    }

    y = Math.max(bankY, y + qrSize + 8) + 4;
    hLine(doc, margin - 4, y, contentW + 8, cBorder);
    y += 1;
  }

  // ── Terms & Notes | Signatory (two-column bottom) ─────────
  const bottomLeft  = margin;
  const bottomRight = margin + contentW * 0.6 + 4;
  const bottomLeftW = contentW * 0.6;
  const bottomRightW = contentW - contentW * 0.6 - 4;
  const bottomStartY = y;

  filledRect(doc, margin - 4, y, contentW + 8, 14, cHeaderBg);
  hLine(doc, bottomRight, y, bottomRightW + 4, cBorder);
  doc.save();
  doc.strokeColor(cBorder).lineWidth(0.5)
    .moveTo(bottomRight, y).lineTo(bottomRight, y + 80).stroke();
  doc.restore();
  y += 14;
  hLine(doc, margin - 4, bottomStartY + 14, contentW + 8, cBorder);

  let termsY = y;
  if (data.termsAndConditions) {
    doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
      .text("Terms & Conditions", bottomLeft, termsY, { width: bottomLeftW });
    termsY += 11;
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text(data.termsAndConditions, bottomLeft, termsY, { width: bottomLeftW });
    termsY += doc.heightOfString(data.termsAndConditions, { width: bottomLeftW }) + 8;
  }

  if (data.notes) {
    doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
      .text("Notes", bottomLeft, termsY, { width: bottomLeftW });
    termsY += 11;
    doc.fontSize(7).fillColor(cSecondary).font("NotoSans")
      .text(data.notes, bottomLeft, termsY, { width: bottomLeftW });
  }

  // Signatory (right)
  const sigY = bottomStartY + 14 + 4;
  doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
    .text("For", bottomRight + 4, sigY, { width: bottomRightW - 8 });
  doc.fontSize(8.5).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.businessName, bottomRight + 4, sigY + 11, { width: bottomRightW - 8 });

  const sigLineY = sigY + 50;
  hLine(doc, bottomRight + 4, sigLineY, bottomRightW - 12, cBorder);
  doc.fontSize(7).fillColor(cMuted).font("NotoSans")
    .text("Authorized Signatory", bottomRight + 4, sigLineY + 3, { width: bottomRightW - 8 });

  y = Math.max(termsY, sigLineY + 14) + 6;
  hLine(doc, margin - 4, y, contentW + 8, cBorder);
  y += 1;

  // ── Footer ────────────────────────────────────────────────
  const footerY = Math.min(y, pageH - margin);
  doc.fontSize(7).fillColor(cLight).font("NotoSans")
    .text("This is a computer-generated invoice and does not require a physical signature.",
      margin, footerY + 4, { width: contentW, align: "center" });
}

// ── A5 Portrait Invoice ────────────────────────────────────────
// Clean, modern design for non-GST or simpler invoicing needs

function generateA5Invoice(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 419.53; // A5 portrait width
  const pageH = 595.28; // A5 portrait height
  const margin = 28;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Design tokens — warmer, lighter palette for a modern look
  const cPrimary   = "#111827";
  const cSecondary = "#374151";
  const cMuted     = "#6b7280";
  const cLight     = "#9ca3af";
  const cAccent    = "#4f46e5"; // indigo
  const cBorder    = "#e5e7eb";
  const cBg        = "#f9fafb";
  const cAccentBg  = "#eef2ff"; // very light indigo

  const gstMode = isGstRegistered(data);
  const titleLabel = getInvoiceTitle(data);

  // ── Accent stripe at top ──────────────────────────────────
  filledRect(doc, 0, 0, pageW, 4, cAccent);

  // ── Header area ───────────────────────────────────────────
  // Business name + invoice title side by side
  doc.fontSize(15).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, y, { width: contentW * 0.58 });

  // Invoice badge (top-right)
  const badgeW = 90;
  const badgeX = margin + contentW - badgeW;
  filledRect(doc, badgeX, y - 2, badgeW, 22, cAccentBg);
  doc.fontSize(9).fillColor(cAccent).font("NotoSans-Bold")
    .text(titleLabel, badgeX, y + 4, { width: badgeW, align: "center" });

  y += 22;

  if (data.businessLegalName && data.businessLegalName !== data.businessName) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(data.businessLegalName, margin, y, { width: contentW * 0.58 });
    y += 10;
  }

  // Business contact details
  const bizParts: string[] = [];
  const bizAddr = [data.businessAddress, data.businessCity, data.businessState, data.businessPincode].filter(Boolean).join(", ");
  if (bizAddr) bizParts.push(bizAddr);
  if (data.businessPhone) bizParts.push(`Ph: ${data.businessPhone}`);
  if (data.businessEmail) bizParts.push(data.businessEmail);
  if (gstMode && data.businessGstin) bizParts.push(`GSTIN: ${data.businessGstin}`);
  if (data.businessPan) bizParts.push(`PAN: ${data.businessPan}`);

  doc.fontSize(7).fillColor(cMuted).font("NotoSans")
    .text(bizParts.join("  |  "), margin, y, { width: contentW });
  y += 10;

  // Invoice number + date (below business line)
  doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
    .text(`Invoice #: `, margin + contentW - 140, y - 10, { continued: true })
    .font("NotoSans-Bold").fillColor(cPrimary)
    .text(data.invoiceNumber);
  doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
    .text(`Date: `, margin + contentW - 140, y, { continued: true })
    .font("NotoSans").fillColor(cSecondary)
    .text(fmtDate(data.invoiceDate));
  if (data.dueDate) {
    y += 10;
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(`Due: `, margin + contentW - 140, y, { continued: true })
      .font("NotoSans").fillColor(cSecondary)
      .text(fmtDate(data.dueDate));
  }

  y += 14;
  hLine(doc, margin, y, contentW, cAccent, 1);
  y += 10;

  // ── Bill To ───────────────────────────────────────────────
  doc.fontSize(6.5).fillColor(cAccent).font("NotoSans-Bold")
    .text("BILL TO", margin, y);
  y += 10;

  doc.fontSize(9.5).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.partyName, margin, y, { width: contentW * 0.65 });
  y += 13;

  const partyParts: string[] = [];
  if (data.partyBillingAddress) partyParts.push(data.partyBillingAddress);
  const pCity = [data.partyCity, data.partyState].filter(Boolean).join(", ");
  if (pCity) partyParts.push(pCity);
  if (data.partyPhone) partyParts.push(`Ph: ${data.partyPhone}`);
  if (gstMode && data.partyGstin) partyParts.push(`GSTIN: ${data.partyGstin}`);

  if (partyParts.length > 0) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(partyParts.join("  |  "), margin, y, { width: contentW * 0.65 });
    y += doc.heightOfString(partyParts.join("  |  "), { width: contentW * 0.65 }) + 8;
  }

  hLine(doc, margin, y, contentW, cBorder);
  y += 8;

  // ── Items table ───────────────────────────────────────────
  const showHsn = gstMode && data.lineItemHsn?.some(h => h);
  // Columns: # | HSN? | Description | Qty | Rate | Tax | Amount
  const A_IDX  = margin;
  const A_HSN  = A_IDX + 16;
  const A_DESC = showHsn ? A_HSN + 40 : A_IDX + 16;
  const A_AMT  = margin + contentW - 54;
  const A_TAX  = A_AMT - 34;
  const A_RATE = A_TAX - 52;
  const A_QTY  = A_RATE - 30;
  const A_DESCW = A_QTY - A_DESC - 6;

  // Header row
  filledRect(doc, margin, y, contentW, 16, cBg);
  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold");
  doc.text("#", A_IDX, y + 4, { width: 14 });
  if (showHsn) doc.text("HSN", A_HSN, y + 4, { width: 38 });
  doc.text("DESCRIPTION", A_DESC, y + 4, { width: A_DESCW });
  doc.text("QTY", A_QTY, y + 4, { width: 28, align: "right" });
  doc.text("RATE", A_RATE, y + 4, { width: 50, align: "right" });
  doc.text("TAX", A_TAX, y + 4, { width: 32, align: "right" });
  doc.text("AMOUNT", A_AMT, y + 4, { width: 54, align: "right" });
  y += 16;
  hLine(doc, margin, y, contentW, cBorder);

  data.lineItems.forEach((item, i) => {
    const rowH = 16;
    if (i % 2 === 1) {
      filledRect(doc, margin, y, contentW, rowH, cBg);
    }
    const rowY = y + 4;

    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans");
    doc.text(`${i + 1}`, A_IDX, rowY, { width: 14 });
    if (showHsn) {
      doc.fontSize(7).text(data.lineItemHsn?.[i] || "—", A_HSN, rowY, { width: 38 });
    }
    doc.fontSize(7.5).text(item.description, A_DESC, rowY, { width: A_DESCW });
    doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), A_QTY, rowY, { width: 28, align: "right" });
    doc.text(fmt(item.unitPrice), A_RATE, rowY, { width: 50, align: "right" });
    doc.text(`${item.taxPercent}%`, A_TAX, rowY, { width: 32, align: "right" });
    doc.font("NotoSans-Bold").text(fmt(item.totalAmount), A_AMT, rowY, { width: 54, align: "right" });

    y += rowH;
  });

  hLine(doc, margin, y, contentW, cBorder);
  y += 8;

  // ── Totals ────────────────────────────────────────────────
  const totLabelX = margin + contentW * 0.55;
  const totValX   = margin + contentW - 54;
  const totLabelW = totValX - totLabelX - 8;

  function totRow(label: string, value: string, bold = false) {
    doc.fontSize(bold ? 8.5 : 7.5)
      .fillColor(bold ? cPrimary : cMuted)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(label, totLabelX, y, { width: totLabelW });
    doc.fontSize(bold ? 8.5 : 7.5)
      .fillColor(bold ? cPrimary : cSecondary)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(fmt(value), totValX, y, { width: 54, align: "right" });
    y += bold ? 14 : 11;
  }

  totRow("Subtotal", data.subtotal);
  if (parseFloat(data.discountAmount) > 0) totRow("Discount", `-${data.discountAmount}`);
  if (parseFloat(data.taxAmount) > 0) totRow("Tax", data.taxAmount);

  hLine(doc, totLabelX, y, totLabelW + 54 + 8, cBorder);
  y += 4;
  totRow("TOTAL", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totRow("Amount Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0.005) totRow("Balance Due", balance.toFixed(2), true);
  }

  // Amount in words (left side, same row level)
  const wordsY = y - 40;
  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("Amount in words:", margin, wordsY, { width: contentW * 0.5 });
  doc.fontSize(7).fillColor(cSecondary).font("NotoSans")
    .text(numberToWords(parseFloat(data.totalAmount)), margin, wordsY + 10,
      { width: contentW * 0.5 });

  y += 8;
  hLine(doc, margin, y, contentW, cBorder);
  y += 8;

  // ── Payment info ──────────────────────────────────────────
  const hasPaymentInfo = data.type === "sale" && (data.bankAccountNumber || data.upiId);

  if (hasPaymentInfo) {
    doc.fontSize(6.5).fillColor(cAccent).font("NotoSans-Bold")
      .text("PAYMENT DETAILS", margin, y);
    y += 10;

    const hasQr = !!data.upiQrDataUrl;
    const qrSize = 56;
    const textAreaW = hasQr ? contentW - qrSize - 10 : contentW;

    let payY = y;
    if (data.bankAccountNumber) {
      const parts = [];
      if (data.bankName) parts.push(`Bank: ${data.bankName}`);
      parts.push(`A/C: ${data.bankAccountNumber}`);
      if (data.bankIfsc) parts.push(`IFSC: ${data.bankIfsc}`);
      if (data.bankAccountName) parts.push(`Name: ${data.bankAccountName}`);
      doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
        .text(parts.join("   "), margin, payY, { width: textAreaW });
      payY += 11;
    }

    if (data.upiId) {
      doc.fontSize(7.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("UPI: ", margin, payY, { continued: true })
        .font("NotoSans").fillColor(cSecondary).text(data.upiId, { width: textAreaW });
      payY += 11;
    }

    if (hasQr && data.upiQrDataUrl) {
      const qrX = margin + contentW - qrSize;
      try {
        const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, qrX, y, { width: qrSize, height: qrSize });
        const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
        if (balance > 0) {
          doc.fontSize(5.5).fillColor(cMuted).font("NotoSans")
            .text(`Scan to pay ${fmt(balance)}`, qrX, y + qrSize + 2, { width: qrSize, align: "center" });
        }
      } catch {
        // skip QR
      }
    }

    y = Math.max(payY, y + (hasQr ? qrSize + 10 : 0)) + 4;
    hLine(doc, margin, y, contentW, cBorder);
    y += 8;
  }

  // ── Notes / Terms ─────────────────────────────────────────
  if (data.notes || data.termsAndConditions) {
    const notesLeft  = margin;
    const notesRight = margin + contentW * 0.55 + 8;
    const notesW     = contentW * 0.55;
    const sigW       = contentW * 0.45 - 12;

    if (data.termsAndConditions) {
      doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("Terms & Conditions", notesLeft, y);
      y += 10;
      doc.fontSize(7).fillColor(cMuted).font("NotoSans")
        .text(data.termsAndConditions, notesLeft, y, { width: notesW });
    }

    if (data.notes) {
      const notesY2 = data.termsAndConditions
        ? y + doc.heightOfString(data.termsAndConditions, { width: notesW }) + 8
        : y;
      doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("Notes", notesLeft, notesY2);
      doc.fontSize(7).fillColor(cSecondary).font("NotoSans")
        .text(data.notes, notesLeft, notesY2 + 10, { width: notesW });
    }

    // Signatory on the right
    const sigX = notesRight;
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text("For", sigX, y, { width: sigW });
    doc.fontSize(8).fillColor(cPrimary).font("NotoSans-Bold")
      .text(data.businessName, sigX, y + 11, { width: sigW });
    const sigLineY = y + 40;
    hLine(doc, sigX, sigLineY, sigW, cBorder);
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text("Authorized Signatory", sigX, sigLineY + 3, { width: sigW });

    y += 55;
  } else {
    // Just signatory
    const sigX = margin + contentW * 0.55 + 8;
    const sigW = contentW * 0.45 - 12;
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text("For", sigX, y, { width: sigW });
    doc.fontSize(8).fillColor(cPrimary).font("NotoSans-Bold")
      .text(data.businessName, sigX, y + 11, { width: sigW });
    const sigLineY = y + 38;
    hLine(doc, sigX, sigLineY, sigW, cBorder);
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text("Authorized Signatory", sigX, sigLineY + 3, { width: sigW });
    y += 50;
  }

  // ── Footer ────────────────────────────────────────────────
  const footerY = Math.min(y + 6, pageH - margin + 4);
  hLine(doc, margin, footerY, contentW, cBorder);
  doc.fontSize(6.5).fillColor(cLight).font("NotoSans")
    .text("This is a computer-generated invoice.", margin, footerY + 5,
      { width: contentW, align: "center" });
}

// ── Thermal Receipt (58mm / 80mm) ──────────────────────────────

function generateThermalReceipt(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 226; // ~80mm at 72 DPI
  const margin = 8;
  const contentW = pageW - margin * 2;
  let y = margin;

  const colorBlack = "#000000";
  const colorGray = "#555555";

  function separator() {
    const dashes = "─".repeat(35);
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(dashes, margin, y, { width: contentW, align: "center" });
    y += 10;
  }

  // Header
  doc.fontSize(10).fillColor(colorBlack).font("Courier-Bold")
    .text(data.businessName.toUpperCase(), margin, y, { width: contentW, align: "center" });
  y += 14;

  if (data.businessAddress) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(data.businessAddress, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  const cityLine = [data.businessCity, data.businessState].filter(Boolean).join(", ");
  if (cityLine) {
    doc.text(cityLine, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (data.businessPhone) {
    doc.text(`Ph: ${data.businessPhone}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (data.businessGstin && data.gstRegistrationType !== "unregistered") {
    doc.fontSize(6).font("Courier-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  y += 4;
  separator();

  // Invoice info
  doc.fontSize(8).fillColor(colorBlack).font("Courier-Bold")
    .text(getInvoiceTitle(data), margin, y, { width: contentW, align: "center" });
  y += 12;

  doc.fontSize(6).font("NotoSans").fillColor(colorBlack);
  doc.text(`No: ${data.invoiceNumber}`, margin, y);
  doc.text(fmtDate(data.invoiceDate), margin, y, { width: contentW, align: "right" });
  y += 9;

  doc.text(`To: ${data.partyName}`, margin, y, { width: contentW });
  y += 9;

  if (data.partyGstin) {
    doc.text(`GSTIN: ${data.partyGstin}`, margin, y);
    y += 9;
  }

  separator();

  // Items
  doc.fontSize(6).font("Courier-Bold").fillColor(colorBlack);
  doc.text("ITEM", margin, y);
  doc.text("QTY", margin + contentW * 0.5, y, { width: 30, align: "right" });
  doc.text("AMT", margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });
  y += 10;

  doc.font("NotoSans").fontSize(6);
  for (const item of data.lineItems) {
    // Item name (may wrap)
    const nameW = contentW * 0.48;
    doc.text(item.description, margin, y, { width: nameW });
    const nameH = doc.heightOfString(item.description, { width: nameW });

    doc.text(parseFloat(item.quantity).toString(), margin + contentW * 0.5, y, { width: 30, align: "right" });
    doc.text(fmt(item.totalAmount), margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });

    // Rate + tax under item name
    y += Math.max(nameH, 8) + 1;
    doc.fontSize(5).fillColor(colorGray)
      .text(`@ ${fmt(item.unitPrice)} + ${item.taxPercent}% tax`, margin + 4, y);
    doc.fillColor(colorBlack).fontSize(6);
    y += 9;
  }

  separator();

  // Totals
  function totalLine(label: string, value: string, bold = false) {
    doc.fontSize(bold ? 8 : 6).font(bold ? "Courier-Bold" : "Courier")
      .text(label, margin, y)
      .text(fmt(value), margin, y, { width: contentW, align: "right" });
    y += bold ? 12 : 9;
  }

  totalLine("Subtotal", data.subtotal);
  totalLine("Tax", data.taxAmount);
  if (parseFloat(data.discountAmount) > 0) totalLine("Discount", `-${data.discountAmount}`);

  separator();
  totalLine("TOTAL", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalLine("Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0) totalLine("Balance", balance.toFixed(2), true);
  }

  separator();

  // Footer
  doc.fontSize(5).fillColor(colorGray).font("NotoSans")
    .text("Thank you for your business!", margin, y, { width: contentW, align: "center" });
  y += 8;
  doc.text("Computer generated invoice", margin, y, { width: contentW, align: "center" });
  y += 12;
}

// ── Public API ─────────────────────────────────────────────────

export function generateInvoicePDF(data: InvoicePDFData, format: PDFFormat = "a5"): InstanceType<typeof PDFDocument> {
  let docSize: string | number[];
  let docMargin: number;

  if (format === "a4") {
    docSize = "A4";
    docMargin = 36;
  } else if (format === "a5") {
    docSize = [419.53, 595.28]; // A5 portrait
    docMargin = 28;
  } else {
    docSize = [226, 800]; // 80mm thermal
    docMargin = 8;
  }

  const doc = new PDFDocument({
    size: docSize,
    margin: docMargin,
    bufferPages: true,
    info: {
      Title: `Invoice ${data.invoiceNumber}`,
      Author: data.businessName,
      Subject: `Invoice for ${data.partyName}`,
      Creator: "Hisaabo",
    },
  });

  // Register Noto Sans (supports ₹ and all Indic scripts)
  doc.registerFont("NotoSans", FONT_REGULAR);
  doc.registerFont("NotoSans-Bold", FONT_BOLD);

  if (format === "a4") {
    generateA4Invoice(doc, data);
  } else if (format === "thermal") {
    generateThermalReceipt(doc, data);
  } else {
    generateA5Invoice(doc, data);
  }

  return doc;
}

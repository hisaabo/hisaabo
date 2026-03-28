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

  // Freemium branding
  isPaidPlan?: boolean; // true = no branding, false/undefined = show "Powered by hisaabo.in"

  // Payment status for diagonal stamp badge
  status?: string; // invoice status for stamp badge (paid, partial, overdue, cancelled, draft)
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
  if (!data.isPaidPlan) {
    doc.fontSize(5.5).font("NotoSans").fillColor("#b0b0b8")
      .text("Powered by hisaabo.in", margin, footerY + 16, { width: contentW, align: "center" });
  }
}

// ── A5 Landscape Invoice ───────────────────────────────────────
// Clean, two-column design for A5 landscape (595.28 x 419.53 pt)
// Sections flow top-to-bottom with clear visual hierarchy

function generateA5Invoice(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW   = 595.28; // A5 landscape width
  const pageH   = 419.53; // A5 landscape height
  const margin  = 28;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Design tokens
  const cPrimary   = "#111827";
  const cSecondary = "#374151";
  const cMuted     = "#6b7280";
  const cLight     = "#9ca3af";
  const cAccent    = "#5b5bd6"; // indigo
  const cBorder    = "#e8e8f0";
  const cBg        = "#f4f4f8"; // very light lavender-grey
  const cAccentBg  = "#ededfb"; // lightest indigo wash

  const gstMode  = isGstRegistered(data);
  const titleLabel = getInvoiceTitle(data);

  // ── Thin accent stripe at the very top ───────────────────
  filledRect(doc, 0, 0, pageW, 3, cAccent);

  // ── SECTION 1: Two-column header ─────────────────────────
  // Left column: business info  |  Right column: invoice metadata
  const leftColW  = contentW * 0.52;
  const rightColW = contentW - leftColW - 12;
  const rightColX = margin + leftColW + 12;

  // Left: Business name
  doc.fontSize(13).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, y, { width: leftColW });

  if (data.businessLegalName && data.businessLegalName !== data.businessName) {
    // 13pt font renders at ~16pt line height; offset beneath the business name
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text(data.businessLegalName, margin, y + 16, { width: leftColW });
  }

  // Address lines
  let leftY = y + 16;
  const addrLine = [data.businessAddress].filter(Boolean).join("");
  const cityLine = [data.businessCity, data.businessState, data.businessPincode].filter(Boolean).join(", ");
  if (addrLine) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(addrLine, margin, leftY, { width: leftColW });
    leftY += 10;
  }
  if (cityLine) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(cityLine, margin, leftY, { width: leftColW });
    leftY += 10;
  }
  if (data.businessPhone) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(`Ph: ${data.businessPhone}`, margin, leftY, { width: leftColW });
    leftY += 10;
  }
  if (data.businessEmail) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(data.businessEmail, margin, leftY, { width: leftColW });
    leftY += 10;
  }
  if (gstMode && data.businessGstin) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, leftY, { width: leftColW });
    leftY += 10;
  }
  if (data.businessPan) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`PAN: ${data.businessPan}`, margin, leftY, { width: leftColW });
    leftY += 10;
  }

  // Right: Invoice title badge + metadata
  // Title badge pill
  const badgeH = 16;
  filledRect(doc, rightColX, y, rightColW, badgeH, cAccent);
  doc.fontSize(8.5).fillColor("#ffffff").font("NotoSans-Bold")
    .text(titleLabel, rightColX, y + 4, { width: rightColW, align: "center" });

  let rightY = y + badgeH + 6;

  // Meta rows: label right-aligned, value bold right-aligned
  const metaLabelX = rightColX;
  const metaValW   = rightColW;

  function metaLine(label: string, value: string) {
    doc.fontSize(7).fillColor(cMuted).font("NotoSans")
      .text(label, metaLabelX, rightY, { width: metaValW - 2, align: "right" });
    rightY += 9;
    doc.fontSize(8).fillColor(cPrimary).font("NotoSans-Bold")
      .text(value, metaLabelX, rightY, { width: metaValW, align: "right" });
    rightY += 11;
  }

  metaLine("INVOICE NUMBER", data.invoiceNumber);
  metaLine("DATE", fmtDate(data.invoiceDate));
  if (data.dueDate) metaLine("DUE DATE", fmtDate(data.dueDate));

  // Advance the main y cursor past whichever column is taller
  y = Math.max(leftY, rightY) + 4;

  // Full-width divider
  hLine(doc, margin, y, contentW, cBorder);
  y += 8;

  // ── SECTION 2: Bill To ───────────────────────────────────
  doc.fontSize(6.5).fillColor(cAccent).font("NotoSans-Bold")
    .text("BILL TO", margin, y);
  y += 8;

  doc.fontSize(9).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.partyName, margin, y, { width: contentW * 0.6 });

  // Party details in two sub-columns
  let partyY = y + 12;
  const partyAddrParts: string[] = [];
  if (data.partyBillingAddress) partyAddrParts.push(data.partyBillingAddress);
  const partyCity = [data.partyCity, data.partyState].filter(Boolean).join(", ");
  if (partyCity) partyAddrParts.push(partyCity);

  for (const line of partyAddrParts) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(line, margin, partyY, { width: contentW * 0.55 });
    partyY += 10;
  }

  // Party contact on the right side of bill-to row
  let partyRY = y + 12;
  const partyRX = margin + contentW * 0.6 + 8;
  const partyRW = contentW * 0.4 - 8;
  if (data.partyPhone) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
      .text(`Ph: ${data.partyPhone}`, partyRX, partyRY, { width: partyRW });
    partyRY += 10;
  }
  if (data.partyEmail) {
    doc.fontSize(7.5).fillColor(cMuted).font("NotoSans")
      .text(data.partyEmail, partyRX, partyRY, { width: partyRW });
    partyRY += 10;
  }
  if (gstMode && data.partyGstin) {
    doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.partyGstin}`, partyRX, partyRY, { width: partyRW });
    partyRY += 10;
  }

  y = Math.max(partyY, partyRY) + 4;
  hLine(doc, margin, y, contentW, cBorder);
  y += 1;

  // ── SECTION 3: Items table ───────────────────────────────
  const showHsn = gstMode && data.lineItemHsn?.some(h => h);

  // Column layout for A5 landscape (539pt content width)
  // #(14) | HSN?(40) | Description(flex) | Qty(34) | Rate(62) | Tax(32) | Amount(62)
  const C_IDX   = margin;
  const C_HSN   = C_IDX + 18;
  const C_DESC  = showHsn ? C_HSN + 42 : C_IDX + 18;
  const C_AMT   = margin + contentW - 60;
  const C_TAX   = C_AMT - 36;
  const C_RATE  = C_TAX - 64;
  const C_QTY   = C_RATE - 36;
  const C_DESCW = C_QTY - C_DESC - 6;

  // Table header
  const tableHdrH = 18;
  filledRect(doc, margin, y, contentW, tableHdrH, cBg);

  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold");
  doc.text("#", C_IDX, y + 5, { width: 14 });
  if (showHsn) doc.text("HSN/SAC", C_HSN, y + 5, { width: 40 });
  doc.text("DESCRIPTION", C_DESC, y + 5, { width: C_DESCW });
  doc.text("QTY", C_QTY, y + 5, { width: 34, align: "right" });
  doc.text("RATE", C_RATE, y + 5, { width: 62, align: "right" });
  doc.text("TAX", C_TAX, y + 5, { width: 34, align: "right" });
  doc.text("AMOUNT", C_AMT, y + 5, { width: 60, align: "right" });

  y += tableHdrH;
  hLine(doc, margin, y, contentW, cBorder);

  data.lineItems.forEach((item, i) => {
    const rowH = 17;
    if (i % 2 === 1) {
      filledRect(doc, margin, y, contentW, rowH, "#fafafc");
    }
    const rowY = y + 4;

    doc.fontSize(8).fillColor(cSecondary).font("NotoSans");
    doc.text(`${i + 1}`, C_IDX, rowY, { width: 14 });
    if (showHsn) {
      doc.fontSize(7).text(data.lineItemHsn?.[i] || "—", C_HSN, rowY, { width: 40 });
    }
    doc.fontSize(8).text(item.description, C_DESC, rowY, { width: C_DESCW });
    doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), C_QTY, rowY, { width: 34, align: "right" });
    doc.text(fmt(item.unitPrice), C_RATE, rowY, { width: 62, align: "right" });
    doc.text(`${item.taxPercent}%`, C_TAX, rowY, { width: 34, align: "right" });
    doc.font("NotoSans-Bold").text(fmt(item.totalAmount), C_AMT, rowY, { width: 60, align: "right" });

    y += rowH;
    hLine(doc, margin, y, contentW, cBorder, 0.3);
  });

  hLine(doc, margin, y, contentW, cBorder, 0.75);
  y += 8;

  // ── SECTION 4: Totals (right column) + Amount in words (left column) ──
  // Both sit side-by-side so they never overlap
  const totBlockStartY = y;

  // Right column: totals
  const totLabelX = margin + contentW * 0.58;
  const totValW   = 62;
  const totValX   = margin + contentW - totValW;
  const totLabelW = totValX - totLabelX - 8;

  let totY = totBlockStartY;

  function totRow(label: string, value: string, bold = false, accent = false) {
    doc.fontSize(bold ? 8.5 : 7.5)
      .fillColor(accent ? cAccent : bold ? cPrimary : cMuted)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(label, totLabelX, totY, { width: totLabelW });
    doc.fontSize(bold ? 8.5 : 7.5)
      .fillColor(bold ? cPrimary : cSecondary)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(fmt(value), totValX, totY, { width: totValW, align: "right" });
    totY += bold ? 13 : 11;
  }

  totRow("Subtotal", data.subtotal);
  if (parseFloat(data.discountAmount) > 0) totRow("Discount", `-${data.discountAmount}`);
  if (parseFloat(data.taxAmount) > 0) totRow("Tax", data.taxAmount);

  hLine(doc, totLabelX, totY, totLabelW + totValW + 8, cBorder);
  totY += 4;
  totRow("TOTAL", data.totalAmount, true, true);

  if (parseFloat(data.amountPaid) > 0) {
    totRow("Amount Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0.005) totRow("Balance Due", balance.toFixed(2), true);
  }

  // Left column: amount in words — uses the same vertical band, never overlaps
  const wordsColW = totLabelX - margin - 10;
  let wordsY = totBlockStartY;

  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
    .text("AMOUNT IN WORDS", margin, wordsY, { width: wordsColW });
  wordsY += 10;
  doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
    .text(numberToWords(parseFloat(data.totalAmount)), margin, wordsY,
      { width: wordsColW });

  // Advance past the taller of the two columns
  y = Math.max(totY, wordsY + 20) + 6;
  hLine(doc, margin, y, contentW, cBorder);
  y += 8;

  // ── SECTION 5: Payment details + Signatory ───────────────
  const hasPaymentInfo = data.type === "sale" && (data.bankAccountNumber || data.upiId);

  // Three sub-columns: payment text | QR code | signatory
  const hasQr  = hasPaymentInfo && !!data.upiQrDataUrl;
  const qrSize = 54;

  // Signatory always occupies the rightmost ~110pt
  const sigColW  = 110;
  const sigColX  = margin + contentW - sigColW;

  // QR (if present) sits just left of signatory
  const qrColX   = hasQr ? sigColX - qrSize - 8 : sigColX;
  const payTextW = hasQr ? qrColX - margin - 4 : sigColX - margin - 8;

  // Capture y at the start of section 5 so the signatory can anchor here
  const sec5StartY = y;

  if (hasPaymentInfo) {
    // Section label
    doc.fontSize(6.5).fillColor(cAccent).font("NotoSans-Bold")
      .text("PAYMENT DETAILS", margin, y);
    y += 10;

    let payY = y;

    if (data.upiId) {
      doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
        .text("UPI", margin, payY, { width: 20 });
      doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
        .text(data.upiId, margin + 22, payY, { width: payTextW - 22 });
      payY += 11;
    }

    if (data.bankAccountNumber) {
      if (data.bankName) {
        doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
          .text("BANK", margin, payY, { width: 22 });
        doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
          .text(data.bankName, margin + 24, payY, { width: payTextW - 24 });
        payY += 11;
      }
      doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
        .text("A/C", margin, payY, { width: 22 });
      doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
        .text(data.bankAccountNumber, margin + 24, payY, { width: payTextW - 24 });
      payY += 11;
      if (data.bankIfsc) {
        doc.fontSize(7).fillColor(cMuted).font("NotoSans-Bold")
          .text("IFSC", margin, payY, { width: 22 });
        doc.fontSize(7.5).fillColor(cSecondary).font("NotoSans")
          .text(data.bankIfsc, margin + 24, payY, { width: payTextW - 24 });
        payY += 11;
      }
    }

    // QR code — anchored to sec5StartY so it doesn't shift with the text
    if (hasQr && data.upiQrDataUrl) {
      try {
        const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, qrColX, sec5StartY, { width: qrSize, height: qrSize });
        const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
        if (balance > 0) {
          doc.fontSize(5.5).fillColor(cMuted).font("NotoSans")
            .text(`Scan to pay ${fmt(balance)}`, qrColX, sec5StartY + qrSize + 2,
              { width: qrSize, align: "center" });
        }
      } catch {
        // skip QR if image decoding fails
      }
    }

    y = Math.max(payY, hasQr ? sec5StartY + qrSize + 10 : sec5StartY) + 2;
  }

  // Signatory block — anchored at the start of section 5
  const sigTopY = sec5StartY;
  doc.fontSize(7).fillColor(cMuted).font("NotoSans")
    .text("For", sigColX, sigTopY, { width: sigColW });
  doc.fontSize(8.5).fillColor(cPrimary).font("NotoSans-Bold")
    .text(data.businessName, sigColX, sigTopY + 10, { width: sigColW });

  const sigLineY = sigTopY + 36;
  hLine(doc, sigColX, sigLineY, sigColW - 4, cBorder);
  doc.fontSize(6.5).fillColor(cMuted).font("NotoSans")
    .text("Authorized Signatory", sigColX, sigLineY + 3, { width: sigColW });

  y = Math.max(y, sigLineY + 14) + 4;

  // ── SECTION 6: Notes / Terms ─────────────────────────────
  if (data.notes || data.termsAndConditions) {
    hLine(doc, margin, y, contentW, cBorder);
    y += 6;
    const notesW = contentW * 0.7;
    if (data.termsAndConditions) {
      doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("Terms & Conditions", margin, y, { width: notesW });
      y += 9;
      doc.fontSize(7).fillColor(cMuted).font("NotoSans")
        .text(data.termsAndConditions, margin, y, { width: notesW });
      y += doc.heightOfString(data.termsAndConditions, { width: notesW }) + 4;
    }
    if (data.notes) {
      doc.fontSize(6.5).fillColor(cMuted).font("NotoSans-Bold")
        .text("Notes", margin, y, { width: notesW });
      y += 9;
      doc.fontSize(7).fillColor(cSecondary).font("NotoSans")
        .text(data.notes, margin, y, { width: notesW });
      y += doc.heightOfString(data.notes, { width: notesW }) + 4;
    }
  }

  // ── Footer ────────────────────────────────────────────────
  const footerY = Math.min(y + 4, pageH - 10);
  hLine(doc, margin, footerY, contentW, cBorder, 0.5);
  doc.fontSize(6.5).fillColor(cLight).font("NotoSans")
    .text("This is a computer-generated invoice.", margin, footerY + 4,
      { width: contentW, align: "center" });
  if (!data.isPaidPlan) {
    doc.fontSize(5.5).font("NotoSans").fillColor("#b0b0b8")
      .text("Powered by hisaabo.in", margin, footerY + 14, { width: contentW, align: "center" });
  }
}

// ── Thermal Receipt (80mm) ─────────────────────────────────────

function generateThermalReceipt(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 226; // ~80mm at 72 DPI
  const margin = 8;
  const contentW = pageW - margin * 2;
  let y = margin;

  const colorBlack = "#000000";
  const colorGray = "#555555";

  const gstMode = isGstRegistered(data);
  const sameState = isSameState(data);

  // Vector rule — no Unicode box-drawing characters that render as squares
  function separator() {
    doc.save();
    doc.strokeColor("#bbbbbb").lineWidth(0.5)
      .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
    doc.restore();
    y += 6;
  }

  // ── Header ───────────────────────────────────────────────────
  doc.fontSize(10).fillColor(colorBlack).font("NotoSans-Bold")
    .text(data.businessName.toUpperCase(), margin, y, { width: contentW, align: "center" });
  y += 14;

  if (data.businessAddress) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(data.businessAddress, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  const cityLine = [data.businessCity, data.businessState].filter(Boolean).join(", ");
  if (cityLine) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(cityLine, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (data.businessPhone) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(`Ph: ${data.businessPhone}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (gstMode && data.businessGstin) {
    doc.fontSize(6).fillColor(colorBlack).font("NotoSans-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  y += 4;
  separator();

  // ── Invoice info ─────────────────────────────────────────────
  // GST-registered businesses get TAX INVOICE / BILL OF SUPPLY;
  // unregistered businesses get plain INVOICE
  const thermalTitle = gstMode
    ? getInvoiceTitle(data)
    : (data.type === "purchase" ? "PURCHASE INVOICE" : "INVOICE");

  doc.fontSize(8).fillColor(colorBlack).font("NotoSans-Bold")
    .text(thermalTitle, margin, y, { width: contentW, align: "center" });
  y += 12;

  doc.fontSize(6).font("NotoSans").fillColor(colorBlack);
  doc.text(`No: ${data.invoiceNumber}`, margin, y);
  doc.text(fmtDate(data.invoiceDate), margin, y, { width: contentW, align: "right" });
  y += 9;

  doc.text(`To: ${data.partyName}`, margin, y, { width: contentW });
  y += 9;

  if (data.partyGstin) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(`GSTIN: ${data.partyGstin}`, margin, y);
    y += 9;
  }

  separator();

  // ── Items header ─────────────────────────────────────────────
  doc.fontSize(6).font("NotoSans-Bold").fillColor(colorBlack);
  doc.text("ITEM", margin, y);
  doc.text("QTY", margin + contentW * 0.5, y, { width: 30, align: "right" });
  doc.text("AMT", margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });
  y += 8;
  separator();

  // ── Line items ───────────────────────────────────────────────
  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i];
    const nameW = contentW * 0.48;

    doc.fontSize(6).font("NotoSans").fillColor(colorBlack)
      .text(item.description, margin, y, { width: nameW });
    const nameH = doc.heightOfString(item.description, { width: nameW });

    doc.fontSize(6).font("NotoSans")
      .text(parseFloat(item.quantity).toString(), margin + contentW * 0.5, y, { width: 30, align: "right" });
    doc.fontSize(6).font("NotoSans")
      .text(fmt(item.totalAmount), margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });

    y += Math.max(nameH, 8) + 1;

    // Sub-line: HSN (if GST mode) + rate + tax
    let subLine = `@ ${fmt(item.unitPrice)} + ${item.taxPercent}% tax`;
    if (gstMode && data.lineItemHsn?.[i]) {
      subLine = `HSN: ${data.lineItemHsn[i]}  ` + subLine;
    }
    doc.fontSize(5).fillColor(colorGray).font("NotoSans")
      .text(subLine, margin + 4, y);
    y += 9;
  }

  separator();

  // ── Totals ───────────────────────────────────────────────────
  // NotoSans used throughout so fmt() ₹ symbol renders correctly
  function totalLine(label: string, value: string, bold = false) {
    const fs = bold ? 8 : 6;
    const font = bold ? "NotoSans-Bold" : "NotoSans";
    doc.fontSize(fs).font(font).fillColor(colorBlack)
      .text(label, margin, y);
    doc.fontSize(fs).font(font).fillColor(colorBlack)
      .text(fmt(value), margin, y, { width: contentW, align: "right" });
    y += bold ? 12 : 9;
  }

  totalLine("Subtotal", data.subtotal);

  if (gstMode && parseFloat(data.taxAmount) > 0) {
    // Show CGST/SGST or IGST breakdown for GST-registered businesses
    const breakdown = buildGstBreakdown(data);
    for (const row of breakdown) {
      if (sameState) {
        if (row.cgst > 0) {
          totalLine(`CGST (${parseFloat(row.rate) / 2}%)`, row.cgst.toFixed(2));
          totalLine(`SGST (${parseFloat(row.rate) / 2}%)`, row.sgst.toFixed(2));
        }
      } else {
        if (row.igst > 0) {
          totalLine(`IGST (${row.rate}%)`, row.igst.toFixed(2));
        }
      }
    }
  } else {
    totalLine("Tax", data.taxAmount);
  }

  if (parseFloat(data.discountAmount) > 0) {
    totalLine("Discount", `-${data.discountAmount}`);
  }

  separator();
  totalLine("TOTAL", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalLine("Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0) totalLine("Balance Due", balance.toFixed(2), true);
  }

  separator();

  // ── Notes ────────────────────────────────────────────────────
  if (data.notes) {
    doc.fontSize(5).fillColor(colorGray).font("NotoSans")
      .text(data.notes, margin, y, { width: contentW, align: "center" });
    y += doc.heightOfString(data.notes, { width: contentW }) + 6;
  }

  // ── Footer ───────────────────────────────────────────────────
  doc.fontSize(5).fillColor(colorGray).font("NotoSans")
    .text("Thank you for your business!", margin, y, { width: contentW, align: "center" });
  y += 8;
  doc.text("Computer generated invoice", margin, y, { width: contentW, align: "center" });
  y += 8;
  if (!data.isPaidPlan) {
    doc.fontSize(5).font("NotoSans").fillColor("#b0b0b0")
      .text("hisaabo.in", margin, y, { width: contentW, align: "center" });
    y += 8;
  } else {
    y += 4;
  }
}

// ── Status stamp ──────────────────────────────────────────────
// Renders a diagonal watermark-style stamp (PAID, OVERDUE, etc.) on the page.
// Drawn with very low opacity so it doesn't impede readability.

function renderStatusStamp(
  doc: InstanceType<typeof PDFDocument>,
  status: string,
  pageWidth: number,
  pageHeight: number
) {
  const stampConfig: Record<string, { text: string; color: string }> = {
    paid:      { text: "PAID",      color: "#10b981" },
    partial:   { text: "PARTIAL",   color: "#f59e0b" },
    overdue:   { text: "OVERDUE",   color: "#ef4444" },
    cancelled: { text: "CANCELLED", color: "#9ca3af" },
    draft:     { text: "DRAFT",     color: "#9ca3af" },
  };

  const config = stampConfig[status];
  if (!config) return; // sent, unfulfilled — no stamp

  doc.save();

  // Translate to page center, then rotate
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;
  doc.translate(centerX, centerY);
  doc.rotate(-30);

  // Font size scales with page width: A4/A5 get 48pt, thermal gets 22pt
  const fontSize = pageWidth > 400 ? 48 : pageWidth > 300 ? 36 : 22;
  doc.font("NotoSans-Bold").fontSize(fontSize);

  const charSpacing = fontSize * 0.15;
  // Measure with character spacing included so the width constraint doesn't clip
  const baseWidth  = doc.widthOfString(config.text);
  const textWidth  = baseWidth + charSpacing * (config.text.length - 1);
  const textHeight = fontSize;
  const padding    = 16;

  // Border rectangle — stamp border effect
  doc
    .rect(
      -textWidth / 2 - padding,
      -textHeight / 2 - padding / 2,
      textWidth + padding * 2,
      textHeight + padding
    )
    .lineWidth(2.5)
    .strokeOpacity(0.12)
    .strokeColor(config.color)
    .stroke();

  // Stamp text — width must accommodate character spacing to prevent wrapping
  doc
    .fillColor(config.color)
    .fillOpacity(0.10)
    .text(config.text, -textWidth / 2, -textHeight / 2, {
      width: textWidth + padding,
      align: "center",
      characterSpacing: charSpacing,
      lineBreak: false,
    });

  doc.restore();
}

// ── Public API ─────────────────────────────────────────────────

export function generateInvoicePDF(data: InvoicePDFData, format: PDFFormat = "a5"): InstanceType<typeof PDFDocument> {
  let docSize: string | number[];
  let docMargin: number;

  if (format === "a4") {
    docSize = "A4";
    docMargin = 36;
  } else if (format === "a5") {
    docSize = [595.28, 419.53]; // A5 landscape (width × height)
    docMargin = 28;
  } else {
    // Thermal: calculate height dynamically to avoid large blank space.
    // Estimate based on fixed chrome (~200pt) plus per-item rows (~30pt each),
    // optional GSTIN line, GST tax breakdown lines, notes, and paid/balance lines.
    const gstMode = data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition";
    const taxBreakdownLines = gstMode && parseFloat(data.taxAmount) > 0
      ? new Set(data.lineItems.map((li) => li.taxPercent)).size * 2 // CGST+SGST per rate
      : 0;
    const estimatedHeight =
      200 +
      data.lineItems.length * 30 +
      (gstMode && data.businessGstin ? 10 : 0) +
      taxBreakdownLines * 9 +
      (parseFloat(data.discountAmount) > 0 ? 9 : 0) +
      (parseFloat(data.amountPaid) > 0 ? 18 : 0) +
      (data.notes ? 20 : 0);
    docSize = [226, Math.max(300, estimatedHeight)];
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

  // Add status stamp on A5 and thermal only — A4 is a formal GST document, no watermark
  if (data.status && format !== "a4") {
    const totalStampPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalStampPages; i++) {
      doc.switchToPage(i);
      renderStatusStamp(doc, data.status, doc.page.width, doc.page.height);
    }
  }

  // Add page numbers if multi-page (not on thermal receipts)
  if (format !== "thermal") {
    const totalPages = doc.bufferedPageRange().count;
    if (totalPages > 1) {
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;
        doc.fontSize(7).font("NotoSans").fillColor("#9ca3af")
          .text(
            `Page ${i + 1} of ${totalPages}`,
            0, pageHeight - 20,
            { width: pageWidth, align: "center" }
          );
      }
    }
  }

  return doc;
}

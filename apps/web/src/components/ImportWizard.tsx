import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import { SlideOver } from "@/components/ui/SlideOver";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

// ── Types ────────────────────────────────────────────────────────────────────

interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
}

type Source = "mybillbook" | "tally" | "generic";
type EntityKey = "parties" | "items" | "invoices" | "payments" | "cashBank";

interface ParsedFile {
  rows: Record<string, string>[];
  headers: string[];
  fileName: string;
  rowCount?: number;
  metadata?: Record<string, string>;
}

interface ColumnMapping {
  [targetField: string]: string; // targetField -> csvHeader
}

interface ImportResult {
  created: number;
  skipped: number;
  total: number;
  errors?: string[];
  details?: string[];  // informational messages, not errors
}

interface StepState {
  source: Source;
  files: Partial<Record<EntityKey, ParsedFile>>;
  rawFiles: Partial<Record<EntityKey, File>>;
  fileNames: Partial<Record<EntityKey, string[]>>; // track all file names per category
  enabled: Record<EntityKey, boolean>;
  mappings: Partial<Record<EntityKey, ColumnMapping>>;
  results: Partial<Record<EntityKey, ImportResult>>;
  currentStep: number;
}

// ── Column presets ────────────────────────────────────────────────────────────

// All Party Balance CSV from myBillBook: Name, GST, Address, State, Pincode, Mob No., Bal., Party Category
const MYBILLBOOK_PARTY_BALANCE_MAP: Record<string, string> = {
  "Name": "name",
  "GST": "gstin",
  "Address": "billingAddress",
  "State": "state",
  "Pincode": "pincode",
  "Mob No.": "phone",
  "Bal.": "openingBalance",
  "Party Category": "category",
};

// Rate List CSV: Name, Code, MRP, Price
const MYBILLBOOK_ITEM_MAP: Record<string, string> = {
  "Name": "name",
  "Code": "sku",
  "Price": "salePrice",
  // Also keep legacy column names so manual-export files still map
  "Item Name": "name",
  "Item Type": "itemType",
  "Sale Price": "salePrice",
  "Purchase Price": "purchasePrice",
  "Tax Rate(%)": "taxPercent",
  "HSN/SAC": "hsn",
  "Measuring Unit": "unit",
  // "Opening Stock" intentionally not mapped — stock is calculated from invoice line items
  "SKU": "sku",
  "Category": "category",
};

// Stock Summary CSV: Name, Batch No., Item Code, Purchase Price, Selling Price, Stock Quantity, Stock Value, Item Category Name, MRP
// Stock Quantity has unit embedded: "-31.5 KGS", "-5.0 PCS"
const MYBILLBOOK_STOCK_SUMMARY_MAP: Record<string, string> = {
  "Name": "name",
  "Item Code": "sku",
  "Purchase Price": "purchasePrice",
  "Selling Price": "salePrice",
  // "Stock Quantity" intentionally not mapped — stock is calculated from invoice line items
  "Item Category Name": "category",
  "MRP": "mrp",
};

// Sales Summary CSV: Invoice No, Invoice Date, Contact Name, Amount, Remaining Amount,
//                    Invoice Status, Due Date, Invoice Link, Payment Type, Party Category, Created by
const MYBILLBOOK_INVOICE_MAP: Record<string, string> = {
  "Invoice No": "invoiceNumber",
  "Invoice Date": "invoiceDate",
  "Contact Name": "partyName",
  "Amount": "totalAmount",
  "Remaining Amount": "remainingAmount",
  "Invoice Status": "status",
  "Due Date": "dueDate",
  "Payment Type": "paymentMode",
  "Party Category": "partyCategory",
  "Created by": "createdByName",
  // Legacy column names
  "Party Name": "partyName",
  "Type": "type",
  "Subtotal": "subtotal",
  "Tax Amount": "taxAmount",
  "Discount": "discountAmount",
  "Total Amount": "totalAmount",
  "Amount Paid": "amountPaid",
  "Notes": "notes",
};

const MYBILLBOOK_PAYMENT_MAP: Record<string, string> = {
  "Payment No": "paymentNumber",
  "Date": "paymentDate",
  "Party Name": "partyName",
  "Amount": "amount",
  "Mode": "mode",
  "Reference Number": "referenceNumber",
  "Notes": "notes",
};

// Cash & Bank Statement PDF columns (no "Invoice numbers" column)
const MYBILLBOOK_CASHBANK_MAP: Record<string, string> = {
  "Date": "paymentDate",
  "Type": "type",
  "Txn No": "paymentNumber",
  "Party": "partyName",
  "Mode": "mode",
  "Paid": "paid",
  "Received": "received",
  "Balance": "balance",
  "Notes": "notes",
};

// Cash & Bank CSV columns — has "Invoice numbers" for exact payment linkage
const MYBILLBOOK_CASHBANK_CSV_MAP: Record<string, string> = {
  "Date": "paymentDate",
  "Type": "type",
  "Txn No": "paymentNumber",
  "Party": "partyName",
  "Invoice numbers": "invoiceNumbers",
  "Mode": "mode",
  "Paid": "paid",
  "Received": "received",
  "Balance": "balance",
  "Notes": "notes",
};

// Field labels for the mapping UI
const PARTY_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "name", label: "Party Name", required: true },
  { key: "type", label: "Party Type" },
  { key: "phone", label: "Mobile Number" },
  { key: "email", label: "Email" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN Number" },
  { key: "openingBalance", label: "Opening Balance" },
  { key: "billingAddress", label: "Billing Address" },
  { key: "shippingAddress", label: "Shipping Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "Pincode" },
];

const ITEM_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "name", label: "Item Name", required: true },
  { key: "itemType", label: "Item Type" },
  { key: "salePrice", label: "Sale Price" },
  { key: "purchasePrice", label: "Purchase Price" },
  { key: "taxPercent", label: "Tax Rate (%)" },
  { key: "hsn", label: "HSN/SAC" },
  { key: "unit", label: "Unit" },
  { key: "stockQuantity", label: "Opening Stock" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
];

const INVOICE_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "invoiceNumber", label: "Invoice No", required: true },
  { key: "invoiceDate", label: "Invoice Date", required: true },
  { key: "partyName", label: "Party Name / Contact Name", required: true },
  { key: "totalAmount", label: "Amount / Total Amount", required: true },
  { key: "remainingAmount", label: "Remaining Amount" },
  { key: "status", label: "Invoice Status" },
  { key: "dueDate", label: "Due Date" },
  { key: "paymentMode", label: "Payment Type" },
  { key: "type", label: "Type" },
  { key: "subtotal", label: "Subtotal" },
  { key: "taxAmount", label: "Tax Amount" },
  { key: "discountAmount", label: "Discount" },
  { key: "amountPaid", label: "Amount Paid" },
  { key: "notes", label: "Notes" },
  { key: "createdByName", label: "Created By" },
];

const PAYMENT_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: "paymentDate", label: "Date", required: true },
  { key: "partyName", label: "Party Name", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "mode", label: "Mode" },
  { key: "paymentNumber", label: "Payment No" },
  { key: "referenceNumber", label: "Reference Number" },
  { key: "notes", label: "Notes" },
];

const ENTITY_FIELDS: Record<EntityKey, typeof PARTY_FIELDS> = {
  parties: PARTY_FIELDS,
  items: ITEM_FIELDS,
  invoices: INVOICE_FIELDS,
  payments: PAYMENT_FIELDS,
  cashBank: PAYMENT_FIELDS, // not used for mapping UI — cashBank uses raw column names
};

const PRESET_MAPS: Record<Source, Partial<Record<EntityKey, Record<string, string>>>> = {
  mybillbook: {
    parties: MYBILLBOOK_PARTY_BALANCE_MAP,
    items: MYBILLBOOK_ITEM_MAP,
    invoices: MYBILLBOOK_INVOICE_MAP,
    payments: MYBILLBOOK_PAYMENT_MAP,
    cashBank: MYBILLBOOK_CASHBANK_MAP,
  },
  tally: {},
  generic: {},
};

const ENTITY_LABELS: Record<EntityKey, string> = {
  parties: "Parties",
  items: "Items",
  invoices: "Invoices",
  payments: "Payments",
  cashBank: "Cash & Bank",
};

const ENTITY_DESCRIPTIONS: Record<EntityKey, string> = {
  parties: "Customers & suppliers",
  items: "Products & services",
  invoices: "Sales & purchase invoices",
  payments: "Payment records",
  cashBank: "Cash & Bank statement",
};

// ── Normalisation helpers ────────────────────────────────────────────────────

function normalizeUnit(raw: string): string {
  const s = raw.toLowerCase().trim();
  // Standard units
  if (s.includes("piece") || s === "pcs" || s === "each") return "pcs";
  if (s.includes("kilogram") || s === "kgs" || s === "kg" || s === "k") return "kg";
  if (s.includes("gram") || s === "gms" || s === "gm" || s === "g") return "g";
  if (s.includes("litre") || s.includes("liter") || s === "ltr" || s === "l") return "l";
  if (s.includes("millilitre") || s === "ml") return "ml";
  if (s.includes("metre") || s.includes("meter") || s === "m") return "m";
  if (s.includes("centi") || s === "cm") return "cm";
  if (s.includes("feet") || s.includes("foot") || s === "ft") return "ft";
  if (s.includes("inch") || s === "in") return "in";
  if (s.includes("box")) return "box";
  if (s.includes("dozen") || s === "dzn") return "dozen";
  if (s.includes("pair")) return "pair";
  if (s === "set" || s === "s") return "set";
  // Indian business units (from myBillBook)
  if (s === "pkt" || s.includes("packet")) return "pkt";
  if (s === "bun" || s.includes("bunch")) return "bun";
  if (s === "poch" || s.includes("pouch")) return "pouch";
  if (s === "jar") return "jar";
  if (s === "btl" || s.includes("bottle")) return "btl";
  if (s === "bag") return "bag";
  if (s === "ton" || s.includes("tonne")) return "ton";
  if (s === "pac" || s === "pack") return "pack";
  if (s === "pet") return "pet";
  if (s === "person") return "person";
  return "other";
}

function normalizePartyType(raw: string): "customer" | "supplier" {
  const s = raw.toLowerCase().trim();
  if (s.includes("supplier") || s === "vendor") return "supplier";
  return "customer";
}

function normalizePaymentMode(raw: string): "cash" | "bank" | "upi" | "cheque" | "other" {
  const s = (raw || "").toLowerCase().trim();
  if (s === "cash") return "cash";
  // CSV exports use "Upi" directly; PDF exports use "Online" for UPI/bank transfer
  if (s === "upi" || s.includes("gpay") || s.includes("phonepe") || s.includes("paytm")) return "upi";
  if (s === "online") return "upi"; // myBillBook Cash & Bank PDF "Online" = UPI/bank transfer
  // myBillBook CSV uses "Bank"; PDF uses "credit" to mean bank/UPI payment (non-cash)
  if (s === "bank" || s === "credit" || s.includes("bank transfer") || s === "neft" || s === "rtgs" || s === "imps") return "bank";
  if (s === "cheque" || s === "check") return "cheque";
  return "other";
}

function normalizeInvoiceType(raw: string): "sale" | "purchase" {
  const s = raw.toLowerCase().trim();
  if (s.includes("purchase") || s.includes("buy")) return "purchase";
  return "sale";
}

function normalizeStatus(raw: string): "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled" {
  const s = raw.toLowerCase().trim();
  if (s === "paid") return "paid";
  if (s === "partial" || s === "partially paid") return "partial";
  if (s === "overdue") return "overdue";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "draft") return "draft";
  return "sent";
}

function cleanMoney(raw: string): string {
  if (!raw) return "0";
  // Strip currency symbols, commas, spaces
  const cleaned = raw.replace(/[₹$,\s]/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return "0";
  return num.toFixed(2);
}

// ── Expected headers for smart header-row detection ───────────────────────────

const EXPECTED_HEADERS: Record<EntityKey, string[]> = {
  items: ["Name", "Price"],
  invoices: ["Invoice No", "Invoice Date", "Contact Name", "Amount"],
  parties: ["Name", "Mob No.", "Bal."],
  payments: ["Payment No", "Date", "Party Name", "Amount"],
  cashBank: ["Txn No", "Paid", "Received"],
};


// FILE_TYPES descriptor for the single-drop-zone UI
const FILE_TYPES: Array<{
  key: EntityKey;
  icon: string;
  label: string;
  description: string;
  required: boolean;
}> = [
  { key: "invoices", icon: "📋", label: "Sales Summary", description: "Invoices with party names, amounts, dates", required: true },
  { key: "parties", icon: "👥", label: "Party Balance", description: "Customer/supplier details with phone, address", required: false },
  { key: "items", icon: "📦", label: "Rate List", description: "Product catalog with prices", required: false },
  { key: "cashBank", icon: "🏦", label: "Cash & Bank Statement", description: "Payment transactions with dates and modes", required: false },
];

// Parse a GST Sales Report CSV using its own expected headers
function parseGstReportRawRows(rawRows: string[][], fileName: string): ParsedFile {
  if (rawRows.length === 0) return { rows: [], headers: [], fileName, rowCount: 0 };
  // Find header row: look for "Invoice No." (with dot) and "Item Name"
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const row = rawRows[i].map((c) => (c || "").trim().toLowerCase());
    if (row.some((c) => c === "invoice no.") && row.some((c) => c === "item name")) {
      headerIdx = i;
      break;
    }
  }
  const headers = rawRows[headerIdx].map((h) => (h || "").trim());
  const dataRows = rawRows.slice(headerIdx + 1);
  const rows = dataRows
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = (row[i] || "").trim();
      });
      return obj;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));
  return { rows, headers, fileName, rowCount: rows.length };
}

// Find the row index that contains column headers (handles myBillBook's
// 8-12 preamble lines before the real header row).
function findHeaderRow(rows: string[][], expectedColumns: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i].map((c) => (c || "").trim().toLowerCase());
    const matches = expectedColumns.filter((col) =>
      row.some((cell) => cell.includes(col.toLowerCase()))
    );
    if (matches.length >= Math.ceil(expectedColumns.length * 0.6)) return i;
  }
  return 0; // fall back to first row
}

// Build a ParsedFile from already-parsed raw rows (used in auto-detection flow).
function parseRawRowsToFile(rawRows: string[][], entityKey: EntityKey, fileName: string): ParsedFile {
  if (rawRows.length === 0) return { rows: [], headers: [], fileName, rowCount: 0 };
  const headerIdx = findHeaderRow(rawRows, EXPECTED_HEADERS[entityKey]);
  const headers = rawRows[headerIdx].map((h) => (h || "").trim());
  const dataRows = rawRows.slice(headerIdx + 1);
  const rows = dataRows
    .map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = (row[i] || "").trim();
      });
      return obj;
    })
    .filter((row) => Object.values(row).some((v) => v !== ""));
  return { rows, headers, fileName, rowCount: rows.length };
}

// Parse a CSV File, auto-detecting the real header row to skip preamble lines.
function parseWithSmartHeaders(
  file: File,
  entityKey: EntityKey,
  onComplete: (parsed: ParsedFile) => void
) {
  Papa.parse(file, {
    header: false,
    skipEmptyLines: true,
    complete: (results) => {
      const allRows = results.data as string[][];
      if (allRows.length === 0) {
        onComplete({ rows: [], headers: [], fileName: file.name });
        return;
      }

      const headerIdx = findHeaderRow(allRows, EXPECTED_HEADERS[entityKey]);
      const headers = allRows[headerIdx].map((h) => (h || "").trim());
      const dataRows = allRows.slice(headerIdx + 1);

      const rows = dataRows
        .map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            if (h) obj[h] = (row[i] || "").trim();
          });
          return obj;
        })
        .filter((row) => Object.values(row).some((v) => v !== ""));

      onComplete({ rows, headers, fileName: file.name });
    },
  });
}

// ── Auto-mapping logic ────────────────────────────────────────────────────────

function buildAutoMapping(
  headers: string[],
  presetMap: Record<string, string>
): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const [csvHeader, targetField] of Object.entries(presetMap)) {
    const found = headers.find(
      (h) => h.trim().toLowerCase() === csvHeader.trim().toLowerCase()
    );
    if (found) {
      mapping[targetField] = found;
    }
  }
  return mapping;
}

// ── Row transformation helpers ────────────────────────────────────────────────

function applyMapping(
  row: Record<string, string>,
  mapping: ColumnMapping
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [targetField, csvHeader] of Object.entries(mapping)) {
    result[targetField] = (row[csvHeader] || "").trim();
  }
  return result;
}

function transformPartyRow(row: Record<string, string>): object {
  return {
    name: row.name || "",
    type: row.type ? normalizePartyType(row.type) : "customer",
    phone: row.phone || undefined,
    email: row.email || undefined,
    gstin: row.gstin || undefined,
    pan: row.pan || undefined,
    openingBalance: row.openingBalance ? cleanMoney(row.openingBalance) : "0",
    billingAddress: row.billingAddress || undefined,
    shippingAddress: row.shippingAddress || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    pincode: row.pincode || undefined,
  };
}

// Parse Stock Summary "Stock Quantity" which has unit embedded: "-31.5 KGS"
function parseStockQuantityWithUnit(raw: string): { quantity: string; unit: string } {
  if (!raw) return { quantity: "0", unit: "pcs" };
  const match = raw.trim().match(/^(-?[\d.]+)\s+(.+)$/);
  if (!match) return { quantity: cleanMoney(raw), unit: "pcs" };
  return {
    quantity: cleanMoney(match[1]),
    unit: normalizeUnit(match[2]),
  };
}

function transformItemRow(row: Record<string, string>): object {
  let stockQty = row.stockQuantity || "0";
  let unit = row.unit || "pcs";

  // Parse unit from stock quantity if embedded (Stock Summary format: "-31.5 KGS")
  if (stockQty && /[a-zA-Z]/.test(stockQty)) {
    const parsed = parseStockQuantityWithUnit(stockQty);
    stockQty = parsed.quantity;
    unit = parsed.unit;
  }

  return {
    name: row.name || "",
    itemType: row.itemType
      ? row.itemType.toLowerCase().includes("service") ? "service" : "product"
      : "product",
    salePrice: row.salePrice && parseFloat(row.salePrice) > 0 ? cleanMoney(row.salePrice) : undefined,
    purchasePrice: row.purchasePrice && parseFloat(row.purchasePrice) > 0 ? cleanMoney(row.purchasePrice) : undefined,
    taxPercent: row.taxPercent ? cleanMoney(row.taxPercent) : "0",
    hsn: row.hsn || undefined,
    unit: normalizeUnit(unit),
    // Opening stock defaults to 0 — actual stock is calculated from imported invoices
    stockQuantity: "0",
    sku: row.sku || undefined,
    category: row.category || undefined,
  };
}

function transformInvoiceRow(row: Record<string, string>): object {
  const totalAmount = cleanMoney(row.totalAmount || "0");

  // myBillBook Sales Summary provides "Remaining Amount" instead of "Amount Paid".
  // Compute amountPaid = totalAmount - remainingAmount.
  let amountPaid: string;
  if (row.remainingAmount !== undefined) {
    const remaining = parseFloat(cleanMoney(row.remainingAmount));
    const total = parseFloat(totalAmount);
    const paid = Math.max(0, total - remaining);
    amountPaid = paid.toFixed(2);
  } else {
    amountPaid = row.amountPaid ? cleanMoney(row.amountPaid) : "0";
  }

  return {
    invoiceNumber: row.invoiceNumber || "",
    invoiceDate: row.invoiceDate || "",
    dueDate: row.dueDate || undefined,
    partyName: row.partyName || "",
    type: row.type ? normalizeInvoiceType(row.type) : "sale",
    status: row.status ? normalizeStatus(row.status) : "sent",
    subtotal: row.subtotal ? cleanMoney(row.subtotal) : totalAmount,
    taxAmount: row.taxAmount ? cleanMoney(row.taxAmount) : "0",
    discountAmount: row.discountAmount ? cleanMoney(row.discountAmount) : "0",
    totalAmount,
    amountPaid,
    paymentMode: row.paymentMode || undefined,
    notes: row.notes || undefined,
    createdByName: row.createdByName || undefined,
  };
}

function transformPaymentRow(row: Record<string, string>): object {
  return {
    paymentNumber: row.paymentNumber || undefined,
    paymentDate: row.paymentDate || "",
    partyName: row.partyName || "",
    amount: row.amount ? cleanMoney(row.amount) : "0",
    mode: row.mode ? normalizePaymentMode(row.mode) : "cash",
    referenceNumber: row.referenceNumber || undefined,
    notes: row.notes || undefined,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Step indicator
function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = ["Source", "Upload", "Map", "Preview", "Import"];
  return (
    <div className="flex items-center gap-0 mb-6">
      {steps.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  done
                    ? "bg-brand-600 text-white"
                    : active
                    ? "bg-brand-50 text-brand-700 ring-2 ring-brand-300"
                    : "bg-surface-2 text-text-tertiary"
                )}
              >
                {done ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  idx
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] mt-0.5 font-medium",
                  active ? "text-brand-700" : "text-text-tertiary"
                )}
              >
                {label}
              </span>
            </div>
            {i < total - 1 && (
              <div
                className={cn(
                  "h-px w-8 mx-1 mb-4 transition-colors",
                  done ? "bg-brand-400" : "bg-border-light"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// File drop zone (used in generic / tally mode — with checkbox toggle)
function DropZone({
  entityKey,
  parsedFile,
  enabled,
  onToggle,
  onFile,
}: {
  entityKey: EntityKey;
  parsedFile: ParsedFile | undefined;
  enabled: boolean;
  onToggle: () => void;
  onFile: (file: ParsedFile) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      // Use smart header detection for all uploads
      parseWithSmartHeaders(file, entityKey, onFile);
    },
    [entityKey, onFile]
  );

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        enabled ? "border-border-light" : "border-dashed border-border-light opacity-50"
      )}
    >
      {/* Entity header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="w-4 h-4 rounded accent-brand-600 cursor-pointer"
          id={`enable-${entityKey}`}
        />
        <label
          htmlFor={`enable-${entityKey}`}
          className="flex-1 cursor-pointer"
        >
          <span className="text-sm font-medium text-text-primary">
            {ENTITY_LABELS[entityKey]}
          </span>
          <span className="text-xs text-text-tertiary ml-2">
            {ENTITY_DESCRIPTIONS[entityKey]}
          </span>
        </label>
        {parsedFile && (
          <span className="text-xs text-text-tertiary bg-surface-2 rounded px-2 py-0.5">
            {parsedFile.rows.length} rows
          </span>
        )}
      </div>

      {/* Drop area (only shown when enabled) */}
      {enabled && (
        <div
          className={cn(
            "mx-4 mb-4 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
            dragging
              ? "border-brand-400 bg-brand-50"
              : parsedFile
              ? "border-brand-300 bg-brand-50"
              : "border-border-light hover:border-brand-300 hover:bg-surface-1"
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <div className="flex flex-col items-center gap-1.5 py-6 px-4 text-center">
            {parsedFile ? (
              <>
                <svg
                  className="w-8 h-8 text-brand-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                  />
                </svg>
                <p className="text-sm font-medium text-brand-700">
                  {parsedFile.fileName}
                </p>
                <p className="text-xs text-text-tertiary">
                  {parsedFile.rows.length} rows &middot;{" "}
                  {parsedFile.headers.length} columns &middot; click to replace
                </p>
              </>
            ) : (
              <>
                <svg
                  className="w-8 h-8 text-text-tertiary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="text-sm text-text-secondary">
                  Drop CSV or click to browse
                </p>
                <p className="text-xs text-text-tertiary">
                  Comma-separated values (.csv)
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Single entity mapping panel
function MappingPanel({
  entityKey,
  parsedFile,
  mapping,
  onChange,
}: {
  entityKey: EntityKey;
  parsedFile: ParsedFile;
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
}) {
  const fields = ENTITY_FIELDS[entityKey];
  const firstRow = parsedFile.rows[0] || {};

  return (
    <div className="rounded-xl border border-border-light overflow-hidden">
      <div
        className="px-4 py-2.5 flex items-center justify-between bg-surface-1 border-b border-border-light"
      >
        <span className="text-sm font-semibold text-text-primary">
          {ENTITY_LABELS[entityKey]}
        </span>
        <span className="text-xs text-text-tertiary">
          {parsedFile.rows.length} rows &middot; {parsedFile.fileName}
        </span>
      </div>
      <div className="divide-y divide-border-light">
        {fields.map((field) => {
          const selectedHeader = mapping[field.key] || "";
          const previewValue = selectedHeader ? (firstRow[selectedHeader] || "") : "";
          return (
            <div
              key={field.key}
              className="grid grid-cols-[180px_1fr_140px] gap-3 items-center px-4 py-2.5"
            >
              <span className="text-sm text-text-primary">
                {field.label}
                {field.required && (
                  <span className="text-red-500 ml-0.5">*</span>
                )}
              </span>
              <select
                value={selectedHeader}
                onChange={(e) =>
                  onChange({ ...mapping, [field.key]: e.target.value })
                }
                className={cn(
                  "input text-sm py-1.5",
                  field.required && !selectedHeader
                    ? "border-red-300 focus:border-red-400"
                    : ""
                )}
              >
                <option value="">— skip —</option>
                {parsedFile.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-tertiary truncate font-mono">
                {previewValue || (selectedHeader ? "(empty)" : "")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Preview table
function PreviewTable({
  entityKey,
  parsedFile,
  mapping,
}: {
  entityKey: EntityKey;
  parsedFile: ParsedFile;
  mapping: ColumnMapping;
}) {
  const fields = ENTITY_FIELDS[entityKey];
  const mappedFields = fields.filter((f) => mapping[f.key]);
  const previewRows = parsedFile.rows.slice(0, 5);

  if (mappedFields.length === 0) return null;

  return (
    <div className="rounded-xl border border-border-light overflow-hidden">
      <div
        className="px-4 py-2.5 flex items-center justify-between bg-surface-1 border-b border-border-light"
      >
        <span className="text-sm font-semibold text-text-primary">
          {ENTITY_LABELS[entityKey]}
        </span>
        <span className="text-xs text-text-tertiary">
          First {Math.min(5, parsedFile.rows.length)} of {parsedFile.rows.length} rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-1">
              {mappedFields.map((f) => (
                <th
                  key={f.key}
                  className="text-left px-3 py-2 text-text-tertiary font-medium border-b border-border-light"
                >
                  {f.label}
                  {f.required && <span className="text-red-400 ml-0.5">*</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {previewRows.map((row, i) => {
              const mapped = applyMapping(row, mapping);
              const missingRequired = fields
                .filter((f) => f.required && mapping[f.key] && !mapped[f.key])
                .length > 0;

              return (
                <tr
                  key={i}
                  className={cn(
                    "transition-colors",
                    missingRequired ? "bg-red-50" : "hover:bg-surface-1"
                  )}
                >
                  {mappedFields.map((f) => (
                    <td
                      key={f.key}
                      className={cn(
                        "px-3 py-2 text-text-secondary truncate max-w-[180px]",
                        f.required && !mapped[f.key] ? "text-red-500 font-medium" : ""
                      )}
                    >
                      {mapped[f.key] || (
                        <span className="text-text-tertiary italic">empty</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Import step row
function ImportStepRow({
  label,
  status,
  result,
}: {
  label: string;
  status: "pending" | "running" | "done" | "skipped";
  result?: ImportResult;
}) {
  const [errorsOpen, setErrorsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border-light overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="shrink-0 w-6 h-6 flex items-center justify-center">
          {status === "pending" && (
            <div className="w-3 h-3 rounded-full border-2 border-border-light" />
          )}
          {status === "running" && (
            <Spinner size="sm" className="text-brand-500" />
          )}
          {status === "done" && (
            <svg
              className="w-5 h-5 text-green-500"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
          )}
          {status === "skipped" && (
            <svg
              className="w-5 h-5 text-text-tertiary"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-sm font-medium",
              status === "pending" ? "text-text-tertiary" : "text-text-primary"
            )}
          >
            {label}
          </span>
          {result && status === "done" && (
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs text-green-600 font-medium">
                {result.created.toLocaleString()} created
              </span>
              {result.skipped > 0 && (
                <span className="text-xs text-text-tertiary">
                  {result.skipped} skipped
                </span>
              )}
              {result.errors && result.errors.length > 0 && (
                <button
                  type="button"
                  onClick={() => setErrorsOpen((v) => !v)}
                  className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                >
                  {result.errors.length} error{result.errors.length > 1 ? "s" : ""}{" "}
                  {errorsOpen ? "▲" : "▼"}
                </button>
              )}
              {result.details && result.details.length > 0 && (
                <span className="text-xs text-text-tertiary">
                  {result.details[0]}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {errorsOpen && result?.errors && result.errors.length > 0 && (
        <div className="px-4 pb-3 pt-0 border-t border-border-light">
          <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1 font-mono bg-amber-600/[0.08] rounded-lg p-2.5 max-h-32 overflow-y-auto">
            {result.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ENTITY_ORDER: EntityKey[] = ["parties", "items", "invoices", "payments", "cashBank"];

export function ImportWizard({ open, onClose }: ImportWizardProps) {
  const [state, setState] = useState<StepState>({
    source: "mybillbook",
    files: {},
    rawFiles: {},
    fileNames: {},
    enabled: { parties: true, items: true, invoices: true, payments: false, cashBank: false },
    mappings: {},
    results: {},
    currentStep: 1,
  });

  // GST Sales Report — separate state (not an EntityKey, enriches invoices with real line items)
  const [gstReportFile, setGstReportFile] = useState<ParsedFile | null>(null);
  const [gstReportNames, setGstReportNames] = useState<string[]>([]);

  // Unit conflict resolution: items sold in multiple units need conversion factors
  // Key = item name (lowercase), value = { units: { unit → count }, resolvedConversions }
  interface UnitConflict {
    itemName: string;               // original case
    baseUnit: string;               // most frequent unit (auto-detected)
    altUnits: { unit: string; count: number; conversionFactor: string }[];
    totalLines: number;
  }
  const [unitConflicts, setUnitConflicts] = useState<UnitConflict[]>([]);

  const [importStatuses, setImportStatuses] = useState<
    Partial<Record<EntityKey, "pending" | "running" | "done" | "skipped">>
  >({});
  const [importDone, setImportDone] = useState(false);

  const importPartiesMut = trpc.import.importParties.useMutation();
  const importItemsMut = trpc.import.importItems.useMutation();
  const importInvoicesMut = trpc.import.importInvoices.useMutation();
  const importPaymentsMut = trpc.import.importPayments.useMutation();
  const importTransfersMut = trpc.import.importTransfers.useMutation();
  const reconcileDirectMut = trpc.import.reconcileDirectPayments.useMutation();
  const createExpenseMut = trpc.expense.create.useMutation();
  const updateItemMut = trpc.item.update.useMutation();
  const trpcUtils = trpc.useUtils();

  const BATCH_SIZE = 50;

  function reset() {
    setState({
      source: "mybillbook",
      files: {},
      rawFiles: {},
      fileNames: {},
      enabled: { parties: true, items: true, invoices: true, payments: false, cashBank: false },
      mappings: {},
      results: {},
      currentStep: 1,
    });
    setGstReportFile(null);
    setGstReportNames([]);
    setUnitConflicts([]);
    setImportStatuses({});
    setImportDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  /**
   * Scan the GST report to detect items sold in multiple units.
   * For each such item, determine the most common unit (→ base) and list
   * alternative units with their line counts. The user will be prompted to
   * enter conversion factors before the import proceeds.
   */
  function detectUnitConflicts() {
    if (!gstReportFile) { setUnitConflicts([]); return; }

    // itemName → { displayName, units: Map<normalizedUnit → count> }
    const itemUnits = new Map<string, { displayName: string; units: Map<string, number> }>();

    for (const row of gstReportFile.rows) {
      const itemName = (row["Item Name"] || "").trim();
      if (!itemName) continue;
      const parsed = parseStockQuantityWithUnit(row["Quantity"] || "");
      const unit = parsed.unit;
      if (!unit || unit === "other") continue;

      const key = itemName.toLowerCase();
      if (!itemUnits.has(key)) {
        itemUnits.set(key, { displayName: itemName, units: new Map() });
      }
      const entry = itemUnits.get(key)!;
      entry.units.set(unit, (entry.units.get(unit) || 0) + 1);
    }

    // Filter to items with 2+ distinct units
    const conflicts: UnitConflict[] = [];
    for (const [, entry] of itemUnits) {
      if (entry.units.size < 2) continue;

      // Most frequent unit = base
      let baseUnit = "";
      let maxCount = 0;
      for (const [u, c] of entry.units) {
        if (c > maxCount) { baseUnit = u; maxCount = c; }
      }

      const altUnits: UnitConflict["altUnits"] = [];
      let totalLines = 0;
      for (const [u, c] of entry.units) {
        totalLines += c;
        if (u !== baseUnit) {
          altUnits.push({ unit: u, count: c, conversionFactor: "" });
        }
      }

      conflicts.push({
        itemName: entry.displayName,
        baseUnit,
        altUnits,
        totalLines,
      });
    }

    // Sort by total lines descending (most impactful first)
    conflicts.sort((a, b) => b.totalLines - a.totalLines);
    setUnitConflicts(conflicts);
  }

  // When source changes, re-run auto-mapping for any already-uploaded files
  function handleSourceChange(source: Source) {
    const newMappings: Partial<Record<EntityKey, ColumnMapping>> = {};
    const preset = PRESET_MAPS[source];
    for (const key of ENTITY_ORDER) {
      const file = state.files[key];
      if (file && preset[key]) {
        newMappings[key] = buildAutoMapping(file.headers, preset[key]!);
      } else if (state.mappings[key]) {
        newMappings[key] = state.mappings[key];
      }
    }
    setState((s) => ({ ...s, source, mappings: newMappings }));
  }

  function handleFile(entityKey: EntityKey, parsedFile: ParsedFile) {
    const preset = PRESET_MAPS[state.source][entityKey];
    const mapping = preset
      ? buildAutoMapping(parsedFile.headers, preset)
      : {};
    setState((s) => ({
      ...s,
      files: { ...s.files, [entityKey]: parsedFile },
      mappings: { ...s.mappings, [entityKey]: mapping },
    }));
  }

  // ── Single drop-zone for myBillBook (auto-detect) ──────────────────────────

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  // Detect file type from content, then parse and store it.
  async function detectAndStore(file: File): Promise<void> {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const { parsePdfTable } = await import("@/lib/pdf-table-parser");
      const result = await parsePdfTable(file);
      const parsed: ParsedFile = {
        headers: result.headers,
        rows: result.rows,
        rowCount: result.rows.length,
        fileName: file.name,
        metadata: result.metadata,
      };
      const preset = PRESET_MAPS["mybillbook"]["cashBank"];
      const mapping = preset ? buildAutoMapping(parsed.headers, preset) : {};
      setState((s) => {
        const existing = s.files.cashBank;
        const existingNames = s.fileNames.cashBank || [];
        const mergedParsed: ParsedFile = existing
          ? {
              ...parsed,
              rows: [...existing.rows, ...parsed.rows],
              fileName: `${existingNames.length + 1} files`,
            }
          : parsed;
        return {
          ...s,
          rawFiles: { ...s.rawFiles, cashBank: file },
          files: { ...s.files, cashBank: mergedParsed },
          fileNames: { ...s.fileNames, cashBank: [...existingNames, file.name] },
          mappings: { ...s.mappings, cashBank: mapping },
        };
      });
      return;
    }

    // CSV — parse without headers to find the real header row
    await new Promise<void>((resolve) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const rawRows = results.data as string[][];

          // Detect type from header content
          let detectedType: EntityKey | "unknown" = "unknown";
          for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
            const rowText = rawRows[i].join(",").toLowerCase();

            // GST Sales Report: has "item name" + "price/unit" (detect BEFORE Sales Summary
            // because GST report also contains "invoice no." which would match a loose check)
            if (rowText.includes("item name") && rowText.includes("price/unit")) {
              const parsed = parseGstReportRawRows(rawRows, file.name);
              setGstReportFile((prev) => {
                if (prev) {
                  return { ...parsed, rows: [...prev.rows, ...parsed.rows], fileName: "merged" };
                }
                return parsed;
              });
              setGstReportNames((prev) => [...prev, file.name]);
              toast.success(`Detected: GST Sales Report (${parsed.rows.length} line items)`);
              resolve();
              return;
            }

            if (rowText.includes("invoice no") && rowText.includes("contact name")) {
              detectedType = "invoices";
              break;
            }
            if (rowText.includes("mob no") && rowText.includes("bal.")) {
              detectedType = "parties";
              break;
            }
            // Cash & Bank CSV: has "Invoice numbers" column + "Txn No" + Paid/Received
            if (rowText.includes("invoice numbers") && rowText.includes("txn no")) {
              detectedType = "cashBank";
              break;
            }
            // Stock Summary: has "Stock Quantity" (with embedded unit) + "Selling Price"
            // Wins over Rate List detection
            if (rowText.includes("stock quantity") && rowText.includes("selling price")) {
              detectedType = "items";
              break;
            }
            if (
              rowText.includes("name") &&
              rowText.includes("code") &&
              rowText.includes("price") &&
              !rowText.includes("invoice")
            ) {
              detectedType = "items";
              break;
            }
          }

          if (detectedType === "unknown") {
            toast.error(`Could not identify file: ${file.name}`);
            resolve();
            return;
          }

          const parsed = parseRawRowsToFile(rawRows, detectedType, file.name);
          // Choose sub-variant preset:
          // - items: Stock Summary wins over Rate List if "Stock Quantity" header present
          // - cashBank: CSV variant uses MYBILLBOOK_CASHBANK_CSV_MAP (has "Invoice numbers")
          let preset: Record<string, string> | undefined = PRESET_MAPS["mybillbook"][detectedType];
          if (detectedType === "items") {
            const isStockSummary = parsed.headers.some((h) => h.toLowerCase().includes("stock quantity"));
            if (isStockSummary) preset = MYBILLBOOK_STOCK_SUMMARY_MAP;
          } else if (detectedType === "cashBank") {
            // CSV cash & bank always has "Invoice numbers" column
            preset = MYBILLBOOK_CASHBANK_CSV_MAP;
          }
          const mapping = preset ? buildAutoMapping(parsed.headers, preset) : {};
          setState((s) => {
            const existing = s.files[detectedType];
            const existingNames = s.fileNames[detectedType] || [];
            // Merge rows if a file of the same category was already dropped
            const mergedParsed: ParsedFile = existing
              ? {
                  ...parsed,
                  rows: [...existing.rows, ...parsed.rows],
                  fileName: `${existingNames.length + 1} files`,
                }
              : parsed;
            return {
              ...s,
              rawFiles: { ...s.rawFiles, [detectedType]: file },
              files: { ...s.files, [detectedType]: mergedParsed },
              fileNames: { ...s.fileNames, [detectedType]: [...existingNames, file.name] },
              mappings: { ...s.mappings, [detectedType]: mapping },
            };
          });
          resolve();
        },
      });
    });
  }

  async function processFiles(files: File[]) {
    setIsProcessing(true);
    try {
      for (const file of files) {
        await detectAndStore(file);
      }
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleMultiDrop(e: { preventDefault(): void; dataTransfer: DataTransfer }) {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  }

  async function handleMultiSelect(fileList: FileList | null) {
    if (!fileList) return;
    await processFiles(Array.from(fileList));
  }

  function removeDetectedFile(key: EntityKey) {
    setState((s) => {
      const newFiles = { ...s.files };
      const newRawFiles = { ...s.rawFiles };
      const newMappings = { ...s.mappings };
      const newFileNames = { ...s.fileNames };
      delete newFiles[key];
      delete newRawFiles[key];
      delete newMappings[key];
      delete newFileNames[key];
      return { ...s, files: newFiles, rawFiles: newRawFiles, mappings: newMappings, fileNames: newFileNames };
    });
  }

  function toggleEnabled(entityKey: EntityKey) {
    setState((s) => ({
      ...s,
      enabled: { ...s.enabled, [entityKey]: !s.enabled[entityKey] },
    }));
  }

  function setMapping(entityKey: EntityKey, mapping: ColumnMapping) {
    setState((s) => ({
      ...s,
      mappings: { ...s.mappings, [entityKey]: mapping },
    }));
  }

  // ── Step validation ────────────────────────────────────────────────────────

  function canProceedFromUpload(): boolean {
    if (state.source === "mybillbook") {
      // Sales Summary (invoices) is required; Rate List (items) is optional
      return !!state.files.invoices;
    }
    // At least one entity must be enabled and have a file
    return ENTITY_ORDER.some((k) => state.enabled[k] && state.files[k]);
  }

  function canProceedFromMapping(): boolean {
    if (state.source === "mybillbook") {
      // For myBillBook, only validate the files that were uploaded
      const keysToCheck: EntityKey[] = ["invoices"];
      if (state.files.items) keysToCheck.push("items");
      for (const key of keysToCheck) {
        const mapping = state.mappings[key] || {};
        const requiredFields = ENTITY_FIELDS[key].filter((f) => f.required);
        for (const field of requiredFields) {
          if (!mapping[field.key]) return false;
        }
      }
      return true;
    }
    for (const key of ENTITY_ORDER) {
      if (!state.enabled[key] || !state.files[key]) continue;
      const mapping = state.mappings[key] || {};
      const requiredFields = ENTITY_FIELDS[key].filter((f) => f.required);
      for (const field of requiredFields) {
        if (!mapping[field.key]) return false;
      }
    }
    return true;
  }

  // ── Import execution ──────────────────────────────────────────────────────

  async function runImport() {
    setState((s) => ({ ...s, currentStep: 5 }));
    setImportDone(false);

    if (state.source === "mybillbook") {
      await runMyBillBookImport();
    } else {
      await runGenericImport();
    }

    setImportDone(true);
  }

  // Smart myBillBook import: Parties → Items → Invoices + Payments → Cash & Bank
  async function runMyBillBookImport() {
    const newResults: Partial<Record<EntityKey, ImportResult>> = {};
    const invoicesFile = state.files.invoices;
    const itemsFile = state.files.items;
    const partiesFile = state.files.parties;
    const cashBankFile = state.files.cashBank;

    // Initialise all statuses
    setImportStatuses({
      parties: "pending",
      items: itemsFile ? "pending" : "skipped",
      invoices: invoicesFile ? "pending" : "skipped",
      payments: "skipped", // payments come from Cash & Bank step
      cashBank: cashBankFile ? "pending" : "skipped",
    });

    // ── Step 1: Import parties ─────────────────────────────────────────────
    setImportStatuses((s) => ({ ...s, parties: "running" }));
    try {
      let partyBalanceCreated = 0;
      let fallbackCreated = 0;

      // Step 1a: Import from Party Balance CSV if available (rich data)
      if (partiesFile) {
        const partyMapping = state.mappings.parties || {};
        const mappedRows = partiesFile.rows.map((row) => applyMapping(row, partyMapping));
        const transformedRows = mappedRows
          .map((row) => ({
            name: row.name || "",
            type: "customer" as const,
            phone: row.phone || undefined,
            gstin: row.gstin || undefined,
            billingAddress: row.billingAddress || undefined,
            state: row.state || undefined,
            pincode: row.pincode || undefined,
            openingBalance: cleanMoney(row.openingBalance || "0"),
            category: row.category || undefined,
          }))
          .filter((r) => r.name.trim() !== "");

        for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
          const batch = transformedRows.slice(i, i + BATCH_SIZE);
          const res = await importPartiesMut.mutateAsync({ source: "mybillbook", parties: batch });
          partyBalanceCreated += res.created;
        }
      }

      // Step 1b: Extract unique party names from Sales Summary as fallback
      // (only imports names not already imported — server skips duplicates by name)
      if (invoicesFile) {
        const invMapping = state.mappings.invoices || {};
        const mappedRows = invoicesFile.rows.map((row) => applyMapping(row, invMapping));
        const seen = new Set<string>();
        const fallbackParties: Array<{ name: string; type: "customer" }> = [];
        for (const row of mappedRows) {
          const name = (row.partyName || "").trim();
          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            fallbackParties.push({ name, type: "customer" });
          }
        }

        if (fallbackParties.length > 0) {
          for (let i = 0; i < fallbackParties.length; i += BATCH_SIZE) {
            const batch = fallbackParties.slice(i, i + BATCH_SIZE);
            const res = await importPartiesMut.mutateAsync({ source: "mybillbook", parties: batch });
            fallbackCreated += res.created;
          }
        }
      }

      const totalCreated = partyBalanceCreated + fallbackCreated;
      const details: string[] = [];
      if (partyBalanceCreated > 0) details.push(`${partyBalanceCreated} from Party Balance`);
      if (fallbackCreated > 0) details.push(`${fallbackCreated} new from Sales Summary`);

      newResults.parties = {
        created: totalCreated,
        skipped: 0,
        total: totalCreated,
        errors: [],
        details: details.length > 0 ? [details.join(", ")] : [],
      };
      setImportStatuses((s) => ({ ...s, parties: "done" }));
      setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error("Failed to import Parties", message);
      newResults.parties = { created: 0, skipped: 0, total: 0, errors: [message] };
      setImportStatuses((s) => ({ ...s, parties: "done" }));
      setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
    }

    // ── Step 2: Import items from Rate List ────────────────────────────────
    if (itemsFile) {
      setImportStatuses((s) => ({ ...s, items: "running" }));
      try {
        // Build item-to-unit map from GST report if available (most reliable unit source)
        const gstUnitMap = new Map<string, string>();
        if (gstReportFile) {
          for (const row of gstReportFile.rows) {
            const name = (row["Item Name"] || "").trim().toLowerCase();
            if (!name) continue;
            const parsed = parseStockQuantityWithUnit(row["Quantity"] || "");
            if (parsed.unit !== "other" && !gstUnitMap.has(name)) {
              gstUnitMap.set(name, parsed.unit);
            }
          }
        }

        const itemMapping = state.mappings.items || {};
        const mappedRows = itemsFile.rows.map((row) => applyMapping(row, itemMapping));
        const transformedRows = mappedRows.map((row) => {
          const item = transformItemRow(row);
          // If item unit is still "pcs" (default) and GST report has a better unit, use it
          const itemObj = item as any;
          if ((!itemObj.unit || itemObj.unit === "pcs" || itemObj.unit === "other") && gstUnitMap.size > 0) {
            const gstUnit = gstUnitMap.get((itemObj.name || "").toLowerCase());
            if (gstUnit) itemObj.unit = gstUnit;
          }
          return itemObj;
        }) as Parameters<typeof importItemsMut.mutateAsync>[0]["items"];

        let created = 0, skipped = 0, total = 0;
        for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
          const batch = transformedRows.slice(i, i + BATCH_SIZE);
          const res = await importItemsMut.mutateAsync({ source: "mybillbook", items: batch });
          created += res.created;
          skipped += res.skipped;
          total += res.total;
        }
        newResults.items = { created, skipped, total };
        setImportStatuses((s) => ({ ...s, items: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to import Items", message);
        newResults.items = { created: 0, skipped: 0, total: 0, errors: [message] };
        setImportStatuses((s) => ({ ...s, items: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      }
    }

    // ── Step 2b: Configure alt units on items with resolved unit conflicts ──
    const resolvedConflicts = unitConflicts.filter((c) =>
      c.altUnits.some((a) => parseFloat(a.conversionFactor) > 0)
    );
    if (resolvedConflicts.length > 0) {
      try {
        // Fetch current items to get IDs by name (page through all)
        const firstPage = await trpcUtils.item.list.fetch({ page: 1, limit: 100 });
        const allItems = [...firstPage.data];
        const totalPages = Math.ceil(firstPage.total / 200);
        for (let p = 2; p <= totalPages; p++) {
          const page = await trpcUtils.item.list.fetch({ page: p, limit: 100 });
          allItems.push(...page.data);
        }
        const itemsByName = new Map(
          allItems.map((i) => [i.name.toLowerCase(), i])
        );

        for (const conflict of resolvedConflicts) {
          const item = itemsByName.get(conflict.itemName.toLowerCase());
          if (!item) continue;

          const resolvedAlts = conflict.altUnits
            .filter((a) => parseFloat(a.conversionFactor) > 0)
            .map((a) => ({
              unit: a.unit,
              conversionFactor: parseFloat(a.conversionFactor),
              salePrice: item.salePrice || "0",
            }));

          if (resolvedAlts.length > 0) {
            await updateItemMut.mutateAsync({
              id: item.id,
              data: {
                itemMode: "alt_units" as const,
                unitVariants: resolvedAlts,
              },
            });
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to set up alt units", message);
      }
    }

    // ── Step 3: Import invoices with auto-payment creation ─────────────────
    if (invoicesFile) {
      setImportStatuses((s) => ({ ...s, invoices: "running" }));
      try {
        const invMapping = state.mappings.invoices || {};
        const mappedRows = invoicesFile.rows.map((row) => applyMapping(row, invMapping));

        // Build invoice number → line items map from GST Sales Report (if present)
        const lineItemsByInvoice = new Map<string, Array<{
          itemName: string;
          description: string;
          quantity: string;
          unit?: string;
          conversionFactor?: string;
          unitPrice: string;
          taxPercent: string;
          discountPercent: string;
        }>>();

        // Build conversion lookup from resolved unit conflicts:
        // key = "itemname|unit" → conversionFactor string
        const conversionLookup = new Map<string, string>();
        for (const conflict of unitConflicts) {
          for (const alt of conflict.altUnits) {
            if (alt.conversionFactor && parseFloat(alt.conversionFactor) > 0) {
              conversionLookup.set(
                `${conflict.itemName.toLowerCase()}|${alt.unit}`,
                alt.conversionFactor
              );
            }
          }
        }

        if (gstReportFile) {
          for (const row of gstReportFile.rows) {
            const invoiceNo = (row["Invoice No."] || row["Invoice No"] || "").trim();
            if (!invoiceNo) continue;

            // Parse quantity with embedded unit: "3.6 KGS" → qty "3.6", unit "kg"
            const qtyRaw = row["Quantity"] || "1";
            const qtyParsed = parseStockQuantityWithUnit(qtyRaw);
            const qty = qtyParsed.quantity.replace(/^-/, ""); // strip negative
            const lineUnit = qtyParsed.unit; // normalized unit from the quantity column

            const unitPrice = cleanMoney(row["Price/Unit"] || "0");

            // Combined tax rate: SGST+CGST for intra-state, IGST for inter-state
            const sgstRate = parseFloat(row["SGST Rate(%)"] || "0");
            const cgstRate = parseFloat(row["CGST Rate (%)"] || "0");
            const igstRate = parseFloat(row["IGST Rate (%)"] || "0");
            const taxPercent = igstRate > 0
              ? igstRate.toString()
              : (sgstRate + cgstRate > 0 ? (sgstRate + cgstRate).toString() : "0");

            const itemName = (row["Item Name"] || "").trim();
            if (!itemName) continue;

            // Look up conversion factor if this line uses an alt unit
            const cf = conversionLookup.get(`${itemName.toLowerCase()}|${lineUnit}`) || undefined;

            if (!lineItemsByInvoice.has(invoiceNo)) {
              lineItemsByInvoice.set(invoiceNo, []);
            }
            lineItemsByInvoice.get(invoiceNo)!.push({
              itemName,
              description: itemName,
              quantity: qty || "1",
              unit: lineUnit,
              conversionFactor: cf,
              unitPrice,
              taxPercent,
              discountPercent: "0",
            });
          }
        }

        // Transform and attach line items where available
        // Also reconcile totals: Sales Summary governs the final amount
        const transformedRows = mappedRows.map((row) => {
          const base = transformInvoiceRow(row) as Record<string, unknown>;
          const invoiceNo = (base.invoiceNumber as string | undefined) || "";
          const items = invoiceNo ? lineItemsByInvoice.get(invoiceNo) : undefined;
          if (items && items.length > 0) {
            const salesTotalStr = (base.totalAmount as string) || "0";
            const salesTotal = parseFloat(salesTotalStr);
            const gstLineTotal = items.reduce((sum, li) => {
              const qty = parseFloat(li.quantity) || 0;
              const price = parseFloat(li.unitPrice) || 0;
              const tax = parseFloat(li.taxPercent) || 0;
              const subtotal = qty * price;
              const taxAmt = subtotal * (tax / 100);
              return sum + subtotal + taxAmt;
            }, 0);

            // Reconcile: Sales Summary total is the truth
            // Positive diff = shipping/charges, negative diff = discount (including 100% gratis)
            const diff = salesTotal - gstLineTotal;
            const charges = diff > 0.5 ? [{ label: "Shipping", amount: diff.toFixed(2) }] : undefined;
            const discountAmount = diff < -0.5 ? Math.abs(diff).toFixed(2) : undefined;

            return {
              ...base,
              lineItems: items,
              ...(charges ? { charges } : {}),
              ...(discountAmount ? { discountAmount } : {}),
            };
          }
          return base;
        }) as Parameters<typeof importInvoicesMut.mutateAsync>[0]["invoices"];

        let created = 0, skipped = 0, total = 0;
        const errors: string[] = [];
        for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
          const batch = transformedRows.slice(i, i + BATCH_SIZE);
          // Never auto-create payments from invoices — payments come from Cash & Bank data only
          const res = await importInvoicesMut.mutateAsync({
            source: "mybillbook",
            autoCreatePayments: false,
            invoices: batch,
          });
          created += res.created;
          skipped += res.skipped;
          total += res.total;
          if (res.errors) errors.push(...res.errors);
        }
        newResults.invoices = { created, skipped, total, errors };
        setImportStatuses((s) => ({ ...s, invoices: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to import Invoices", message);
        newResults.invoices = { created: 0, skipped: 0, total: 0, errors: [message] };
        setImportStatuses((s) => ({ ...s, invoices: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      }
    }

    // Track allocated invoice IDs across all C&B batches for reconciliation
    let allAllocatedInvoiceIds: string[] = [];

    // ── Step 4: Import payments from Cash & Bank PDF ───────────────────────
    if (cashBankFile) {
      setImportStatuses((s) => ({ ...s, cashBank: "running" }));
      try {
        const cashBankRows = cashBankFile.rows;

        // Extract account name from PDF metadata (e.g., "Account Display Name: jo.augp@aubank")
        const accountName = cashBankFile.metadata?.["Account Display Name"] || null;

        // Detect whether this is a CSV (has "Invoice numbers" column) or PDF
        const isCashBankCsv = cashBankFile.headers.includes("Invoice numbers");

        // ── Extract inter-account transfers (Add Money / Reduce Money pairs) ──
        // "Add Money" = money received into an account (Received column)
        // "Reduce Money" = money sent from an account (Paid column)
        // They come in pairs with matching Txn No — one is the source, other is dest
        const addMoneyRows = cashBankRows.filter((r) => (r["Type"] || "").toLowerCase() === "add money");
        const reduceMoneyRows = cashBankRows.filter((r) => (r["Type"] || "").toLowerCase() === "reduce money");

        // Match pairs by Txn No + amount
        const transfers: Array<{ date: string; amount: string; fromMode: string; toMode: string; notes?: string; txnNo?: string }> = [];
        for (const addRow of addMoneyRows) {
          const txnNo = (addRow["Txn No"] || "").trim();
          const received = parseFloat(cleanMoney(addRow["Received"] || "0"));
          if (received <= 0) continue;

          // The "Add Money" side receives — its Mode tells us WHERE money went TO
          const toMode = normalizePaymentMode(addRow["Mode"] || "bank");

          // Find matching "Reduce Money" with same Txn No
          const matchingReduce = reduceMoneyRows.find((r) => (r["Txn No"] || "").trim() === txnNo);
          // The "Reduce Money" side pays — its Mode tells us WHERE money came FROM
          const fromMode = matchingReduce
            ? normalizePaymentMode(matchingReduce["Mode"] || "cash")
            : (toMode === "bank" ? "cash" : "bank"); // best guess if no match

          transfers.push({
            date: addRow["Date"] || "",
            amount: received.toFixed(2),
            fromMode: fromMode === "upi" ? "upi" : fromMode === "bank" ? "bank" : "cash",
            toMode: toMode === "upi" ? "upi" : toMode === "bank" ? "bank" : "cash",
            notes: (addRow["Notes"] || "").replace(/"/g, "").trim() || undefined,
            txnNo: txnNo || undefined,
          });
        }

        // Import transfers (also auto-creates Cash/Bank/UPI accounts if missing)
        let transfersCreated = 0;
        if (transfers.length > 0) {
          try {
            const res = await importTransfersMut.mutateAsync({ transfers });
            transfersCreated = res.created;
          } catch {
            // Non-fatal
          }
        }

        // Accept all transaction types that involve money movement:
        // Payment-in, Payment-out, Sales Invoice, Purchase Invoice, etc.
        // Skip "Opening Balance", "Add Money", "Reduce Money" and summary rows
        const paymentRows = cashBankRows
          .filter((row) => {
            const type = (row["Type"] || "").toLowerCase();
            // Skip non-transaction rows and transfers (handled separately)
            if (type.includes("opening balance") || type === "add money" || type === "reduce money" || !type) return false;
            // Accept payments, invoices marked as received/paid
            const received = parseFloat(cleanMoney(row["Received"] || "0"));
            const paid = parseFloat(cleanMoney(row["Paid"] || "0"));
            return received > 0 || paid > 0;
          })
          .map((row) => {
            const received = parseFloat(cleanMoney(row["Received"] || "0"));
            const paid = parseFloat(cleanMoney(row["Paid"] || "0"));
            const isIncoming = received > 0;
            const amount = isIncoming ? received : paid;
            const txnNo = (row["Txn No"] || "").trim();
            const type = (row["Type"] || "").trim();

            // Parse invoice numbers from CSV "Invoice numbers" column (comma-separated)
            const invoiceNumbers: string[] | undefined = isCashBankCsv
              ? (row["Invoice numbers"] || "")
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined;

            return {
              paymentNumber: txnNo || undefined,
              paymentDate: row["Date"] || "",
              partyName: row["Party"] || "",
              amount: amount.toFixed(2),
              mode: normalizePaymentMode(row["Mode"] || (isCashBankCsv ? "cash" : "online")),
              notes: [type, accountName, row["Notes"]].filter(Boolean).join(" | ") || undefined,
              ...(invoiceNumbers && invoiceNumbers.length > 0 ? { invoiceNumbers } : {}),
            };
          })
          .filter((p) => p.partyName && parseFloat(p.amount) > 0);

        // Count expense rows for informational purposes
        const expenseRows = cashBankRows.filter((row) =>
          (row["Type"] || "").toLowerCase().includes("expense")
        );

        let created = 0, skipped = 0;
        const errors: string[] = [];

        // Collect invoice numbers that were "Paid" in Sales Summary
        // (used on last batch to create auto-payments for direct-paid invoices)
        const paidInvoiceNumbers: string[] = [];
        if (invoicesFile) {
          const invoiceMapping = state.mappings.invoices || {};
          for (const row of invoicesFile.rows) {
            const mapped = applyMapping(row, invoiceMapping);
            const invNum = mapped.invoiceNumber || "";
            const status = (mapped.status || "").toLowerCase();
            if (invNum && status === "paid") {
              paidInvoiceNumbers.push(invNum);
            }
          }
        }

        const totalBatches = Math.ceil(paymentRows.length / BATCH_SIZE);
        for (let i = 0; i < paymentRows.length; i += BATCH_SIZE) {
          const batch = paymentRows.slice(i, i + BATCH_SIZE);
          const isLastBatch = Math.floor(i / BATCH_SIZE) + 1 === totalBatches;
          const res = await importPaymentsMut.mutateAsync({
            source: "mybillbook",
            payments: batch,
            // Send paid invoice list on last batch to trigger direct-paid reconciliation
            ...(isLastBatch ? { paidInvoiceNumbers } : {}),
          });
          created += res.created;
          skipped += res.skipped;
          if (res.errors) errors.push(...res.errors);
        }

        // Import expense rows
        let expensesCreated = 0;
        for (const row of expenseRows) {
          try {
            const paid = parseFloat(cleanMoney(row["Paid"] || "0"));
            if (paid <= 0) continue;

            const dateStr = row["Date"] || "";
            const party = (row["Party"] || "").trim();
            const type = (row["Type"] || "Expense").trim();
            // Use the party name as description, Type as category
            const category = type.includes("Expense") ? (party || "General") : type;
            const description = party && party !== category ? `${type} — ${party}` : type;

            // Parse date to ISO format (myBillBook uses DD/MM/YYYY)
            let expenseDate: string | undefined;
            if (dateStr) {
              const parts = dateStr.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
              if (parts) {
                const d = new Date(+parts[3], +parts[2] - 1, +parts[1]);
                if (!isNaN(d.getTime())) expenseDate = d.toISOString();
              } else {
                const iso = new Date(dateStr);
                if (!isNaN(iso.getTime())) expenseDate = iso.toISOString();
              }
            }

            await createExpenseMut.mutateAsync({
              category,
              description,
              amount: paid.toFixed(2),
              mode: normalizePaymentMode(row["Mode"] || "cash"),
              expenseDate,
              referenceNumber: (row["Txn No"] || "").trim() || undefined,
            });
            expensesCreated++;
          } catch (expErr) {
            // Expense creation failed — non-fatal, continue with next
            errors.push(`Expense "${row["Party"] || row["Type"]}" failed: ${expErr instanceof Error ? expErr.message : "Unknown"}`);
          }
        }
        if (expensesCreated > 0) {
          created += expensesCreated;
        }

        const details: string[] = [];
        if (transfersCreated > 0) details.push(`${transfersCreated} inter-account transfers`);
        if (expensesCreated > 0) details.push(`${expensesCreated} expenses`);

        newResults.cashBank = {
          created: created + transfersCreated,
          skipped,
          total: cashBankRows.length,
          errors,
          details: details.length > 0 ? details : undefined,
        };
        setImportStatuses((s) => ({ ...s, cashBank: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error("Failed to import Cash & Bank payments", message);
        newResults.cashBank = { created: 0, skipped: 0, total: 0, errors: [message] };
        setImportStatuses((s) => ({ ...s, cashBank: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      }
    }

    // NOTE: Auto-creation of payments for direct-paid invoices is disabled until
    // the import pipeline moves to the backend with proper modular reconciliation.
    // The C&B payments + invoice amountPaid data is sufficient for now.
  }

  // Generic import (Tally / custom CSV) — original sequential flow
  async function runGenericImport() {
    const statuses: Partial<Record<EntityKey, "pending" | "running" | "done" | "skipped">> = {};
    for (const key of ENTITY_ORDER) {
      statuses[key] =
        state.enabled[key] && state.files[key] ? "pending" : "skipped";
    }
    setImportStatuses({ ...statuses });

    const newResults: Partial<Record<EntityKey, ImportResult>> = {};

    for (const key of ENTITY_ORDER) {
      if (statuses[key] === "skipped") continue;

      setImportStatuses((s) => ({ ...s, [key]: "running" }));

      const parsedFile = state.files[key]!;
      const mapping = state.mappings[key] || {};

      try {
        const allMappedRows = parsedFile.rows.map((row) =>
          applyMapping(row, mapping)
        );

        if (key === "parties") {
          const transformedRows = allMappedRows.map(transformPartyRow) as Parameters<
            typeof importPartiesMut.mutateAsync
          >[0]["parties"];
          let created = 0, skipped = 0, total = 0;
          const errors: string[] = [];
          for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
            const batch = transformedRows.slice(i, i + BATCH_SIZE);
            const res = await importPartiesMut.mutateAsync({ source: state.source, parties: batch });
            created += res.created;
            skipped += res.skipped;
            total += res.total;
          }
          newResults[key] = { created, skipped, total, errors };

        } else if (key === "items") {
          const transformedRows = allMappedRows.map(transformItemRow) as Parameters<
            typeof importItemsMut.mutateAsync
          >[0]["items"];
          let created = 0, skipped = 0, total = 0;
          const errors: string[] = [];
          for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
            const batch = transformedRows.slice(i, i + BATCH_SIZE);
            const res = await importItemsMut.mutateAsync({ source: state.source, items: batch });
            created += res.created;
            skipped += res.skipped;
            total += res.total;
          }
          newResults[key] = { created, skipped, total, errors };

        } else if (key === "invoices") {
          const transformedRows = allMappedRows.map(transformInvoiceRow) as Parameters<
            typeof importInvoicesMut.mutateAsync
          >[0]["invoices"];
          let created = 0, skipped = 0, total = 0;
          const errors: string[] = [];
          for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
            const batch = transformedRows.slice(i, i + BATCH_SIZE);
            const res = await importInvoicesMut.mutateAsync({ source: state.source, invoices: batch });
            created += res.created;
            skipped += res.skipped;
            total += res.total;
            if (res.errors) errors.push(...res.errors);
          }
          newResults[key] = { created, skipped, total, errors };

        } else if (key === "payments") {
          const transformedRows = allMappedRows.map(transformPaymentRow) as Parameters<
            typeof importPaymentsMut.mutateAsync
          >[0]["payments"];
          let created = 0, skipped = 0, total = 0;
          const errors: string[] = [];
          for (let i = 0; i < transformedRows.length; i += BATCH_SIZE) {
            const batch = transformedRows.slice(i, i + BATCH_SIZE);
            const res = await importPaymentsMut.mutateAsync({ source: state.source, payments: batch });
            created += res.created;
            skipped += res.skipped;
            total += res.total;
            if (res.errors) errors.push(...res.errors);
          }
          newResults[key] = { created, skipped, total, errors };
        }

        setImportStatuses((s) => ({ ...s, [key]: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        toast.error(`Failed to import ${ENTITY_LABELS[key]}`, message);
        newResults[key] = { created: 0, skipped: 0, total: 0, errors: [message] };
        setImportStatuses((s) => ({ ...s, [key]: "done" }));
        setState((s) => ({ ...s, results: { ...s.results, ...newResults } }));
      }
    }
  }

  // ── Step content ──────────────────────────────────────────────────────────

  // For generic/tally: entities with a file and enabled toggle (cashBank excluded — not a standard entity)
  // For myBillBook: whichever files were uploaded (invoices required, items + parties optional)
  // cashBank is handled separately in preview and import — not part of the standard mapping flow
  const activeEntities: EntityKey[] = state.source === "mybillbook"
    ? (["invoices", ...(state.files.items ? ["items"] : [])] as EntityKey[])
    : ENTITY_ORDER.filter((k) => k !== "cashBank" && state.enabled[k] && state.files[k]);

  const step = state.currentStep;

  function renderStepContent() {
    // Step 1: Select source
    if (step === 1) {
      const sources: Array<{ key: Source; label: string; subtitle: string; recommended?: boolean }> = [
        { key: "mybillbook", label: "myBillBook", subtitle: "Auto-detects all column names", recommended: true },
        { key: "tally", label: "Tally", subtitle: "Tally ERP / Prime CSV exports" },
        { key: "generic", label: "Generic CSV", subtitle: "Custom column mapping for any CSV" },
      ];

      return (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary mb-5">
            Choose your data source. Column names will be auto-detected based on your selection.
          </p>
          {sources.map((src) => (
            <button
              key={src.key}
              type="button"
              onClick={() => handleSourceChange(src.key)}
              className={cn(
                "w-full text-left rounded-xl border-2 px-5 py-4 transition-all",
                state.source === src.key
                  ? "border-brand-500 bg-brand-600/[0.08]"
                  : "border-border-light hover:border-brand-300 hover:bg-surface-1"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {src.label}
                    </span>
                    {src.recommended && (
                      <span className="text-[10px] font-medium bg-brand-600/[0.12] text-brand-600 dark:text-brand-400 rounded px-1.5 py-0.5">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">{src.subtitle}</p>
                </div>
                {state.source === src.key && (
                  <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      );
    }

    // Step 2: Upload files
    if (step === 2) {
      if (state.source === "mybillbook") {
        const detectedFiles = state.files;
        const detectedCount = Object.keys(detectedFiles).length;

        return (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Drop all your myBillBook export files at once — the system will auto-identify each one.
            </p>

            {/* Export guide — collapsible, non-intrusive */}
            <details className="group rounded-xl border border-border-light overflow-hidden">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-surface-1 transition-colors">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-text-primary">How to export from myBillBook</span>
                </div>
                <svg className="w-4 h-4 text-text-tertiary transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </summary>
              <div className="px-4 pb-4 pt-1 border-t border-border-light bg-surface-1/50">
                <p className="text-xs text-text-tertiary mb-3">
                  Export these files from myBillBook for a complete import. The more files you provide, the richer your data.
                </p>
                <div className="space-y-2.5">
                  {[
                    {
                      icon: "📋",
                      name: "Sales Summary",
                      path: "Reports → Sales Summary Report → Download CSV",
                      what: "Invoice numbers, dates, parties, totals, payment status",
                      badge: "Required",
                      badgeColor: "text-red-600 dark:text-red-400 bg-red-600/[0.08]",
                    },
                    {
                      icon: "📊",
                      name: "GST Sales Report",
                      path: "Reports → GST Report → Sales → Download CSV",
                      what: "Line items per invoice — items sold, quantities, prices, GST breakdown",
                      badge: "Strongly recommended",
                      badgeColor: "text-amber-600 dark:text-amber-400 bg-amber-600/[0.08]",
                    },
                    {
                      icon: "👥",
                      name: "All Party Balance",
                      path: "Parties → ⋮ Menu → Download Report → All Party Balance CSV",
                      what: "Customer details — phone numbers, addresses, GSTIN, balances",
                      badge: "Recommended",
                      badgeColor: "text-brand-600 dark:text-brand-400 bg-brand-600/[0.08]",
                    },
                    {
                      icon: "📦",
                      name: "Stock Summary",
                      path: "Items → ⋮ Menu → Download Report → Stock Summary CSV",
                      what: "Product catalog with units, categories, prices, current stock",
                      badge: "Recommended",
                      badgeColor: "text-brand-600 dark:text-brand-400 bg-brand-600/[0.08]",
                    },
                    {
                      icon: "🏦",
                      name: "Cash & Bank Statement",
                      path: "Cash & Bank → Select each account → Download CSV",
                      what: "Payment transactions with dates, modes (Cash/UPI/Bank), invoice linkage",
                      badge: "Recommended",
                      badgeColor: "text-brand-600 dark:text-brand-400 bg-brand-600/[0.08]",
                    },
                  ].map((file) => (
                    <div key={file.name} className="flex gap-3">
                      <span className="text-base shrink-0 mt-0.5">{file.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-text-primary">{file.name}</span>
                          <span className={cn("text-[10px] font-medium rounded px-1.5 py-0.5", file.badgeColor)}>
                            {file.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-tertiary mt-0.5">{file.what}</p>
                        <p className="text-[11px] text-text-secondary mt-0.5 font-mono">{file.path}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-text-tertiary mt-3 pt-2 border-t border-border-light">
                  Tip: Export each file for every financial year you want to import. Drop them all at once — duplicates are handled automatically.
                </p>
              </div>
            </details>

            {/* Single drop zone */}
            <div
              className={cn(
                "border-2 border-dashed rounded-xl px-6 py-10 text-center transition-colors cursor-pointer",
                isDragging
                  ? "border-brand-500 bg-brand-600/5"
                  : isProcessing
                  ? "border-brand-300 bg-brand-50"
                  : "border-border-light hover:border-brand-400"
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleMultiDrop}
              onClick={() => !isProcessing && multiFileInputRef.current?.click()}
            >
              <input
                ref={multiFileInputRef}
                type="file"
                multiple
                accept=".csv,.pdf"
                className="hidden"
                onChange={(e) => {
                  handleMultiSelect(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center">
                  {isProcessing ? (
                    <Spinner size="sm" className="text-brand-500" />
                  ) : (
                    <svg className="w-6 h-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  )}
                </div>
                <div>
                  {isProcessing ? (
                    <p className="text-sm font-medium text-text-primary">Detecting files...</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-text-primary">Drop your myBillBook exports here</p>
                      <p className="text-xs text-text-tertiary mt-1">
                        CSV files: Sales Summary, GST Sales Report, Stock Summary or Rate List, Party Balance, Cash &amp; Bank
                        <br />
                        PDF files: Cash &amp; Bank Statement (CSV preferred)
                      </p>
                    </>
                  )}
                </div>
                {!isProcessing && detectedCount === 0 && (
                  <p className="text-xs text-brand-600 font-medium">or click to browse files</p>
                )}
                {!isProcessing && detectedCount > 0 && (
                  <p className="text-xs text-text-tertiary">Drop more files to add, or click to browse</p>
                )}
              </div>
            </div>

            {/* Detected files checklist */}
            {detectedCount > 0 && (() => {
              const regularFileCount = FILE_TYPES.filter(ft => !!detectedFiles[ft.key]).length;
              const gstFileCount = gstReportFile ? gstReportNames.length : 0;
              const fileCount = regularFileCount + (gstReportFile ? 1 : 0);
              const totalRows = FILE_TYPES.reduce((sum, ft) => {
                const p = detectedFiles[ft.key];
                return sum + (p ? p.rows.length : 0);
              }, 0) + (gstReportFile ? gstReportFile.rows.length : 0);
              return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-text-secondary">Detected Files</p>
                  <span className="text-xs tabular-nums text-text-tertiary">
                    {fileCount} file{fileCount !== 1 ? "s" : ""} · {totalRows.toLocaleString()} rows
                  </span>
                </div>
                {FILE_TYPES.map((ft) => {
                  const parsed = detectedFiles[ft.key];
                  const detected = !!parsed;
                  return (
                    <div
                      key={ft.key}
                      className={cn(
                        "flex items-center justify-between px-4 py-2.5 rounded-lg border",
                        detected
                          ? "border-emerald-200 dark:border-emerald-800 bg-emerald-600/[0.05]"
                          : "border-border-light"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{ft.icon}</span>
                        <div>
                          <p className="text-sm font-medium text-text-primary">{ft.label}</p>
                          <p className="text-[11px] text-text-tertiary">{ft.description}</p>
                        </div>
                      </div>
                      {detected ? (() => {
                        const names = state.fileNames[ft.key] || [];
                        const fileCount = names.length;
                        const rowCount = parsed.rows.length;
                        return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-600 font-medium tabular-nums">
                            ✓ {fileCount} file{fileCount !== 1 ? "s" : ""} · {rowCount.toLocaleString()} rows
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeDetectedFile(ft.key); }}
                            className="text-text-tertiary hover:text-red-500 transition-colors"
                            aria-label="Remove"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M4 4l8 8M12 4l-8 8" />
                            </svg>
                          </button>
                        </div>
                        );
                      })() : (
                        <span className="text-xs text-text-tertiary">{ft.required ? "Required" : "Optional"}</span>
                      )}
                    </div>
                  );
                })}

                {/* GST Sales Report — special slot (not an EntityKey, enriches invoices) */}
                {gstReportFile ? (
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-600/[0.05]">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">📊</span>
                      <div>
                        <p className="text-sm font-medium text-text-primary">GST Sales Report</p>
                        <p className="text-[11px] text-text-tertiary">Line items per invoice — items, quantities, prices, GST</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-600 font-medium tabular-nums">
                        ✓ {gstFileCount} file{gstFileCount !== 1 ? "s" : ""} · {gstReportFile.rows.length.toLocaleString()} line items
                      </span>
                      <button
                        type="button"
                        onClick={() => { setGstReportFile(null); setGstReportNames([]); }}
                        className="text-text-tertiary hover:text-red-500 transition-colors"
                        aria-label="Remove"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M4 4l8 8M12 4l-8 8" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-border-light">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">📊</span>
                      <div>
                        <p className="text-sm font-medium text-text-primary">GST Sales Report</p>
                        <p className="text-[11px] text-text-tertiary">Line items per invoice — items, quantities, prices, GST</p>
                      </div>
                    </div>
                    <span className="text-xs text-text-tertiary">Optional</span>
                  </div>
                )}

                {/* Warning if Sales Summary is missing */}
                {!detectedFiles.invoices && (
                  <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/[0.05] border border-amber-200 dark:border-amber-800">
                    <span className="text-amber-600 text-xs font-medium">Sales Summary CSV is required to continue</span>
                  </div>
                )}
              </div>
              );
            })()}

            {/* What will be imported summary */}
            {detectedFiles.invoices && (
              <div className="rounded-lg bg-surface-1 border border-border-light px-4 py-3 text-xs text-text-secondary space-y-1">
                <p className="font-medium text-text-primary">What will be imported</p>
                <ul className="list-disc list-inside space-y-0.5 text-text-tertiary">
                  {detectedFiles.parties
                    ? <li>Parties — from Party Balance (phone, address, balance) + fallback from Sales Summary</li>
                    : <li>Parties — unique customers extracted from Contact Name column</li>
                  }
                  {detectedFiles.items && (() => {
                    const isStockSummary = detectedFiles.items!.headers.some((h) => h.toLowerCase().includes("stock quantity"));
                    return (
                      <li>
                        Items — from {isStockSummary ? "Stock Summary (purchase + selling price, stock quantity with unit)" : "Rate List (Price = selling price)"}
                      </li>
                    );
                  })()}
                  {gstReportFile
                    ? <li>Invoices — with detailed line items from GST Report (items, quantities, prices, GST breakdowns)</li>
                    : <li>Invoices — one per row, with a catch-all line item (drop GST Sales Report for item-level detail)</li>
                  }
                  <li>Payments — auto-created for each paid invoice</li>
                  {detectedFiles.cashBank && (() => {
                    const isCsv = detectedFiles.cashBank!.headers.includes("Invoice numbers");
                    return (
                      <li>
                        Cash &amp; Bank — {isCsv ? "CSV with exact invoice linkage via Invoice numbers column" : "PDF transactions imported as payments"}
                        {detectedFiles.cashBank!.metadata?.["Account Display Name"] && (
                          <span className="text-text-tertiary"> (account: {detectedFiles.cashBank!.metadata["Account Display Name"]})</span>
                        )}
                      </li>
                    );
                  })()}
                </ul>
              </div>
            )}
          </div>
        );
      }

      return (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary mb-5">
            Upload CSV files for each entity. Enable the entities you want to import.
            Import order is: Parties → Items → Invoices → Payments.
          </p>
          {ENTITY_ORDER.filter((k) => k !== "cashBank").map((key) => (
            <DropZone
              key={key}
              entityKey={key}
              parsedFile={state.files[key]}
              enabled={state.enabled[key]}
              onToggle={() => toggleEnabled(key)}
              onFile={(file) => handleFile(key, file)}
            />
          ))}
        </div>
      );
    }

    // Step 3: Map columns
    if (step === 3) {
      // For myBillBook, only show mapping panels for uploaded files
      const mappingEntities = state.source === "mybillbook"
        ? (["invoices", ...(state.files.items ? ["items"] : [])] as EntityKey[])
        : activeEntities;

      if (mappingEntities.length === 0) {
        return (
          <div className="text-center py-12 text-text-tertiary text-sm">
            No files uploaded. Go back and upload at least one file.
          </div>
        );
      }
      return (
        <div className="space-y-5">
          <p className="text-sm text-text-secondary">
            Map CSV columns to the corresponding fields. Required fields are marked with{" "}
            <span className="text-red-500">*</span>.
            Auto-detected mappings can be overridden using the dropdowns.
          </p>

          {/* Info about auto-mapped files */}
          {state.source === "mybillbook" && (
            <div className="rounded-lg bg-surface-1 border border-border-light px-4 py-3 text-xs text-text-secondary space-y-1">
              <p className="font-medium text-text-primary">Auto-mapped (no configuration needed)</p>
              <ul className="list-disc list-inside space-y-0.5 text-text-tertiary">
                {state.files.parties && <li>Party Balance — names, phone, address, balance</li>}
                {state.files.cashBank && <li>Cash & Bank — payment transactions with invoice linkage</li>}
                {gstReportFile && (
                  <li>
                    GST Sales Report — <strong className="text-text-secondary">{gstReportFile.rows.length.toLocaleString()} line items</strong> will be attached to invoices (items, quantities, prices, GST, shipping/discounts auto-reconciled)
                  </li>
                )}
              </ul>
            </div>
          )}

          {mappingEntities.map((key) => (
            <MappingPanel
              key={key}
              entityKey={key}
              parsedFile={state.files[key]!}
              mapping={state.mappings[key] || {}}
              onChange={(m) => setMapping(key, m)}
            />
          ))}
        </div>
      );
    }

    // Step 4: Preview
    if (step === 4) {
      const cashBankFile = state.files.cashBank;
      const isCashBankCsv = cashBankFile?.headers.includes("Invoice numbers");
      const cashBankPreviewHeaders = isCashBankCsv
        ? ["Date", "Type", "Party", "Invoice numbers", "Mode", "Paid", "Received"]
        : ["Date", "Type", "Party", "Mode", "Paid", "Received"];

      return (
        <div className="space-y-5">
          <p className="text-sm text-text-secondary">
            Preview the first 5 rows for each entity. Rows with missing required fields are highlighted.
          </p>
          {activeEntities.map((key) => (
            <PreviewTable
              key={key}
              entityKey={key}
              parsedFile={state.files[key]!}
              mapping={state.mappings[key] || {}}
            />
          ))}
          {gstReportFile && gstReportFile.rows.length > 0 && (
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between bg-surface-1 border-b border-border-light">
                <span className="text-sm font-semibold text-text-primary">
                  GST Sales Report — Line Items
                </span>
                <span className="text-xs text-text-tertiary tabular-nums">
                  {gstReportFile.rows.length.toLocaleString()} line items
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1">
                      {["Invoice No.", "Item Name", "Quantity", "Price/Unit", "Amount"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 text-text-tertiary font-medium border-b border-border-light">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {gstReportFile.rows.slice(0, 8).map((row, i) => (
                      <tr key={i} className="hover:bg-surface-1 transition-colors">
                        <td className="px-3 py-1.5 font-mono text-text-secondary truncate max-w-[120px]">
                          {row["Invoice No."] || row["Invoice No"] || <span className="text-text-tertiary italic">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-text-secondary truncate max-w-[160px]">
                          {row["Item Name"] || <span className="text-text-tertiary italic">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                          {row["Quantity"] || <span className="text-text-tertiary italic">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {row["Price/Unit"] || <span className="text-text-tertiary italic">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                          {row["Amount"] || <span className="text-text-tertiary italic">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {gstReportFile.rows.length > 8 && (
                <div className="px-4 py-1.5 text-center text-xs text-text-tertiary bg-surface-1 border-t border-border-light">
                  First 8 of {gstReportFile.rows.length.toLocaleString()} line items
                </div>
              )}
            </div>
          )}
          {/* ── Unit Conflict Resolution ─────────────────────────────── */}
          {unitConflicts.length > 0 && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-700 overflow-hidden bg-amber-50/50 dark:bg-amber-950/20">
              <div className="px-4 py-3 bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-amber-600 shrink-0">
                    <path d="M8 1l7 13H1L8 1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                    <path d="M8 6v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                    {unitConflicts.length} item{unitConflicts.length > 1 ? "s" : ""} sold in multiple units — conversion factors needed
                  </span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 ml-6">
                  These items appear in invoices with different units. Enter how many base units equal 1 of each alternative unit
                  so that stock and totals are calculated correctly. Alt units will be created on these items automatically.
                </p>
              </div>
              <div className="divide-y divide-amber-200 dark:divide-amber-800">
                {unitConflicts.map((conflict, ci) => (
                  <div key={conflict.itemName} className="px-4 py-3">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-sm font-medium text-text-primary">{conflict.itemName}</span>
                      <span className="text-xs text-text-tertiary tabular-nums">{conflict.totalLines} invoices</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 font-medium">
                        Base: {conflict.baseUnit.toUpperCase()}
                      </span>
                      <span className="text-[11px] text-text-tertiary">
                        ({(unitConflicts[ci].totalLines - conflict.altUnits.reduce((s, a) => s + a.count, 0)).toLocaleString()} lines)
                      </span>
                    </div>
                    <div className="space-y-2">
                      {conflict.altUnits.map((alt, ai) => (
                        <div key={alt.unit} className="flex items-center gap-2">
                          <span className="text-xs text-text-secondary w-20 shrink-0">
                            1 {alt.unit.toUpperCase()}
                            <span className="text-text-tertiary ml-1">({alt.count})</span>
                          </span>
                          <span className="text-xs text-text-tertiary">=</span>
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            placeholder="?"
                            className="input w-20 text-center text-sm tabular-nums"
                            value={alt.conversionFactor}
                            onChange={(e) => {
                              setUnitConflicts((prev) => {
                                const next = [...prev];
                                const c = { ...next[ci], altUnits: [...next[ci].altUnits] };
                                c.altUnits[ai] = { ...c.altUnits[ai], conversionFactor: e.target.value };
                                next[ci] = c;
                                return next;
                              });
                            }}
                          />
                          <span className="text-xs text-text-secondary">{conflict.baseUnit.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {cashBankFile && cashBankFile.rows.length > 0 && (
            <div className="rounded-xl border border-border-light overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between bg-surface-1 border-b border-border-light">
                <div>
                  <span className="text-sm font-semibold text-text-primary">
                    Cash &amp; Bank Transactions
                  </span>
                  {cashBankFile.metadata?.["Account Display Name"] && (
                    <span className="text-xs text-text-tertiary ml-2">
                      Account: {cashBankFile.metadata["Account Display Name"]}
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-tertiary">
                  First {Math.min(5, cashBankFile.rows.length)} of {cashBankFile.rows.length} rows · {cashBankFile.fileName}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1">
                      {cashBankPreviewHeaders.map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 text-text-tertiary font-medium border-b border-border-light"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {cashBankFile.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="hover:bg-surface-1 transition-colors">
                        {cashBankPreviewHeaders.map((h) => (
                          <td key={h} className="px-3 py-2 text-text-secondary truncate max-w-[180px]">
                            {row[h] || <span className="text-text-tertiary italic">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {cashBankFile && cashBankFile.rows.length > 0 && (() => {
            const types: Record<string, number> = {};
            for (const row of cashBankFile.rows) {
              const t = (row["Type"] || "unknown").toLowerCase();
              if (t.includes("opening balance") || !t) continue;
              const key = t.includes("expense") ? "Expenses"
                : t === "add money" || t === "reduce money" ? "Inter-account Transfers"
                : t.includes("payment-out") ? "Payments Out"
                : t.includes("sales invoice") ? "Direct-Paid Invoices"
                : "Payments In";
              types[key] = (types[key] || 0) + 1;
            }
            return (
              <div className="flex flex-wrap gap-3 mt-2">
                {Object.entries(types).map(([label, count]) => (
                  <span key={label} className="text-xs px-2.5 py-1 rounded-lg bg-surface-2 text-text-secondary">
                    {label}: <span className="font-medium text-text-primary">{count}</span>
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      );
    }

    // Step 5: Import
    if (step === 5) {
      const totalCreated = ENTITY_ORDER.reduce(
        (sum, k) => sum + (state.results[k]?.created || 0),
        0
      );

      const isCashBankCsv = state.files.cashBank?.headers.includes("Invoice numbers");
      const importStepLabels: Record<EntityKey, string> = state.source === "mybillbook"
        ? {
            parties: state.files.parties
              ? "Importing parties from Party Balance + Sales Summary fallback..."
              : "Extracting parties from Sales Summary...",
            items: (() => {
              const isStockSummary = state.files.items?.headers.some((h) => h.toLowerCase().includes("stock quantity"));
              return isStockSummary ? "Importing items from Stock Summary..." : "Importing items from Rate List...";
            })(),
            invoices: gstReportFile
              ? `Importing invoices with line items from GST Report (${gstReportFile.rows.length.toLocaleString()} line items)...`
              : "Importing invoices...",
            payments: "Payments",
            cashBank: isCashBankCsv
              ? "Importing payments from Cash & Bank CSV (with invoice linkage)..."
              : "Importing payments from Cash & Bank statement...",
          }
        : {
            parties: "Importing Parties...",
            items: "Importing Items...",
            invoices: "Importing Invoices...",
            payments: "Importing Payments...",
            cashBank: "Importing Cash & Bank Payments...",
          };

      return (
        <div className="space-y-3">
          {!importDone && (
            <p className="text-sm text-text-secondary mb-2">
              Importing data in sequence. Please wait...
            </p>
          )}

          {ENTITY_ORDER
            .filter((key) => {
              const status = importStatuses[key];
              // Hide steps that were skipped entirely
              if (status === "skipped") return false;
              // Hide cashBank if not started
              if (key === "cashBank" && status === undefined) return false;
              return true;
            })
            .map((key) => {
              const status = importStatuses[key] || "pending";
              return (
                <ImportStepRow
                  key={key}
                  label={importStepLabels[key]}
                  status={status}
                  result={state.results[key]}
                />
              );
            })}

          {importDone && (
            <div className="mt-6 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-6 text-center">
              {/* Celebration animation */}
              <div className="relative w-16 h-16 mx-auto mb-4">
                {/* Pulsing ring */}
                <div className="absolute inset-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 animate-ping opacity-20" />
                {/* Checkmark */}
                <div className="relative w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center animate-scale-in">
                  <svg className="w-8 h-8 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                {/* Confetti-like particles */}
                <div className="absolute -top-2 left-1/2 w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0.1s" }} />
                <div className="absolute -top-1 left-1/4 w-1 h-1 rounded-full bg-brand-400 animate-bounce" style={{ animationDelay: "0.3s" }} />
                <div className="absolute -top-2 right-1/4 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
                <div className="absolute top-0 right-1/6 w-1 h-1 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: "0.4s" }} />
              </div>

              <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-300 mb-1">
                Import Complete!
              </h3>
              <p className="text-sm text-emerald-700 dark:text-emerald-400 mb-3">
                {totalCreated.toLocaleString()} records imported successfully
              </p>

              {/* Per-entity breakdown */}
              <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
                {ENTITY_ORDER.filter((k) => state.results[k]).map((k) => {
                  const r = state.results[k]!;
                  return (
                    <div key={k} className="text-xs text-emerald-700 dark:text-emerald-400">
                      <span className="font-medium">{ENTITY_LABELS[k]}:</span>{" "}
                      {r.created}
                      {r.skipped > 0 ? ` (${r.skipped} skipped)` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  // ── Footer buttons ────────────────────────────────────────────────────────

  function renderFooter() {
    if (step === 5) {
      if (!importDone) {
        // Import is running — no buttons
        return null;
      }
      return (
        <div className="flex gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              reset();
            }}
          >
            Import More
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={() => {
              handleClose();
              window.location.href = "/";
            }}
          >
            View Dashboard
          </button>
        </div>
      );
    }

    return (
      <div className="flex gap-3">
        {step > 1 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setState((s) => ({ ...s, currentStep: s.currentStep - 1 }))
            }
          >
            Back
          </button>
        )}
        <button
          type="button"
          className={cn("btn-primary flex-1", step === 4 ? "bg-brand-600" : "")}
          disabled={
            (step === 2 && !canProceedFromUpload()) ||
            (step === 3 && !canProceedFromMapping()) ||
            (step === 4 && unitConflicts.some((c) => c.altUnits.some((a) => !a.conversionFactor || parseFloat(a.conversionFactor) <= 0)))
          }
          onClick={() => {
            if (step === 4) {
              runImport();
            } else {
              // Detect unit conflicts when entering the preview step
              if (step === 3) detectUnitConflicts();
              setState((s) => ({ ...s, currentStep: s.currentStep + 1 }));
            }
          }}
        >
          {step === 4 ? "Start Import" : "Continue"}
        </button>
      </div>
    );
  }

  return (
    <SlideOver
      open={open}
      onClose={handleClose}
      title="Import Data"
      description="Migrate from myBillBook, Tally, or any CSV source"
      footer={renderFooter()}
    >
      <StepIndicator current={step} total={5} />
      {renderStepContent()}
    </SlideOver>
  );
}

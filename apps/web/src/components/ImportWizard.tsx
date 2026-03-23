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
type EntityKey = "parties" | "items" | "invoices" | "payments";

interface ParsedFile {
  rows: Record<string, string>[];
  headers: string[];
  fileName: string;
}

interface ColumnMapping {
  [targetField: string]: string; // targetField -> csvHeader
}

interface ImportResult {
  created: number;
  skipped: number;
  total: number;
  errors?: string[];
}

interface StepState {
  source: Source;
  files: Partial<Record<EntityKey, ParsedFile>>;
  enabled: Record<EntityKey, boolean>;
  mappings: Partial<Record<EntityKey, ColumnMapping>>;
  results: Partial<Record<EntityKey, ImportResult>>;
  currentStep: number;
}

// ── Column presets ────────────────────────────────────────────────────────────

const MYBILLBOOK_PARTY_MAP: Record<string, string> = {
  "Party Name": "name",
  "Mobile Number": "phone",
  "Email": "email",
  "GSTIN": "gstin",
  "PAN Number": "pan",
  "Party Type": "type",
  "Opening Balance": "openingBalance",
  "Billing Address": "billingAddress",
  "Shipping Address": "shippingAddress",
  "City": "city",
  "State": "state",
  "Pincode": "pincode",
};

const MYBILLBOOK_ITEM_MAP: Record<string, string> = {
  "Item Name": "name",
  "Item Type": "itemType",
  "Sale Price": "salePrice",
  "Purchase Price": "purchasePrice",
  "Tax Rate(%)": "taxPercent",
  "HSN/SAC": "hsn",
  "Measuring Unit": "unit",
  "Opening Stock": "stockQuantity",
  "SKU": "sku",
  "Category": "category",
};

const MYBILLBOOK_INVOICE_MAP: Record<string, string> = {
  "Invoice No": "invoiceNumber",
  "Invoice Date": "invoiceDate",
  "Due Date": "dueDate",
  "Party Name": "partyName",
  "Type": "type",
  "Status": "status",
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
  { key: "partyName", label: "Party Name", required: true },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "dueDate", label: "Due Date" },
  { key: "subtotal", label: "Subtotal" },
  { key: "taxAmount", label: "Tax Amount" },
  { key: "discountAmount", label: "Discount" },
  { key: "totalAmount", label: "Total Amount", required: true },
  { key: "amountPaid", label: "Amount Paid" },
  { key: "notes", label: "Notes" },
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
};

const PRESET_MAPS: Record<Source, Partial<Record<EntityKey, Record<string, string>>>> = {
  mybillbook: {
    parties: MYBILLBOOK_PARTY_MAP,
    items: MYBILLBOOK_ITEM_MAP,
    invoices: MYBILLBOOK_INVOICE_MAP,
    payments: MYBILLBOOK_PAYMENT_MAP,
  },
  tally: {},
  generic: {},
};

const ENTITY_LABELS: Record<EntityKey, string> = {
  parties: "Parties",
  items: "Items",
  invoices: "Invoices",
  payments: "Payments",
};

const ENTITY_DESCRIPTIONS: Record<EntityKey, string> = {
  parties: "Customers & suppliers",
  items: "Products & services",
  invoices: "Sales & purchase invoices",
  payments: "Payment records",
};

// ── Normalisation helpers ────────────────────────────────────────────────────

function normalizeUnit(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s.includes("piece") || s === "pcs") return "pcs";
  if (s.includes("kilogram") || s === "kg") return "kg";
  if (s.includes("gram") || s === "g") return "g";
  if (s.includes("litre") || s.includes("liter") || s === "l") return "l";
  if (s.includes("millilitre") || s === "ml") return "ml";
  if (s.includes("metre") || s.includes("meter") || s === "m") return "m";
  if (s.includes("centi") || s === "cm") return "cm";
  if (s.includes("feet") || s.includes("foot") || s === "ft") return "ft";
  if (s.includes("inch") || s === "in") return "in";
  if (s.includes("box")) return "box";
  if (s.includes("dozen")) return "dozen";
  if (s.includes("pair")) return "pair";
  if (s.includes("set")) return "set";
  return "other";
}

function normalizePartyType(raw: string): "customer" | "supplier" {
  const s = raw.toLowerCase().trim();
  if (s.includes("supplier") || s === "vendor") return "supplier";
  return "customer";
}

function normalizePaymentMode(raw: string): "cash" | "bank" | "upi" | "cheque" | "other" {
  const s = raw.toLowerCase().trim();
  if (s === "cash") return "cash";
  if (s.includes("bank") || s.includes("transfer") || s === "neft" || s === "rtgs" || s === "imps") return "bank";
  if (s === "upi" || s.includes("gpay") || s.includes("phonepe") || s.includes("paytm")) return "upi";
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

function transformItemRow(row: Record<string, string>): object {
  return {
    name: row.name || "",
    itemType: row.itemType
      ? row.itemType.toLowerCase().includes("service") ? "service" : "product"
      : "product",
    salePrice: row.salePrice ? cleanMoney(row.salePrice) : undefined,
    purchasePrice: row.purchasePrice ? cleanMoney(row.purchasePrice) : undefined,
    taxPercent: row.taxPercent ? cleanMoney(row.taxPercent) : "0",
    hsn: row.hsn || undefined,
    unit: row.unit ? normalizeUnit(row.unit) : "pcs",
    stockQuantity: row.stockQuantity ? cleanMoney(row.stockQuantity) : "0",
    sku: row.sku || undefined,
    category: row.category || undefined,
  };
}

function transformInvoiceRow(row: Record<string, string>): object {
  return {
    invoiceNumber: row.invoiceNumber || "",
    invoiceDate: row.invoiceDate || "",
    dueDate: row.dueDate || undefined,
    partyName: row.partyName || "",
    type: row.type ? normalizeInvoiceType(row.type) : "sale",
    status: row.status ? normalizeStatus(row.status) : "sent",
    subtotal: row.subtotal ? cleanMoney(row.subtotal) : "0",
    taxAmount: row.taxAmount ? cleanMoney(row.taxAmount) : "0",
    discountAmount: row.discountAmount ? cleanMoney(row.discountAmount) : "0",
    totalAmount: row.totalAmount ? cleanMoney(row.totalAmount) : "0",
    amountPaid: row.amountPaid ? cleanMoney(row.amountPaid) : "0",
    notes: row.notes || undefined,
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

// File drop zone
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
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const rows = result.data as Record<string, string>[];
          const headers = result.meta.fields || [];
          onFile({ rows, headers, fileName: file.name });
        },
      });
    },
    [onFile]
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
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-light)" }}
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
                  "input-field text-sm py-1.5",
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
        className="px-4 py-2.5 flex items-center justify-between"
        style={{ background: "var(--surface-1)", borderBottom: "1px solid var(--border-light)" }}
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
            <tr style={{ background: "var(--surface-1)" }}>
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
            </div>
          )}
        </div>
      </div>
      {errorsOpen && result?.errors && result.errors.length > 0 && (
        <div
          className="px-4 pb-3 pt-0"
          style={{ borderTop: "1px solid var(--border-light)" }}
        >
          <ul className="text-xs text-amber-700 space-y-1 font-mono bg-amber-50 rounded-lg p-2.5 max-h-32 overflow-y-auto">
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

const ENTITY_ORDER: EntityKey[] = ["parties", "items", "invoices", "payments"];

export function ImportWizard({ open, onClose }: ImportWizardProps) {
  const [state, setState] = useState<StepState>({
    source: "mybillbook",
    files: {},
    enabled: { parties: true, items: true, invoices: true, payments: false },
    mappings: {},
    results: {},
    currentStep: 1,
  });

  const [importStatuses, setImportStatuses] = useState<
    Partial<Record<EntityKey, "pending" | "running" | "done" | "skipped">>
  >({});
  const [importDone, setImportDone] = useState(false);

  const importPartiesMut = trpc.import.importParties.useMutation();
  const importItemsMut = trpc.import.importItems.useMutation();
  const importInvoicesMut = trpc.import.importInvoices.useMutation();
  const importPaymentsMut = trpc.import.importPayments.useMutation();

  const BATCH_SIZE = 50;

  function reset() {
    setState({
      source: "mybillbook",
      files: {},
      enabled: { parties: true, items: true, invoices: true, payments: false },
      mappings: {},
      results: {},
      currentStep: 1,
    });
    setImportStatuses({});
    setImportDone(false);
  }

  function handleClose() {
    reset();
    onClose();
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
    // At least one entity must be enabled and have a file
    return ENTITY_ORDER.some((k) => state.enabled[k] && state.files[k]);
  }

  function canProceedFromMapping(): boolean {
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

    setImportDone(true);
  }

  // ── Step content ──────────────────────────────────────────────────────────

  const activeEntities = ENTITY_ORDER.filter(
    (k) => state.enabled[k] && state.files[k]
  );

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
                  ? "border-brand-400 bg-brand-50"
                  : "border-border-light hover:border-brand-200 hover:bg-surface-1"
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {src.label}
                    </span>
                    {src.recommended && (
                      <span className="text-[10px] font-medium bg-brand-100 text-brand-700 rounded px-1.5 py-0.5">
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
      return (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary mb-5">
            Upload CSV files for each entity. Enable the entities you want to import.
            Import order is: Parties → Items → Invoices → Payments.
          </p>
          {ENTITY_ORDER.map((key) => (
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
      if (activeEntities.length === 0) {
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
          {activeEntities.map((key) => (
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
        </div>
      );
    }

    // Step 5: Import
    if (step === 5) {
      const totalCreated = ENTITY_ORDER.reduce(
        (sum, k) => sum + (state.results[k]?.created || 0),
        0
      );

      return (
        <div className="space-y-3">
          {!importDone && (
            <p className="text-sm text-text-secondary mb-2">
              Importing data in sequence. Please wait...
            </p>
          )}

          {ENTITY_ORDER.map((key) => {
            const status = importStatuses[key] || "pending";
            return (
              <ImportStepRow
                key={key}
                label={`Importing ${ENTITY_LABELS[key]}...`}
                status={status}
                result={state.results[key]}
              />
            );
          })}

          {importDone && (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
              <div className="flex items-center gap-3 mb-3">
                <svg
                  className="w-6 h-6 text-green-500 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-semibold text-green-800">
                  Import complete — {totalCreated.toLocaleString()} records imported
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ENTITY_ORDER.filter((k) => state.results[k]).map((k) => {
                  const r = state.results[k]!;
                  return (
                    <div key={k} className="text-xs text-green-700">
                      <span className="font-medium">{ENTITY_LABELS[k]}:</span>{" "}
                      {r.created} created
                      {r.skipped > 0 ? `, ${r.skipped} skipped` : ""}
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
            onClick={handleClose}
          >
            Done
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
            (step === 3 && !canProceedFromMapping())
          }
          onClick={() => {
            if (step === 4) {
              runImport();
            } else {
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

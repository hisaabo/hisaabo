/**
 * HisaaboClient — thin fetch wrapper over the tRPC HTTP API.
 *
 * This is an inline copy of the client designed in packages/client (ADR-001).
 * When packages/client is built, this file should be replaced with:
 *   import { HisaaboClient } from "@hisaabo/client";
 *
 * The tRPC wire format used here:
 *   - Queries: GET /api/trpc/<path>?input=<superjson-encoded>
 *   - Mutations: POST /api/trpc/<path>  body: <superjson-encoded-input>
 *   - Response envelope: { result: { data: <superjson-value> } } | { error: ... }
 */

import superjson from "superjson";

export interface ClientConfig {
  /** Base API URL, e.g. "http://localhost:3000" or "https://api.hisaabo.in" */
  apiUrl: string;
  /** Session ID used as Bearer token — from HISAABO_TOKEN env var */
  token: string;
  /** Tenant (organization) UUID — from HISAABO_TENANT_ID env var */
  tenantId: string;
  /** Active business UUID — from HISAABO_BUSINESS_ID env var */
  businessId: string;
}

// ── Structured error types ──────────────────────────────────────────────────

export type HisaaboError =
  | { code: "unauthorized"; message: string }
  | { code: "forbidden"; message: string }
  | { code: "not_found"; resource: string }
  | { code: "validation_failed"; fields: Record<string, string[]> }
  | { code: "api_error"; message: string };

export class HisaaboApiError extends Error {
  constructor(public readonly hisaaboError: HisaaboError) {
    super(formatHisaaboError(hisaaboError));
    this.name = "HisaaboApiError";
  }
}

export function formatHisaaboError(err: HisaaboError): string {
  switch (err.code) {
    case "unauthorized":
      return `Authentication required: ${err.message}. Check that HISAABO_TOKEN is set and not expired.`;
    case "forbidden":
      return `Permission denied: ${err.message}`;
    case "not_found":
      return `Not found: ${err.resource}`;
    case "validation_failed":
      return (
        `Validation failed:\n` +
        Object.entries(err.fields)
          .map(([field, msgs]) => `  ${field}: ${msgs.join(", ")}`)
          .join("\n")
      );
    case "api_error":
      return `API error: ${err.message}`;
  }
}

// ── tRPC error normalization ────────────────────────────────────────────────

function normalizeTrpcError(raw: unknown): HisaaboError {
  if (!raw || typeof raw !== "object") {
    return { code: "api_error", message: "Unknown error from API" };
  }

  const err = raw as Record<string, unknown>;
  const code = err["code"] as string | undefined;
  const message = (err["message"] as string | undefined) ?? "Unknown error";

  // tRPC error codes map to HTTP semantics
  if (code === "UNAUTHORIZED") return { code: "unauthorized", message };
  if (code === "FORBIDDEN") return { code: "forbidden", message };
  if (code === "NOT_FOUND") return { code: "not_found", resource: message };

  // Zod validation errors from tRPC
  if (code === "BAD_REQUEST") {
    const data = err["data"] as Record<string, unknown> | undefined;
    const zodError = data?.["zodError"] as { fieldErrors?: Record<string, string[]> } | undefined;
    if (zodError?.fieldErrors) {
      return { code: "validation_failed", fields: zodError.fieldErrors };
    }
    return { code: "validation_failed", fields: { _: [message] } };
  }

  return { code: "api_error", message };
}

// ── HTTP client ────────────────────────────────────────────────────────────

export class HisaaboClient {
  /** Base API URL, exposed for tools that need to construct URLs (e.g. PDF download). */
  readonly apiUrl: string;

  constructor(private readonly config: ClientConfig) {
    this.apiUrl = config.apiUrl;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.config.token}`,
      "x-business-id": this.config.businessId,
      "x-tenant-id": this.config.tenantId,
      "x-client-type": "mcp",
    };
  }

  private async unwrap<T>(res: Response): Promise<T> {
    const body = await res.json() as unknown;

    if (typeof body !== "object" || body === null) {
      throw new HisaaboApiError({ code: "api_error", message: "Unexpected response format from API" });
    }

    const envelope = body as Record<string, unknown>;

    if (!res.ok || "error" in envelope) {
      throw new HisaaboApiError(normalizeTrpcError(envelope["error"] ?? { code: "api_error", message: `HTTP ${res.status}` }));
    }

    const result = (envelope["result"] as Record<string, unknown> | undefined);
    if (!result) {
      throw new HisaaboApiError({ code: "api_error", message: "Missing result in API response" });
    }

    // tRPC batch format wraps in { data: <superjson-value> }
    const data = result["data"] as unknown;
    return superjson.deserialize(data as Parameters<typeof superjson.deserialize>[0]) as T;
  }

  /**
   * Call a tRPC query procedure.
   * Queries use GET with SuperJSON-serialized input as a URL param.
   */
  async query<T>(path: string, input?: unknown): Promise<T> {
    const url = new URL(`${this.config.apiUrl}/api/trpc/${path}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
    }
    const res = await fetch(url.toString(), { headers: this.buildHeaders() });
    return this.unwrap<T>(res);
  }

  /**
   * Call a tRPC mutation procedure.
   * Mutations use POST with SuperJSON-serialized body.
   */
  async mutate<T>(path: string, input: unknown): Promise<T> {
    const res = await fetch(`${this.config.apiUrl}/api/trpc/${path}`, {
      method: "POST",
      headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(superjson.serialize(input)),
    });
    return this.unwrap<T>(res);
  }

  // ── Namespaced procedure accessors ──────────────────────────────────────

  get invoice() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const c = this;
    return {
      list(input: InvoiceListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("invoice.list", input);
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("invoice.create", input);
      },
      get(id: string) {
        return c.query<InvoiceDetail>("invoice.get", { id });
      },
      updateStatus(id: string, status: InvoiceStatus) {
        return c.mutate<InvoiceSummary>("invoice.updateStatus", { id, status });
      },
    };
  }

  get party() {
    const c = this;
    return {
      list(input: PartyListInput) {
        return c.query<PaginatedResult<PartySummary>>("party.list", input);
      },
      create(input: PartyCreateInput) {
        return c.mutate<PartySummary>("party.create", input);
      },
      get(id: string) {
        return c.query<PartyDetail>("party.get", { id });
      },
      ledger(partyId: string, input?: LedgerInput) {
        return c.query<LedgerResult>("party.ledger", { partyId, ...input });
      },
    };
  }

  get item() {
    const c = this;
    return {
      list(input: ItemListInput) {
        return c.query<PaginatedResult<ItemSummary>>("item.list", input);
      },
      create(input: ItemCreateInput) {
        return c.mutate<ItemSummary>("item.create", input);
      },
      get(id: string) {
        return c.query<ItemDetail>("item.get", { id });
      },
      adjustStock(input: StockAdjustInput) {
        return c.mutate<ItemSummary>("item.adjustStock", input);
      },
    };
  }

  get payment() {
    const c = this;
    return {
      list(input: PaymentListInput) {
        return c.query<PaginatedResult<PaymentSummary>>("payment.list", input);
      },
      create(input: PaymentCreateInput) {
        return c.mutate<PaymentSummary>("payment.create", input);
      },
    };
  }

  get expense() {
    const c = this;
    return {
      list(input: ExpenseListInput) {
        return c.query<PaginatedResult<ExpenseSummary>>("expense.list", input);
      },
      create(input: ExpenseCreateInput) {
        return c.mutate<ExpenseSummary>("expense.create", input);
      },
    };
  }

  get dashboard() {
    const c = this;
    return {
      summary(input?: DashboardInput) {
        return c.query<DashboardSummary>("dashboard.summary", input);
      },
    };
  }

  get business() {
    const c = this;
    return {
      get() {
        return c.query<BusinessDetail>("business.get");
      },
      list() {
        return c.query<BusinessSummary[]>("business.list");
      },
    };
  }

  get gst() {
    const c = this;
    return {
      gstr1(input: GstReportInput) {
        return c.query<GstReportResult>("gst.gstr1", input);
      },
      gstr3b(input: GstReportInput) {
        return c.query<GstReportResult>("gst.gstr3b", input);
      },
    };
  }
}

// ── Shared types ───────────────────────────────────────────────────────────
// These mirror the API router output shapes — no runtime dependency on @hisaabo/api.
// Keep in sync with packages/api/src/routers/*.ts return types.

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type InvoiceStatus =
  | "draft" | "unfulfilled" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

export type DocumentType =
  | "invoice" | "quotation" | "credit_note" | "debit_note"
  | "delivery_challan" | "proforma" | "sales_return" | "purchase_return";

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  partyName: string;
  partyId: string;
  type: "sale" | "purchase";
  documentType: DocumentType;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string | null;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
}

export interface LineItem {
  id?: string;
  itemId?: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  discountPercent: string;
  amount: string;
  selectedUnit?: string | null;
  variantId?: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  notes: string | null;
  termsAndConditions: string | null;
  lineItems: LineItem[];
  charges?: Array<{ label: string; amount: string }>;
  invoiceDiscount: string;
  roundOff: string;
}

export interface InvoiceListInput {
  type?: "sale" | "purchase" | null;
  status?: InvoiceStatus | null;
  documentType?: DocumentType;
  partyId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  itemId?: string | null;
  search?: string | null;
  sortBy?: "date" | "amount" | "number" | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  limit?: number;
}

export interface InvoiceLineItemInput {
  itemId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent?: string;
  discountPercent?: string;
  selectedUnit?: string | null;
  variantId?: string | null;
}

export interface InvoiceCreateInput {
  partyId: string;
  type: "sale" | "purchase";
  documentType?: DocumentType;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string;
  termsAndConditions?: string;
  additionalCharges?: string;
  charges?: Array<{ label: string; amount: string }>;
  invoiceDiscount?: string;
  invoiceDiscountType?: "amount" | "percent";
  roundOff?: string;
  referenceDocumentId?: string;
  lineItems: InvoiceLineItemInput[];
}

export interface PartySummary {
  id: string;
  name: string;
  type: "customer" | "supplier";
  phone: string | null;
  email: string | null;
  gstin: string | null;
  balance: string;
  city: string | null;
  category: string | null;
}

export interface PartyDetail extends PartySummary {
  billingAddress: string | null;
  shippingAddress: string | null;
  pan: string | null;
  state: string | null;
  creditPeriodDays: number | null;
  creditLimit: string | null;
  contactPersonName: string | null;
  openingBalance: string;
}

export interface PartyListInput {
  type?: "customer" | "supplier" | null;
  filter?: "all" | "customer" | "supplier" | "outstanding" | "overdue" | null;
  search?: string | null;
  category?: string | null;
  sortBy?: "name" | "balance" | null;
  sortDir?: "asc" | "desc" | null;
  page?: number;
  limit?: number;
}

export interface PartyCreateInput {
  type: "customer" | "supplier";
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  openingBalance?: string;
  category?: string;
  creditPeriodDays?: number;
  creditLimit?: string;
  contactPersonName?: string;
}

export interface LedgerEntry {
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  referenceType: string;
  referenceId: string;
}

export interface LedgerResult {
  partyName: string;
  partyType: string;
  openingBalance: string;
  closingBalance: string;
  entries: LedgerEntry[];
}

export interface LedgerInput {
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}

export interface ItemSummary {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  salePrice: string | null;
  purchasePrice: string | null;
  taxPercent: string;
  stockQuantity: string;
  lowStockAlert: string | null;
  category: string | null;
  itemType: "product" | "service";
}

export interface ItemDetail extends ItemSummary {
  description: string | null;
  hsn: string | null;
  itemMode: "simple" | "alt_units" | "variants";
  taxInclusive: boolean;
  unitVariants?: Array<{
    unit: string;
    conversionFactor: number;
    salePrice: string;
    purchasePrice?: string;
  }>;
  variants?: Array<{
    id: string;
    attributeValues: Record<string, string>;
    sku?: string;
    salePrice?: string;
    purchasePrice?: string;
    stockQuantity: string;
  }>;
}

export interface ItemListInput {
  search?: string | null;
  category?: string | null;
  itemType?: "product" | "service" | null;
  lowStock?: boolean | null;
  page?: number;
  limit?: number;
}

export interface ItemCreateInput {
  name: string;
  unit?: string;
  salePrice?: string;
  purchasePrice?: string;
  taxPercent?: string;
  stockQuantity?: string;
  lowStockAlert?: string;
  description?: string;
  hsn?: string;
  sku?: string;
  itemType?: "product" | "service";
  category?: string;
}

export interface StockAdjustInput {
  itemId: string;
  /** Signed decimal string: "+50", "-3.500", "10" */
  adjustment: string;
  reason?: string;
}

export interface PaymentSummary {
  id: string;
  paymentNumber: string;
  amount: string;
  discount: string;
  mode: string;
  paymentDate: string;
  referenceNumber: string | null;
  notes: string | null;
  partyName: string;
  partyId: string;
  invoiceId: string | null;
}

export interface PaymentListInput {
  partyId?: string | null;
  invoiceId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}

export interface PaymentCreateInput {
  partyId: string;
  amount: string;
  mode: "cash" | "bank" | "upi" | "cheque" | "other";
  invoiceId?: string;
  discount?: string;
  referenceNumber?: string;
  paymentDate?: string;
  notes?: string;
  bankAccountId?: string;
  allocations?: Array<{ invoiceId: string; amount: string }>;
}

export interface ExpenseSummary {
  id: string;
  category: string;
  description: string | null;
  amount: string;
  mode: string;
  expenseDate: string;
  referenceNumber: string | null;
}

export interface ExpenseListInput {
  category?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}

export interface ExpenseCreateInput {
  category: string;
  amount: string;
  mode: "cash" | "bank" | "upi" | "cheque" | "other";
  description?: string;
  expenseDate?: string;
  referenceNumber?: string;
}

export interface DashboardInput {
  fromDate?: string;
  toDate?: string;
}

export interface DashboardSummary {
  totalSales: string;
  totalPurchases: string;
  totalExpenses: string;
  receivable: string;
  payable: string;
  cashInHand: string;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    partyName: string;
    totalAmount: string;
    status: string;
    invoiceDate: string;
  }>;
}

export interface BusinessSummary {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  gstRegistrationType: string;
}

export interface BusinessDetail extends BusinessSummary {
  pan: string;
  phone: string;
  email: string | null;
  address: string;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  invoicePrefix: string;
  currency: string;
  financialYearStart: number;
}

export interface GstReportInput {
  month: number;
  year: number;
}

export interface GstReportResult {
  period: string;
  b2b?: unknown;
  b2c?: unknown;
  summary?: unknown;
  [key: string]: unknown;
}

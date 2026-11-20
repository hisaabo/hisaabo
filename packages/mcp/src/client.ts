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
import type { InputArgs, InputOf, MutationPath, OutputOf, QueryPath } from "./api-types.js";
import type { z } from "zod";
import type { createInvoiceSchema, invoiceLineItemSchema, invoiceStatuses, documentTypes, paymentModes, recurringLineItemSchema } from "@hisaabo/shared";

export interface ClientConfig {
  /** Base API URL, e.g. "http://localhost:3000" or "https://api.hisaabo.in" */
  apiUrl: string;
  /** Session ID used as Bearer token — from HISAABO_API_KEY env var */
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
      return `Authentication required: ${err.message}. Check that HISAABO_API_KEY is set and not expired.`;
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

/** Period filter accepted by the item history/summary procedures. */
export type HistoryPeriod = "6m" | "1y" | "all";

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
  async query<P extends QueryPath>(path: P, ...args: InputArgs<P>): Promise<OutputOf<P>> {
    const input: unknown = args[0];
    const url = new URL(`${this.config.apiUrl}/api/trpc/${path}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
    }
    const res = await fetch(url.toString(), {
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    return this.unwrap<OutputOf<P>>(res);
  }

  /**
   * Call a tRPC mutation procedure.
   * Mutations use POST with SuperJSON-serialized body.
   */
  async mutate<P extends MutationPath>(path: P, ...args: InputArgs<P>): Promise<OutputOf<P>> {
    const input: unknown = args[0];
    const res = await fetch(`${this.config.apiUrl}/api/trpc/${path}`, {
      method: "POST",
      headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(superjson.serialize(input)),
      signal: AbortSignal.timeout(30_000),
    });
    return this.unwrap<OutputOf<P>>(res);
  }

  // ── Namespaced procedure accessors ──────────────────────────────────────

  get invoice() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const c = this;
    return {
      list(input: InvoiceListInput) {
        return c.query("invoice.list", input);
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("invoice.create", input);
      },
      get(id: string) {
        return c.query("invoice.getById", { id });
      },
      update(input: InvoiceUpdateInput) {
        return c.mutate("invoice.update", input);
      },
      updateStatus(id: string, status: InvoiceStatus) {
        return c.mutate("invoice.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("invoice.delete", { id });
      },
    };
  }

  get party() {
    const c = this;
    return {
      list(input: PartyListInput) {
        return c.query("party.list", input);
      },
      create(input: PartyCreateInput) {
        return c.mutate("party.create", input);
      },
      get(id: string) {
        return c.query("party.getById", { id });
      },
      ledger(partyId: string, input?: LedgerInput) {
        return c.query("party.ledger", { partyId, ...input });
      },
      update(id: string, data: Partial<PartyCreateInput>) {
        return c.mutate("party.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("party.delete", { id });
      },
      ledgerReport(partyId: string, input?: { fromDate?: string; toDate?: string; limit?: number }) {
        return c.query("party.ledgerReport", { partyId, ...input });
      },
      getStats(id: string) {
        return c.query("party.getStats", { id });
      },
      topItems(partyId: string) {
        return c.query("party.topItems", { partyId });
      },
      merge(sourceId: string, targetId: string) {
        return c.mutate("party.merge", { sourceId, targetId });
      },
    };
  }

  get item() {
    const c = this;
    return {
      list(input: ItemListInput) {
        return c.query("item.list", input);
      },
      create(input: ItemCreateInput) {
        return c.mutate("item.create", input);
      },
      get(id: string) {
        return c.query("item.getById", { id });
      },
      adjustStock(input: StockAdjustInput) {
        return c.mutate("item.adjustStock", input);
      },
      update(id: string, data: ItemUpdateInput) {
        return c.mutate("item.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("item.delete", { id });
      },
      listVariants(itemId: string) {
        return c.query("item.listVariants", { itemId });
      },
      createVariant(itemId: string, variant: ItemVariantInput) {
        return c.mutate("item.createVariant", { itemId, variant });
      },
      updateVariant(variantId: string, data: Partial<ItemVariantInput>) {
        return c.mutate("item.updateVariant", { variantId, data });
      },
      deleteVariant(variantId: string) {
        return c.mutate("item.deleteVariant", { variantId });
      },
      merge(sourceId: string, targetId: string, stockConversionFactor?: number) {
        return c.mutate("item.merge", { sourceId, targetId, stockConversionFactor: stockConversionFactor ?? 1 });
      },
      switchBaseUnit(id: string, newUnit: string, conversionFactor: number) {
        return c.mutate("item.switchBaseUnit", { id, newUnit, conversionFactor });
      },
      renameUnit(id: string, oldUnit: string, newUnit: string) {
        return c.mutate("item.renameUnit", { id, oldUnit, newUnit });
      },
      stockAdjustmentHistory(input: { itemId: string; variantId?: string; page?: number; limit?: number }) {
        return c.query("item.stockAdjustmentHistory", input);
      },
      lowStockCount() {
        return c.query("item.lowStockCount");
      },
      priceHistory(id: string, opts: { period?: HistoryPeriod; limit?: number } = {}) {
        return c.query("item.priceHistory", { id, ...opts });
      },
      priceSummary(input: { id: string; period?: HistoryPeriod; unit?: string; invoiceType?: "sale" | "purchase" }) {
        return c.query("item.priceSummary", input);
      },
      salesStats(id: string) {
        return c.query("item.salesStats", { id });
      },
      stockMovements(id: string, opts: { period?: HistoryPeriod; limit?: number } = {}) {
        return c.query("item.stockMovements", { id, ...opts });
      },
      stockSummary(input: { id: string; period?: HistoryPeriod; unit?: string }) {
        return c.query("item.stockSummary", input);
      },
    };
  }

  get payment() {
    const c = this;
    return {
      list(input: PaymentListInput) {
        return c.query("payment.list", input);
      },
      create(input: PaymentCreateInput) {
        return c.mutate("payment.create", input);
      },
      getById(id: string) {
        return c.query("payment.getById", { id });
      },
      update(input: PaymentUpdateInput) {
        return c.mutate("payment.update", input);
      },
      delete(id: string) {
        return c.mutate("payment.delete", { id });
      },
      unpaidInvoices(partyId: string) {
        return c.query("payment.unpaidInvoices", { partyId });
      },
      untrackedPayments(input: InputOf<"payment.untrackedPayments">) {
        return c.query("payment.untrackedPayments", input);
      },
      defaultAccount(partyId?: string) {
        return c.query("payment.defaultAccount", partyId ? { partyId } : undefined);
      },
      assignAccount(input: InputOf<"payment.assignAccount">) {
        return c.mutate("payment.assignAccount", input);
      },
    };
  }

  get expense() {
    const c = this;
    return {
      list(input: ExpenseListInput) {
        return c.query("expense.list", input);
      },
      create(input: ExpenseCreateInput) {
        return c.mutate("expense.create", input);
      },
      update(id: string, data: Partial<ExpenseCreateInput>) {
        return c.mutate("expense.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("expense.delete", { id });
      },
      categories() {
        return c.query("expense.categories");
      },
    };
  }

  get dashboard() {
    const c = this;
    return {
      summary(input?: DashboardInput) {
        return c.query("dashboard.summary", input);
      },
    };
  }

  get business() {
    const c = this;
    return {
      get() {
        return c.query("business.getById", { id: c.config.businessId });
      },
      list() {
        return c.query("business.list");
      },
      create(input: InputOf<"business.create">) {
        return c.mutate("business.create", input);
      },
      update(id: string, data: InputOf<"business.update">["data"]) {
        return c.mutate("business.update", { id, data });
      },
      updateSequenceNumber(input: InputOf<"business.updateSequenceNumber">) {
        return c.mutate("business.updateSequenceNumber", input);
      },
      auditTrail(input: { page?: number; limit?: number; fromDate?: string; toDate?: string }) {
        return c.query("business.auditTrail", input);
      },
    };
  }

  get gst() {
    const c = this;
    return {
      gstr1(input: GstReportInput) {
        return c.query("gst.gstr1", input);
      },
      gstr3b(input: GstReportInput) {
        return c.query("gst.gstr3b", input);
      },
      gstr1CSV(input: GstReportInput) {
        return c.query("gst.gstr1CSV", input);
      },
      gstr9(input: InputOf<"gst.gstr9">) {
        return c.query("gst.gstr9", input);
      },
    };
  }

  get shipment() {
    const c = this;
    return {
      list(input: ShipmentListInput) {
        return c.query("shipment.list", input);
      },
      get(id: string) {
        return c.query("shipment.getById", { id });
      },
      create(input: ShipmentCreateInput) {
        return c.mutate("shipment.create", input);
      },
      update(input: ShipmentUpdateInput) {
        return c.mutate("shipment.update", input);
      },
      delete(id: string) {
        return c.mutate("shipment.delete", { id });
      },
    };
  }

  get bankAccount() {
    const c = this;
    return {
      list() {
        return c.query("bankAccount.list");
      },
      get(id: string) {
        return c.query("bankAccount.getById", { id });
      },
      create(input: BankAccountCreateInput) {
        return c.mutate("bankAccount.create", input);
      },
      update(id: string, data: BankAccountUpdateInput) {
        return c.mutate("bankAccount.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("bankAccount.delete", { id });
      },
      transfer(input: BankTransferInput) {
        return c.mutate("bankAccount.transfer", input);
      },
      listTransactions(input: BankTransactionListInput) {
        return c.query("bankAccount.listTransactions", input);
      },
      summary() {
        return c.query("bankAccount.summary");
      },
      getGatewayConfig(bankAccountId: string) {
        return c.query("bankAccount.getGatewayConfig", { bankAccountId });
      },
      upsertGatewayConfig(input: UpsertGatewayConfigInput) {
        return c.mutate("bankAccount.upsertGatewayConfig", input);
      },
    };
  }

  get reports() {
    const c = this;
    return {
      daybook(input: DaybookInput) {
        return c.query("reports.daybook", input);
      },
      outstanding(input: OutstandingInput) {
        return c.query("reports.outstanding", input);
      },
      taxSummary(input: TaxSummaryInput) {
        return c.query("reports.taxSummary", input);
      },
      itemSales(input: ItemSalesInput) {
        return c.query("reports.itemSales", input);
      },
      stockSummary(input: StockSummaryInput) {
        return c.query("reports.stockSummary", input);
      },
      partyStatement(input: PartyStatementInput) {
        return c.query("reports.partyStatement", input);
      },
      paymentSummary(input: PaymentSummaryInput) {
        return c.query("reports.paymentSummary", input);
      },
      trialBalance(input: InputOf<"reports.trialBalance">) {
        return c.query("reports.trialBalance", input);
      },
      balanceSheet(input: InputOf<"reports.balanceSheet">) {
        return c.query("reports.balanceSheet", input);
      },
      profitAndLoss(input: InputOf<"reports.profitAndLoss">) {
        return c.query("reports.profitAndLoss", input);
      },
      cashFlowStatement(input: InputOf<"reports.cashFlowStatement">) {
        return c.query("reports.cashFlowStatement", input);
      },
      generalLedger(input: InputOf<"reports.generalLedger">) {
        return c.query("reports.generalLedger", input);
      },
      comparativeTrialBalance(input: InputOf<"reports.comparativeTrialBalance">) {
        return c.query("reports.comparativeTrialBalance", input);
      },
      comparativeBalanceSheet(input: InputOf<"reports.comparativeBalanceSheet">) {
        return c.query("reports.comparativeBalanceSheet", input);
      },
      comparativeProfitAndLoss(input: InputOf<"reports.comparativeProfitAndLoss">) {
        return c.query("reports.comparativeProfitAndLoss", input);
      },
    };
  }

  get store() {
    const c = this;
    return {
      getSettings() {
        return c.query("store.getSettings");
      },
      updateSettings(input: StoreSettingsUpdateInput) {
        return c.mutate("store.updateSettings", input);
      },
      listOrders(input: StoreOrderListInput) {
        return c.query("store.listOrders", input);
      },
      getOrder(id: string) {
        return c.query("store.getOrder", { id });
      },
      updateOrderStatus(input: { orderId: string; status: "preparing" | "ready" | "delivered" }) {
        return c.mutate("store.updateOrderStatus", input);
      },
      confirmOrder(orderId: string) {
        return c.mutate("store.confirmOrder", { orderId });
      },
      cancelOrder(orderId: string, reason?: string) {
        return c.mutate("store.cancelOrder", { orderId, reason });
      },
      checkSlug(slug: string) {
        return c.query("store.checkSlug", { slug });
      },
      listStoreItems(input: { search?: string; category?: string; storeEnabled?: boolean; page?: number; limit?: number }) {
        return c.query("store.listStoreItems", input);
      },
      bulkToggleItems(itemIds: string[], storeEnabled: boolean) {
        return c.mutate("store.bulkToggleItems", { itemIds, storeEnabled });
      },
    };
  }

  get target() {
    const c = this;
    return {
      list(input: TargetListInput) {
        return c.query("target.list", input);
      },
      create(input: TargetCreateInput) {
        return c.mutate("target.create", input);
      },
      getProgress(id: string) {
        return c.query("target.getProgress", { id });
      },
      update(input: TargetUpdateInput) {
        return c.mutate("target.update", input);
      },
      delete(id: string) {
        return c.mutate("target.delete", { id });
      },
      myTargets() {
        return c.query("target.myTargets");
      },
    };
  }

  get import() {
    const c = this;
    return {
      importParties(input: ImportPartiesInput) {
        return c.mutate("import.importParties", input);
      },
      importItems(input: ImportItemsInput) {
        return c.mutate("import.importItems", input);
      },
      importInvoices(input: ImportInvoicesInput) {
        return c.mutate("import.importInvoices", input);
      },
      importPayments(input: ImportPaymentsInput) {
        return c.mutate("import.importPayments", input);
      },
    };
  }

  get auth() {
    const c = this;
    return {
      listSessions(expired = false) {
        return c.query("auth.listSessions", { expired });
      },
      revokeSession(sessionId: string) {
        return c.mutate("auth.revokeSession", { sessionId });
      },
    };
  }

  get tenant() {
    const c = this;
    return {
      list() {
        return c.query("tenant.list");
      },
      select(tenantId: string) {
        return c.mutate("tenant.select", { tenantId });
      },
      members() {
        return c.query("tenant.members");
      },
      inviteMember(email: string, role: InputOf<"tenant.inviteMember">["role"]) {
        return c.mutate("tenant.inviteMember", { email, role });
      },
      removeMember(userId: string) {
        return c.mutate("tenant.removeMember", { userId });
      },
      updateMemberRole(userId: string, role: InputOf<"tenant.updateMemberRole">["role"]) {
        return c.mutate("tenant.updateMemberRole", { userId, role });
      },
      pendingInvitations() {
        return c.query("tenant.pendingInvitations");
      },
      revokeInvitation(invitationId: string) {
        return c.mutate("tenant.revokeInvitation", { invitationId });
      },
    };
  }

  get apiKey() {
    const c = this;
    return {
      list() {
        return c.query("apiKey.list");
      },
      create(input: { name: string; expiresAt?: string }) {
        return c.mutate("apiKey.create", input);
      },
      revoke(id: string) {
        return c.mutate("apiKey.revoke", { id });
      },
    };
  }

  get automatedInvoice() {
    const c = this;
    return {
      list(input: RecurringInvoiceListInput) {
        return c.query("recurringInvoice.list", input);
      },
      getById(id: string) {
        return c.query("recurringInvoice.getById", { id });
      },
      create(input: RecurringInvoiceCreateInput) {
        return c.mutate("recurringInvoice.create", input);
      },
      update(id: string, data: RecurringInvoiceUpdateInput) {
        return c.mutate("recurringInvoice.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("recurringInvoice.delete", { id });
      },
      pause(id: string) {
        return c.mutate("recurringInvoice.pause", { id });
      },
      resume(id: string) {
        return c.mutate("recurringInvoice.resume", { id });
      },
      runNow(id: string) {
        return c.mutate("recurringInvoice.runNow", { id });
      },
      executionHistory(templateId: string, page?: number, limit?: number) {
        return c.query("recurringInvoice.executionHistory", { templateId, page, limit });
      },
      planUsage() {
        return c.query("recurringInvoice.planUsage");
      },
      suggestions() {
        return c.query("recurringInvoice.suggestions");
      },
    };
  }

  get document() {
    const c = this;
    return {
      convert(input: { sourceId: string; targetType: DocumentType }) {
        return c.mutate("document.convert", { sourceDocumentId: input.sourceId, targetDocumentType: input.targetType });
      },
    };
  }

  get quotation() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("quotation.list", input);
      },
      getById(id: string) {
        return c.query("quotation.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("quotation.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("quotation.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("quotation.delete", { id });
      },
    };
  }

  get creditNote() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("creditNote.list", input);
      },
      getById(id: string) {
        return c.query("creditNote.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("creditNote.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("creditNote.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("creditNote.delete", { id });
      },
    };
  }

  get debitNote() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("debitNote.list", input);
      },
      getById(id: string) {
        return c.query("debitNote.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("debitNote.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("debitNote.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("debitNote.delete", { id });
      },
    };
  }

  get deliveryChallan() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("deliveryChallan.list", input);
      },
      getById(id: string) {
        return c.query("deliveryChallan.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("deliveryChallan.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("deliveryChallan.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("deliveryChallan.delete", { id });
      },
    };
  }

  get proforma() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("proforma.list", input);
      },
      getById(id: string) {
        return c.query("proforma.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("proforma.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("proforma.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("proforma.delete", { id });
      },
    };
  }

  get salesReturn() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("salesReturn.list", input);
      },
      getById(id: string) {
        return c.query("salesReturn.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("salesReturn.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("salesReturn.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("salesReturn.delete", { id });
      },
    };
  }

  get purchaseReturn() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query("purchaseReturn.list", input);
      },
      getById(id: string) {
        return c.query("purchaseReturn.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("purchaseReturn.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate("purchaseReturn.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate("purchaseReturn.delete", { id });
      },
    };
  }

  get journal() {
    const c = this;
    return {
      list(input?: InputOf<"journal.list">) {
        return c.query("journal.list", input ?? {});
      },
      getById(id: string) {
        return c.query("journal.getById", { id });
      },
      create(input: InputOf<"journal.create">) {
        return c.mutate("journal.create", input);
      },
      update(input: InputOf<"journal.update">) {
        return c.mutate("journal.update", input);
      },
      void(id: string) {
        return c.mutate("journal.void", { id });
      },
      templateList() {
        return c.query("journal.templateList");
      },
      templateCreate(input: InputOf<"journal.templateCreate">) {
        return c.mutate("journal.templateCreate", input);
      },
      templateDelete(id: string) {
        return c.mutate("journal.templateDelete", { id });
      },
      createFromTemplate(input: InputOf<"journal.createFromTemplate">) {
        return c.mutate("journal.createFromTemplate", input);
      },
    };
  }

  get itc() {
    const c = this;
    return {
      dashboard(input?: InputOf<"itc.dashboard">) {
        return c.query("itc.dashboard", input ?? {});
      },
      ledger(input?: InputOf<"itc.ledger">) {
        return c.query("itc.ledger", input ?? {});
      },
      agingAlerts() {
        return c.query("itc.agingAlerts");
      },
      markBlocked(input: InputOf<"itc.markBlocked">) {
        return c.mutate("itc.markBlocked", input);
      },
      markEligible(input: InputOf<"itc.markEligible">) {
        return c.mutate("itc.markEligible", input);
      },
      recordUtilization(input: InputOf<"itc.recordUtilization">) {
        return c.mutate("itc.recordUtilization", input);
      },
      gstr3bTable4(input: InputOf<"itc.gstr3bTable4">) {
        return c.query("itc.gstr3bTable4", input);
      },
    };
  }

  get bankRecon() {
    const c = this;
    return {
      importList(input?: InputOf<"bankRecon.importList">) {
        return c.query("bankRecon.importList", input ?? {});
      },
      lines(input: InputOf<"bankRecon.lines">) {
        return c.query("bankRecon.lines", input);
      },
      summary(input: InputOf<"bankRecon.summary">) {
        return c.query("bankRecon.summary", input);
      },
      ruleList() {
        return c.query("bankRecon.ruleList");
      },
      ruleCreate(input: InputOf<"bankRecon.ruleCreate">) {
        return c.mutate("bankRecon.ruleCreate", input);
      },
      ruleUpdate(input: InputOf<"bankRecon.ruleUpdate">) {
        return c.mutate("bankRecon.ruleUpdate", input);
      },
      ruleDelete(id: string) {
        return c.mutate("bankRecon.ruleDelete", { id });
      },
      templateList() {
        return c.query("bankRecon.templateList");
      },
      confirmMatch(input: InputOf<"bankRecon.confirmMatch">) {
        return c.mutate("bankRecon.confirmMatch", input);
      },
      manualMatch(input: InputOf<"bankRecon.manualMatch">) {
        return c.mutate("bankRecon.manualMatch", input);
      },
      unmatch(input: InputOf<"bankRecon.unmatch">) {
        return c.mutate("bankRecon.unmatch", input);
      },
      createExpense(input: InputOf<"bankRecon.createExpense">) {
        return c.mutate("bankRecon.createExpense", input);
      },
      ignoreLine(input: InputOf<"bankRecon.ignoreLine">) {
        return c.mutate("bankRecon.ignoreLine", input);
      },
    };
  }

  get eInvoice() {
    const c = this;
    return {
      dashboard(input?: InputOf<"eInvoice.dashboard">) {
        return c.query("eInvoice.dashboard", input ?? {});
      },
      generate(input: InputOf<"eInvoice.generate">) {
        return c.mutate("eInvoice.generate", input);
      },
      cancel(input: InputOf<"eInvoice.cancel">) {
        return c.mutate("eInvoice.cancel", input);
      },
      retryFailed(input: InputOf<"eInvoice.retryFailed">) {
        return c.mutate("eInvoice.retryFailed", input);
      },
      bulkRetry() {
        return c.mutate("eInvoice.bulkRetry");
      },
      getStatus(invoiceId: string) {
        return c.query("eInvoice.getStatus", { invoiceId });
      },
    };
  }

  get ewayBill() {
    const c = this;
    return {
      dashboard(input?: InputOf<"ewayBill.dashboard">) {
        return c.query("ewayBill.dashboard", input ?? {});
      },
      generate(input: InputOf<"ewayBill.generate">) {
        return c.mutate("ewayBill.generate", input);
      },
      cancel(input: InputOf<"ewayBill.cancel">) {
        return c.mutate("ewayBill.cancel", input);
      },
      updateVehicle(input: InputOf<"ewayBill.updateVehicle">) {
        return c.mutate("ewayBill.updateVehicle", input);
      },
      extend(input: InputOf<"ewayBill.extend">) {
        return c.mutate("ewayBill.extend", input);
      },
      getByInvoice(invoiceId: string) {
        return c.query("ewayBill.getByInvoice", { invoiceId });
      },
      expiringList() {
        return c.query("ewayBill.expiringList");
      },
    };
  }

  get gstr2b() {
    const c = this;
    return {
      uploads(input?: InputOf<"gstr2b.uploads">) {
        return c.query("gstr2b.uploads", input ?? {});
      },
      records(input: InputOf<"gstr2b.records">) {
        return c.query("gstr2b.records", input);
      },
      summary(input: InputOf<"gstr2b.summary">) {
        return c.query("gstr2b.summary", input);
      },
      missingInBooks(input: InputOf<"gstr2b.missingInBooks">) {
        return c.query("gstr2b.missingInBooks", input);
      },
      missingIn2B(input: InputOf<"gstr2b.missingIn2B">) {
        return c.query("gstr2b.missingIn2B", input);
      },
    };
  }

  // ── System ──────────────────────────────────────────────────────

  get system() {
    const c = this;
    return {
      maintenanceStatus() {
        return c.query("system.maintenanceStatus");
      },
    };
  }
}

// ── Shared types ───────────────────────────────────────────────────────────
// These mirror the API router output shapes — no runtime dependency on @hisaabo/api.
// Keep in sync with packages/api/src/routers/*.ts return types.


export type InvoiceStatus = (typeof invoiceStatuses)[number];

export type DocumentType = (typeof documentTypes)[number];

export type PaymentMode = (typeof paymentModes)[number];





export type InvoiceListInput = InputOf<"invoice.list">;

export type InvoiceLineItemInput = z.input<typeof invoiceLineItemSchema>;

export type InvoiceCreateInput = z.input<typeof createInvoiceSchema>;

/** Flat update payload: `id` plus the fields to change (matches invoice.update's input). */
export type InvoiceUpdateInput = { id: string } & Partial<Omit<InvoiceCreateInput, "partyId" | "type" | "documentType">>;



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



export interface LedgerInput {
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
}



export interface ItemListInput {
  search?: string | null;
  category?: string | null;
  itemType?: "product" | "service" | null;
  lowStock?: boolean | null;
  page?: number;
  limit?: number;
}

export type ItemCreateInput = InputOf<"item.create">;
export type ItemUpdateInput = InputOf<"item.update">["data"];

export interface StockAdjustInput {
  itemId: string;
  /** Signed decimal string without a leading "+": "-3.500", "10" */
  quantity: string;
  variantId?: string | null;
  reason?: string;
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
  mode: PaymentMode;
  invoiceId?: string;
  discount?: string;
  referenceNumber?: string;
  paymentDate?: string;
  notes?: string;
  bankAccountId?: string;
  allocations?: Array<{ invoiceId: string; amount: string }>;
}


export type ExpenseListInput = InputOf<"expense.list">;

export interface ExpenseCreateInput {
  category: string;
  amount: string;
  mode: PaymentMode;
  description?: string;
  expenseDate?: string;
  referenceNumber?: string;
}

export interface DashboardInput {
  fromDate?: string;
  toDate?: string;
}




export interface GstReportInput {
  month: number;
  year: number;
}


// ── Payment types ──────────────────────────────────────────────


export interface PaymentUpdateInput {
  id: string;
  amount?: string;
  mode?: PaymentMode;
  discount?: string;
  referenceNumber?: string | null;
  paymentDate?: string;
  notes?: string | null;
  bankAccountId?: string | null;
  allocations?: Array<{ invoiceId: string; amount: string }>;
}

// ── Shipment types ─────────────────────────────────────────────

export type ShipmentStatus = "pending" | "shipped" | "in_transit" | "delivered" | "returned";



export interface ShipmentListInput {
  status?: ShipmentStatus | null;
  invoiceId?: string | null;
  partyId?: string | null;
  page?: number;
  limit?: number;
}

export interface ShipmentCreateInput {
  invoiceId?: string;
  partyId?: string;
  carrier?: string;
  mode?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  cost?: string;
  weight?: string;
  shippingAddress?: string;
  shippingCity?: string;
  shippingPincode?: string;
  status?: ShipmentStatus;
  shipmentDate?: string;
  estimatedDelivery?: string;
  notes?: string;
}

export interface ShipmentUpdateInput {
  id: string;
  carrier?: string;
  mode?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  cost?: string;
  weight?: string;
  status?: ShipmentStatus;
  shipmentDate?: string;
  estimatedDelivery?: string;
  actualDelivery?: string;
  notes?: string;
}

// ── Bank account types ─────────────────────────────────────────


export interface GatewayChargeRate {
  type: "percentage" | "flat";
  value: string;
}

export interface GatewayChargeConfig {
  credit_card?: GatewayChargeRate;
  debit_card?: GatewayChargeRate;
  upi?: GatewayChargeRate;
  net_banking?: GatewayChargeRate;
  wallet?: GatewayChargeRate;
  default?: GatewayChargeRate;
}


export interface UpsertGatewayConfigInput {
  bankAccountId: string;
  settlementAccountId: string;
  chargeConfig: GatewayChargeConfig;
  expenseCategory?: string;
  autoSettle?: boolean;
}




export type BankAccountCreateInput = InputOf<"bankAccount.create">;
export type BankAccountUpdateInput = InputOf<"bankAccount.update">["data"];

export interface BankTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  description?: string;
  transactionDate?: string;
}


export interface BankTransactionListInput {
  bankAccountId: string;
  fromDate?: string;
  toDate?: string;
  type?: "deposit" | "withdrawal" | "transfer";
  page?: number;
  limit?: number;
}


// ── Reports types ──────────────────────────────────────────────

export interface DaybookInput {
  fromDate: string;
  toDate: string;
  typeFilter?: "all" | "invoices" | "payments" | "expenses";
}



export interface OutstandingInput {
  type?: "receivable" | "payable" | "both";
  asOfDate?: string;
}


export interface TaxSummaryInput {
  fromDate: string;
  toDate: string;
  type?: "sales" | "purchases" | "both";
}


export interface ItemSalesInput {
  fromDate: string;
  toDate: string;
  category?: string;
  itemType?: "product" | "service";
  sortBy?: "revenue" | "quantity" | "invoices" | "margin";
  compareToPrevious?: boolean;
}


export interface StockSummaryInput {
  category?: string;
  showZeroStock?: boolean;
}


export interface PartyStatementInput {
  partyId: string;
  fromDate?: string;
  toDate?: string;
}


export interface PaymentSummaryInput {
  fromDate: string;
  toDate: string;
  type?: "received" | "made" | "both";
  bankAccountId?: string;
}


// ── Store types ────────────────────────────────────────────────


export interface StoreSettingsUpdateInput {
  storeEnabled?: boolean;
  storeSlug?: string | null;
  storeTagline?: string | null;
  storeAccentColor?: string | null;
  storeMinOrderAmount?: string | null;
  storeDeliveryNote?: string | null;
  storeWhatsappNumber?: string | null;
  storeAllowNegativeStock?: boolean;
  storeRequirePhoneOtp?: boolean;
  storeOrderPrefix?: string;
}

export type StoreOrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";



export interface StoreOrderListInput {
  status?: StoreOrderStatus | null;
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}

// ── Target types ───────────────────────────────────────────────

export type TargetType = "order_count" | "order_value" | "item_quantity";
export type PeriodType = "daily" | "weekly" | "monthly" | "quarterly" | "custom";




export interface TargetListInput {
  userId?: string;
  periodType?: PeriodType;
  active?: boolean;
  withProgress?: boolean;
}

export interface TargetCreateInput {
  userId: string;
  targetType: TargetType;
  targetValue: string;
  itemId?: string | null;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  notes?: string | null;
}

export interface TargetUpdateInput {
  id: string;
  targetValue?: string;
  itemId?: string | null;
  periodType?: PeriodType;
  periodStart?: string;
  periodEnd?: string;
  notes?: string | null;
}

// ── Import types ───────────────────────────────────────────────



export interface ImportPartyRecord {
  name: string;
  type?: "customer" | "supplier";
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  openingBalance?: string;
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface ImportPartiesInput {
  source?: string;
  parties: ImportPartyRecord[];
}

export interface ImportItemRecord {
  name: string;
  itemType?: "product" | "service";
  salePrice?: string;
  purchasePrice?: string;
  taxPercent?: string;
  hsn?: string;
  unit?: string;
  stockQuantity?: string;
  sku?: string;
  category?: string;
}

export interface ImportItemsInput {
  source?: string;
  items: ImportItemRecord[];
}

export interface ImportInvoiceRecord {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  partyName: string;
  type?: "sale" | "purchase";
  status?: "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";
  totalAmount: string;
  amountPaid?: string;
  subtotal?: string;
  taxAmount?: string;
  discountAmount?: string;
  notes?: string;
  createdByName?: string;
  lineItems?: Array<{
    description: string;
    quantity?: string;
    unitPrice: string;
    taxPercent?: string;
    discountPercent?: string;
    itemName?: string;
  }>;
}

export interface ImportInvoicesInput {
  source?: string;
  autoCreatePayments?: boolean;
  defaultPaymentMode?: "cash" | "bank" | "upi" | "cheque" | "other";
  invoices: ImportInvoiceRecord[];
}


export type ImportPaymentsInput = InputOf<"import.importPayments">;

// ── Item variant types ─────────────────────────────────────────

export interface ItemVariantInput {
  attributeValues: Record<string, string>;
  sku?: string;
  salePrice?: string;
  purchasePrice?: string;
  stockQuantity?: string;
  lowStockAlert?: string;
}

// ── Document list input ────────────────────────────────────────

export type DocumentListInput = InputOf<"quotation.list">;

// ── Recurring / Automated Invoice types ──────────────────────────

export type RecurringInvoiceFrequency =
  | "weekly" | "biweekly" | "monthly" | "quarterly"
  | "half_yearly" | "yearly" | "custom";

export type RecurringInvoiceStatus = "active" | "paused" | "completed" | "expired";


export type RecurringInvoiceLineItem = z.input<typeof recurringLineItemSchema>;



export interface RecurringInvoiceListInput {
  status?: RecurringInvoiceStatus;
  page?: number;
  limit?: number;
}

export interface RecurringInvoiceCreateInput {
  partyId: string;
  name: string;
  type: "sale" | "purchase";
  frequency: RecurringInvoiceFrequency;
  customIntervalDays?: number;
  lineItems: RecurringInvoiceLineItem[];
  startDate: string;
  endDate?: string;
  maxRuns?: number;
  notes?: string;
}

export interface RecurringInvoiceUpdateInput {
  name?: string;
  partyId?: string;
  type?: "sale" | "purchase";
  frequency?: RecurringInvoiceFrequency;
  customIntervalDays?: number;
  lineItems?: RecurringInvoiceLineItem[];
  endDate?: string;
  maxRuns?: number;
  notes?: string;
}





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
        return c.query<InvoiceDetail>("invoice.getById", { id });
      },
      update(id: string, data: Partial<InvoiceCreateInput>) {
        return c.mutate<InvoiceDetail>("invoice.update", { id, data });
      },
      updateStatus(id: string, status: InvoiceStatus) {
        return c.mutate<InvoiceSummary>("invoice.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("invoice.delete", { id });
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
        return c.query<PartyDetail>("party.getById", { id });
      },
      ledger(partyId: string, input?: LedgerInput) {
        return c.query<LedgerResult>("party.ledger", { partyId, ...input });
      },
      update(id: string, data: Partial<PartyCreateInput>) {
        return c.mutate<PartyDetail>("party.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("party.delete", { id });
      },
      ledgerReport(partyId: string, input?: { fromDate?: string; toDate?: string; limit?: number }) {
        return c.query<unknown>("party.ledgerReport", { partyId, ...input });
      },
      getStats(id: string) {
        return c.query<{ invoiceCount: number; paymentCount: number }>("party.getStats", { id });
      },
      topItems(partyId: string) {
        return c.query<unknown[]>("party.topItems", { partyId });
      },
      merge(sourceId: string, targetId: string) {
        return c.mutate<{ success: boolean; mergedInto: string }>("party.merge", { sourceId, targetId });
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
        return c.query<ItemDetail>("item.getById", { id });
      },
      adjustStock(input: StockAdjustInput) {
        return c.mutate<ItemSummary>("item.adjustStock", input);
      },
      update(id: string, data: Partial<ItemCreateInput>) {
        return c.mutate<ItemDetail>("item.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("item.delete", { id });
      },
      categories() {
        return c.query<string[]>("item.categories");
      },
      listVariants(itemId: string) {
        return c.query<unknown[]>("item.listVariants", { itemId });
      },
      createVariant(itemId: string, variant: ItemVariantInput) {
        return c.mutate<unknown>("item.createVariant", { itemId, variant });
      },
      updateVariant(variantId: string, data: Partial<ItemVariantInput>) {
        return c.mutate<unknown>("item.updateVariant", { variantId, data });
      },
      deleteVariant(variantId: string) {
        return c.mutate<{ success: boolean }>("item.deleteVariant", { variantId });
      },
      merge(sourceId: string, targetId: string, stockConversionFactor?: number) {
        return c.mutate<{ success: boolean; mergedInto: string }>("item.merge", { sourceId, targetId, stockConversionFactor: stockConversionFactor ?? 1 });
      },
      switchBaseUnit(id: string, newUnit: string, conversionFactor: number) {
        return c.mutate<unknown>("item.switchBaseUnit", { id, newUnit, conversionFactor });
      },
      renameUnit(id: string, oldUnit: string, newUnit: string) {
        return c.mutate<{ success: boolean }>("item.renameUnit", { id, oldUnit, newUnit });
      },
      stockAdjustmentHistory(input: { itemId: string; variantId?: string; page?: number; limit?: number }) {
        return c.query<PaginatedResult<unknown>>("item.stockAdjustmentHistory", input);
      },
      lowStockCount() {
        return c.query<number>("item.lowStockCount");
      },
      priceHistory(id: string) {
        return c.query<unknown[]>("item.priceHistory", { id });
      },
      salesStats(id: string) {
        return c.query<unknown>("item.salesStats", { id });
      },
      stockMovements(id: string) {
        return c.query<unknown[]>("item.stockMovements", { id });
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
      getById(id: string) {
        return c.query<PaymentDetail | null>("payment.getById", { id });
      },
      update(input: PaymentUpdateInput) {
        return c.mutate<PaymentSummary>("payment.update", input);
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("payment.delete", { id });
      },
      unpaidInvoices(partyId: string) {
        return c.query<unknown[]>("payment.unpaidInvoices", { partyId });
      },
      untrackedPayments(input: { search?: string; mode?: string; fromDate?: string; toDate?: string; page?: number; limit?: number }) {
        return c.query<PaginatedResult<unknown>>("payment.untrackedPayments", input);
      },
      defaultAccount(partyId?: string) {
        return c.query<unknown>("payment.defaultAccount", partyId ? { partyId } : undefined);
      },
      assignAccount(input: { paymentIds?: string[]; allMatching?: boolean; bankAccountId: string; search?: string; mode?: string }) {
        return c.mutate<{ updated: number }>("payment.assignAccount", input);
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
      update(id: string, data: Partial<ExpenseCreateInput>) {
        return c.mutate<ExpenseSummary>("expense.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("expense.delete", { id });
      },
      categories() {
        return c.query<string[]>("expense.categories");
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
        return c.query<BusinessDetail>("business.getById");
      },
      list() {
        return c.query<BusinessSummary[]>("business.list");
      },
      create(input: unknown) {
        return c.mutate<BusinessDetail>("business.create", input);
      },
      update(id: string, data: unknown) {
        return c.mutate<BusinessDetail>("business.update", { id, data });
      },
      updateSequenceNumber(input: { businessId: string; documentType: string; newNumber: number }) {
        return c.mutate<{ success: boolean }>("business.updateSequenceNumber", input);
      },
      auditTrail(input: { page?: number; limit?: number; fromDate?: string; toDate?: string }) {
        return c.query<PaginatedResult<unknown>>("business.auditTrail", input);
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
      gstr1CSV(input: GstReportInput) {
        return c.query<{ csv: string; filename: string }>("gst.gstr1CSV", input);
      },
    };
  }

  get shipment() {
    const c = this;
    return {
      list(input: ShipmentListInput) {
        return c.query<PaginatedResult<ShipmentSummary>>("shipment.list", input);
      },
      get(id: string) {
        return c.query<ShipmentDetail | null>("shipment.getById", { id });
      },
      create(input: ShipmentCreateInput) {
        return c.mutate<ShipmentDetail>("shipment.create", input);
      },
      update(input: ShipmentUpdateInput) {
        return c.mutate<ShipmentDetail>("shipment.update", input);
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("shipment.delete", { id });
      },
    };
  }

  get bankAccount() {
    const c = this;
    return {
      list() {
        return c.query<BankAccountSummary[]>("bankAccount.list");
      },
      get(id: string) {
        return c.query<BankAccountDetail | null>("bankAccount.getById", { id });
      },
      create(input: BankAccountCreateInput) {
        return c.mutate<BankAccountSummary>("bankAccount.create", input);
      },
      update(id: string, data: Partial<BankAccountCreateInput>) {
        return c.mutate<BankAccountSummary>("bankAccount.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("bankAccount.delete", { id });
      },
      transfer(input: BankTransferInput) {
        return c.mutate<BankTransferResult>("bankAccount.transfer", input);
      },
      listTransactions(input: BankTransactionListInput) {
        return c.query<PaginatedResult<BankTransactionRow>>("bankAccount.listTransactions", input);
      },
      summary() {
        return c.query<BankSummary>("bankAccount.summary");
      },
      getGatewayConfig(bankAccountId: string) {
        return c.query<GatewayConfig | null>("bankAccount.getGatewayConfig", { bankAccountId });
      },
      upsertGatewayConfig(input: UpsertGatewayConfigInput) {
        return c.mutate<GatewayConfig>("bankAccount.upsertGatewayConfig", input);
      },
    };
  }

  get reports() {
    const c = this;
    return {
      daybook(input: DaybookInput) {
        return c.query<DaybookResult>("reports.daybook", input);
      },
      outstanding(input: OutstandingInput) {
        return c.query<OutstandingResult>("reports.outstanding", input);
      },
      taxSummary(input: TaxSummaryInput) {
        return c.query<TaxSummaryResult>("reports.taxSummary", input);
      },
      itemSales(input: ItemSalesInput) {
        return c.query<ItemSalesResult>("reports.itemSales", input);
      },
      stockSummary(input: StockSummaryInput) {
        return c.query<StockSummaryResult>("reports.stockSummary", input);
      },
      partyStatement(input: PartyStatementInput) {
        return c.query<PartyStatementResult>("reports.partyStatement", input);
      },
      paymentSummary(input: PaymentSummaryInput) {
        return c.query<PaymentSummaryResult>("reports.paymentSummary", input);
      },
    };
  }

  get store() {
    const c = this;
    return {
      getSettings() {
        return c.query<StoreSettings>("store.getSettings");
      },
      updateSettings(input: StoreSettingsUpdateInput) {
        return c.mutate<StoreSettings>("store.updateSettings", input);
      },
      listOrders(input: StoreOrderListInput) {
        return c.query<PaginatedResult<StoreOrderSummary>>("store.listOrders", input);
      },
      getOrder(id: string) {
        return c.query<StoreOrderDetail | null>("store.getOrder", { id });
      },
      updateOrderStatus(input: { orderId: string; status: "preparing" | "ready" | "delivered" }) {
        return c.mutate<{ success: boolean; status: string }>("store.updateOrderStatus", input);
      },
      confirmOrder(orderId: string) {
        return c.mutate<{ success: boolean; orderId: string }>("store.confirmOrder", { orderId });
      },
      cancelOrder(orderId: string, reason?: string) {
        return c.mutate<{ success: boolean; orderId: string }>("store.cancelOrder", { orderId, reason });
      },
      checkSlug(slug: string) {
        return c.query<{ available: boolean }>("store.checkSlug", { slug });
      },
      listStoreItems(input: { search?: string; category?: string; storeEnabled?: boolean; page?: number; limit?: number }) {
        return c.query<PaginatedResult<unknown>>("store.listStoreItems", input);
      },
      bulkToggleItems(itemIds: string[], storeEnabled: boolean) {
        return c.mutate<{ updated: number }>("store.bulkToggleItems", { itemIds, storeEnabled });
      },
    };
  }

  get target() {
    const c = this;
    return {
      list(input: TargetListInput) {
        return c.query<TargetRow[]>("target.list", input);
      },
      create(input: TargetCreateInput) {
        return c.mutate<TargetRow>("target.create", input);
      },
      getProgress(id: string) {
        return c.query<TargetWithProgress>("target.getProgress", { id });
      },
      update(input: TargetUpdateInput) {
        return c.mutate<TargetRow>("target.update", input);
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("target.delete", { id });
      },
      myTargets() {
        return c.query<TargetWithProgress[]>("target.myTargets");
      },
    };
  }

  get import() {
    const c = this;
    return {
      importParties(input: ImportPartiesInput) {
        return c.mutate<ImportResult>("import.importParties", input);
      },
      importItems(input: ImportItemsInput) {
        return c.mutate<ImportItemsResult>("import.importItems", input);
      },
      importInvoices(input: ImportInvoicesInput) {
        return c.mutate<ImportResult>("import.importInvoices", input);
      },
      importPayments(input: ImportPaymentsInput) {
        return c.mutate<ImportResult>("import.importPayments", input);
      },
    };
  }

  get auth() {
    const c = this;
    return {
      listSessions(expired = false) {
        return c.query<unknown[]>("auth.listSessions", { expired });
      },
      revokeSession(sessionId: string) {
        return c.mutate<{ success: boolean }>("auth.revokeSession", { sessionId });
      },
    };
  }

  get tenant() {
    const c = this;
    return {
      list() {
        return c.query<unknown[]>("tenant.list");
      },
      select(tenantId: string) {
        return c.mutate<{ success: boolean }>("tenant.select", { tenantId });
      },
      members() {
        return c.query<unknown[]>("tenant.members");
      },
      inviteMember(email: string, role: string) {
        return c.mutate<{ token: string; expiresAt: Date }>("tenant.inviteMember", { email, role });
      },
      removeMember(userId: string) {
        return c.mutate<{ success: boolean }>("tenant.removeMember", { userId });
      },
      updateMemberRole(userId: string, role: string) {
        return c.mutate<{ success: boolean }>("tenant.updateMemberRole", { userId, role });
      },
      pendingInvitations() {
        return c.query<unknown[]>("tenant.pendingInvitations");
      },
      revokeInvitation(invitationId: string) {
        return c.mutate<{ success: boolean }>("tenant.revokeInvitation", { invitationId });
      },
    };
  }

  get apiKey() {
    const c = this;
    return {
      list() {
        return c.query<unknown[]>("apiKey.list");
      },
      create(input: { name: string; expiresAt?: string }) {
        return c.mutate<{ id: string; name: string; key: string; keyPrefix: string; expiresAt: Date | null }>("apiKey.create", input);
      },
      revoke(id: string) {
        return c.mutate<{ success: boolean }>("apiKey.revoke", { id });
      },
    };
  }

  get automatedInvoice() {
    const c = this;
    return {
      list(input: RecurringInvoiceListInput) {
        return c.query<PaginatedResult<RecurringInvoiceTemplateSummary>>("recurringInvoice.list", input);
      },
      getById(id: string) {
        return c.query<RecurringInvoiceTemplateDetail>("recurringInvoice.getById", { id });
      },
      create(input: RecurringInvoiceCreateInput) {
        return c.mutate<RecurringInvoiceTemplateDetail>("recurringInvoice.create", input);
      },
      update(id: string, data: RecurringInvoiceUpdateInput) {
        return c.mutate<RecurringInvoiceTemplateDetail>("recurringInvoice.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("recurringInvoice.delete", { id });
      },
      pause(id: string) {
        return c.mutate<RecurringInvoiceTemplateSummary>("recurringInvoice.pause", { id });
      },
      resume(id: string) {
        return c.mutate<RecurringInvoiceTemplateSummary>("recurringInvoice.resume", { id });
      },
      runNow(id: string) {
        return c.mutate<RecurringInvoiceRunResult>("recurringInvoice.runNow", { id });
      },
      executionHistory(templateId: string, page?: number, limit?: number) {
        return c.query<PaginatedResult<RecurringInvoiceRun>>("recurringInvoice.executionHistory", { templateId, page, limit });
      },
      planUsage() {
        return c.query<RecurringInvoicePlanUsage>("recurringInvoice.planUsage");
      },
      suggestions() {
        return c.query<RecurringInvoiceSuggestion[]>("recurringInvoice.suggestions");
      },
    };
  }

  get document() {
    const c = this;
    return {
      convert(input: { sourceId: string; targetType: DocumentType }) {
        return c.mutate<InvoiceDetail>("document.convert", input);
      },
    };
  }

  get quotation() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("quotation.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("quotation.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("quotation.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("quotation.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("quotation.delete", { id });
      },
    };
  }

  get creditNote() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("creditNote.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("creditNote.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("creditNote.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("creditNote.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("creditNote.delete", { id });
      },
    };
  }

  get debitNote() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("debitNote.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("debitNote.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("debitNote.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("debitNote.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("debitNote.delete", { id });
      },
    };
  }

  get deliveryChallan() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("deliveryChallan.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("deliveryChallan.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("deliveryChallan.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("deliveryChallan.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("deliveryChallan.delete", { id });
      },
    };
  }

  get proforma() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("proforma.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("proforma.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("proforma.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("proforma.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("proforma.delete", { id });
      },
    };
  }

  get salesReturn() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("salesReturn.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("salesReturn.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("salesReturn.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("salesReturn.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("salesReturn.delete", { id });
      },
    };
  }

  get purchaseReturn() {
    const c = this;
    return {
      list(input: DocumentListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("purchaseReturn.list", input);
      },
      getById(id: string) {
        return c.query<InvoiceDetail | null>("purchaseReturn.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("purchaseReturn.create", input);
      },
      updateStatus(id: string, status: string) {
        return c.mutate<InvoiceSummary>("purchaseReturn.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("purchaseReturn.delete", { id });
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

// ── Payment types ──────────────────────────────────────────────

export interface PaymentDetail extends PaymentSummary {
  bankAccountId: string | null;
  linkedInvoices: Array<{
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    totalAmount: string;
    amountPaid: string;
    status: string;
    amount: string;
  }>;
}

export interface PaymentUpdateInput {
  id: string;
  amount?: string;
  mode?: "cash" | "bank" | "upi" | "cheque" | "other";
  discount?: string;
  referenceNumber?: string | null;
  paymentDate?: string;
  notes?: string | null;
  bankAccountId?: string | null;
  allocations?: Array<{ invoiceId: string; amount: string }>;
}

// ── Shipment types ─────────────────────────────────────────────

export type ShipmentStatus = "pending" | "shipped" | "in_transit" | "delivered" | "returned";

export interface ShipmentSummary {
  id: string;
  invoiceId: string | null;
  partyId: string | null;
  carrier: string | null;
  mode: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  cost: string;
  weight: string | null;
  status: ShipmentStatus;
  shipmentDate: string | null;
  estimatedDelivery: string | null;
  actualDelivery: string | null;
  notes: string | null;
  createdAt: string;
  invoiceNumber: string | null;
  partyName: string | null;
}

export interface ShipmentDetail extends ShipmentSummary {
  businessId: string;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPincode: string | null;
  updatedAt: string;
}

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

export type BankAccountType = "savings" | "current" | "cash" | "credit" | "other" | "payment_gateway";

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

export interface GatewayConfig {
  id: string;
  businessId: string;
  bankAccountId: string;
  settlementAccountId: string;
  chargeConfig: GatewayChargeConfig;
  expenseCategory: string;
  autoSettle: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertGatewayConfigInput {
  bankAccountId: string;
  settlementAccountId: string;
  chargeConfig: GatewayChargeConfig;
  expenseCategory?: string;
  autoSettle?: boolean;
}

export interface BankAccountSummary {
  id: string;
  accountName: string;
  accountNumber: string | null;
  ifsc: string | null;
  bankName: string | null;
  accountType: BankAccountType;
  openingBalance: string;
  currentBalance: string;
  isDefault: boolean;
  createdAt: string;
}

export interface BankTransactionRow {
  id: string;
  businessId: string;
  bankAccountId: string;
  type: "deposit" | "withdrawal" | "transfer";
  amount: string;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  transactionDate: string;
  createdAt: string;
  balanceAfter: string;
}

export interface BankAccountDetail extends BankAccountSummary {
  recentTransactions: BankTransactionRow[];
}

export interface BankAccountCreateInput {
  accountName: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  accountType: BankAccountType;
  openingBalance?: string;
  isDefault?: boolean;
}

export interface BankTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  description?: string;
  transactionDate?: string;
}

export interface BankTransferResult {
  withdrawal: BankTransactionRow;
  deposit: BankTransactionRow;
}

export interface BankTransactionListInput {
  bankAccountId: string;
  fromDate?: string;
  toDate?: string;
  type?: "deposit" | "withdrawal" | "transfer";
  page?: number;
  limit?: number;
}

export interface BankSummary {
  totalBalance: string;
  cashInHand: string;
  bankBalance: string;
  accountCount: number;
}

// ── Reports types ──────────────────────────────────────────────

export interface DaybookInput {
  fromDate: string;
  toDate: string;
  typeFilter?: "all" | "invoices" | "payments" | "expenses";
}

export interface DaybookEntry {
  id: string;
  time: string;
  entryType: "invoice" | "payment" | "expense";
  number: string | null;
  partyOrCategory: string;
  debit: string;
  credit: string;
  mode: string | null;
  status: string | null;
  meta: Record<string, string | null>;
}

export interface DaybookResult {
  entries: DaybookEntry[];
  summary: {
    totalSalesInvoiced: string;
    totalPurchaseInvoiced: string;
    totalPaymentsReceived: string;
    totalPaymentsMade: string;
    totalExpenses: string;
    netCashMovement: string;
  };
}

export interface OutstandingInput {
  type?: "receivable" | "payable" | "both";
  asOfDate?: string;
}

export interface OutstandingResult {
  receivables: unknown | null;
  payables: unknown | null;
}

export interface TaxSummaryInput {
  fromDate: string;
  toDate: string;
  type?: "sales" | "purchases" | "both";
}

export interface TaxSummaryResult {
  rows: unknown[];
  summary: unknown;
}

export interface ItemSalesInput {
  fromDate: string;
  toDate: string;
  category?: string;
  itemType?: "product" | "service";
  sortBy?: "revenue" | "quantity" | "invoices" | "margin";
  compareToPrevious?: boolean;
}

export interface ItemSalesResult {
  rows: unknown[];
  summary: unknown;
  [key: string]: unknown;
}

export interface StockSummaryInput {
  category?: string;
  showZeroStock?: boolean;
}

export interface StockSummaryResult {
  rows: unknown[];
  summary: unknown;
  [key: string]: unknown;
}

export interface PartyStatementInput {
  partyId: string;
  fromDate?: string;
  toDate?: string;
}

export interface PartyStatementResult {
  [key: string]: unknown;
}

export interface PaymentSummaryInput {
  fromDate: string;
  toDate: string;
  type?: "received" | "made" | "both";
  bankAccountId?: string;
}

export interface PaymentSummaryResult {
  [key: string]: unknown;
}

// ── Store types ────────────────────────────────────────────────

export interface StoreSettings {
  storeEnabled: boolean;
  storeSlug: string | null;
  storeTagline: string | null;
  storeAccentColor: string | null;
  storeMinOrderAmount: string | null;
  storeDeliveryNote: string | null;
  storeWhatsappNumber: string | null;
  storeAllowNegativeStock: boolean;
  storeOrderPrefix: string;
  nextStoreOrderNumber: number;
  currency: string;
}

export interface StoreSettingsUpdateInput {
  storeEnabled?: boolean;
  storeSlug?: string | null;
  storeTagline?: string | null;
  storeAccentColor?: string | null;
  storeMinOrderAmount?: string | null;
  storeDeliveryNote?: string | null;
  storeWhatsappNumber?: string | null;
  storeAllowNegativeStock?: boolean;
  storeOrderPrefix?: string;
}

export type StoreOrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";

export interface StoreOrderSummary {
  id: string;
  orderNumber: string;
  status: StoreOrderStatus;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryPincode: string | null;
  totalAmount: string;
  itemCount: number;
  invoiceId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface StoreOrderDetail extends StoreOrderSummary {
  invoice: unknown | null;
  lineItems: unknown[];
}

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

export interface TargetRow {
  id: string;
  businessId: string;
  userId: string;
  targetType: TargetType;
  targetValue: string;
  itemId: string | null;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  createdAt: string;
}

export interface TargetProgress {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

export interface TargetWithProgress extends TargetRow {
  progress: TargetProgress;
}

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

export interface ImportResult {
  created: number;
  skipped: number;
  total: number;
}

export interface ImportItemsResult extends ImportResult {
  unmappedUnits: string[];
}

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

export interface ImportPaymentRecord {
  partyName: string;
  amount: string;
  mode?: "cash" | "bank" | "upi" | "cheque" | "other";
  paymentDate?: string;
  paymentNumber?: string;
  referenceNumber?: string;
  notes?: string;
  invoiceNumbers?: string[];
}

export interface ImportPaymentsInput {
  source?: string;
  paidInvoiceNumbers?: string[];
  payments: ImportPaymentRecord[];
}

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

export interface DocumentListInput {
  type?: "sale" | "purchase" | null;
  status?: string | null;
  partyId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
}

// ── Recurring / Automated Invoice types ──────────────────────────

export type RecurringInvoiceFrequency =
  | "weekly" | "biweekly" | "monthly" | "quarterly"
  | "half_yearly" | "yearly" | "custom";

export type RecurringInvoiceStatus = "active" | "paused" | "completed" | "expired";

export type RecurringInvoiceRunStatus = "success" | "failed" | "skipped_limit";

export interface RecurringInvoiceLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent?: string;
  discountPercent?: string;
}

export interface RecurringInvoiceTemplateSummary {
  id: string;
  businessId: string;
  partyId: string;
  partyName: string;
  name: string;
  type: "sale" | "purchase";
  frequency: RecurringInvoiceFrequency;
  customIntervalDays: number | null;
  status: RecurringInvoiceStatus;
  startDate: string;
  endDate: string | null;
  nextRunDate: string | null;
  lastRunDate: string | null;
  totalRuns: number;
  maxRuns: number | null;
  createdAt: string;
}

export interface RecurringInvoiceTemplateDetail extends RecurringInvoiceTemplateSummary {
  lineItems: RecurringInvoiceLineItem[];
  notes: string | null;
}

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

export interface RecurringInvoiceRun {
  id: string;
  templateId: string;
  businessId: string;
  invoiceId: string | null;
  status: RecurringInvoiceRunStatus;
  errorMessage: string | null;
  executedAt: string;
}

export interface RecurringInvoiceRunResult {
  run: RecurringInvoiceRun;
  invoice: InvoiceDetail | null;
}

export interface RecurringInvoicePlanUsage {
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
}

export interface RecurringInvoiceSuggestion {
  partyId: string;
  partyName: string;
  suggestedFrequency: RecurringInvoiceFrequency;
  medianIntervalDays: number;
  invoiceCount: number;
  suggestedLineItems: RecurringInvoiceLineItem[];
  confidence: number;
}

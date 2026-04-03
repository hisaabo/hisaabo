/**
 * HisaaboClient — thin fetch wrapper over the tRPC HTTP API.
 * CLI variant: adds x-client-type: "cli" header.
 */

import superjson from "superjson";

export interface ClientConfig {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
}

// ── Structured error types ──────────────────────────────────────────────────

export type HisaaboError =
  | { code: "unauthorized"; message: string }
  | { code: "forbidden"; message: string }
  | { code: "not_found"; resource: string }
  | { code: "validation_failed"; fields: Record<string, string[]> }
  | { code: "network_error"; message: string }
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
      return `Authentication required: ${err.message}`;
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
    case "network_error":
      return `Network error: ${err.message}`;
    case "api_error":
      return `API error: ${err.message}`;
  }
}

function normalizeTrpcError(raw: unknown): HisaaboError {
  if (!raw || typeof raw !== "object") {
    return { code: "api_error", message: "Unknown error from API" };
  }
  const err = raw as Record<string, unknown>;
  const code = err["code"] as string | undefined;
  const message = (err["message"] as string | undefined) ?? "Unknown error";

  if (code === "UNAUTHORIZED") return { code: "unauthorized", message };
  if (code === "FORBIDDEN") return { code: "forbidden", message };
  if (code === "NOT_FOUND") return { code: "not_found", resource: message };

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
  readonly apiUrl: string;

  constructor(private readonly config: ClientConfig) {
    this.apiUrl = config.apiUrl;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.config.token}`,
      "x-business-id": this.config.businessId,
      "x-tenant-id": this.config.tenantId,
      "x-client-type": "cli",
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

    const data = result["data"] as unknown;
    return superjson.deserialize(data as Parameters<typeof superjson.deserialize>[0]) as T;
  }

  async query<T>(path: string, input?: unknown): Promise<T> {
    const url = new URL(`${this.config.apiUrl}/api/trpc/${path}`);
    if (input !== undefined) {
      url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
    }
    try {
      const res = await fetch(url.toString(), { headers: this.buildHeaders() });
      return this.unwrap<T>(res);
    } catch (e) {
      if (e instanceof HisaaboApiError) throw e;
      throw new HisaaboApiError({ code: "network_error", message: String(e instanceof Error ? e.message : e) });
    }
  }

  async mutate<T>(path: string, input: unknown): Promise<T> {
    try {
      const res = await fetch(`${this.config.apiUrl}/api/trpc/${path}`, {
        method: "POST",
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(superjson.serialize(input)),
      });
      return this.unwrap<T>(res);
    } catch (e) {
      if (e instanceof HisaaboApiError) throw e;
      throw new HisaaboApiError({ code: "network_error", message: String(e instanceof Error ? e.message : e) });
    }
  }

  // ── Auth ──────────────────────────────────────────────────────

  get auth() {
    const c = this;
    return {
      login(input: { email: string; password: string }) {
        return c.mutate<{ sessionId: string; user: AuthUser }>("auth.login", input);
      },
      logout() {
        return c.mutate<{ success: boolean }>("auth.logout", {});
      },
      me() {
        return c.query<AuthUser>("auth.me");
      },
      completeProfile(input: { name: string }) {
        return c.mutate<any>("auth.completeProfile", input);
      },
      logoutAll() {
        return c.mutate<any>("auth.logoutAll", {});
      },
      register(input: any) {
        return c.mutate<any>("auth.register", input);
      },
      updateName(input: { name: string }) {
        return c.mutate<any>("auth.updateName", input);
      },
    };
  }

  // ── Business ──────────────────────────────────────────────────

  get business() {
    const c = this;
    return {
      list() {
        return c.query<BusinessSummary[]>("business.list");
      },
      get() {
        return c.query<BusinessDetail>("business.get");
      },
      create(input: any) {
        return c.mutate<any>("business.create", input);
      },
      update(input: any) {
        return c.mutate<any>("business.update", input);
      },
      updateSequenceNumber(input: any) {
        return c.mutate<any>("business.updateSequenceNumber", input);
      },
      auditTrail(input?: { page?: number; limit?: number }) {
        return c.query<any>("business.auditTrail", input);
      },
      exportData() {
        return c.mutate<any>("business.exportData", {});
      },
    };
  }

  // ── Invoice ───────────────────────────────────────────────────

  get invoice() {
    const c = this;
    return {
      list(input: InvoiceListInput) {
        return c.query<PaginatedResult<InvoiceSummary>>("invoice.list", input);
      },
      get(id: string) {
        return c.query<InvoiceDetail>("invoice.get", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate<InvoiceDetail>("invoice.create", input);
      },
      update(input: any) {
        return c.mutate<any>("invoice.update", input);
      },
      updateStatus(id: string, status: InvoiceStatus) {
        return c.mutate<InvoiceSummary>("invoice.updateStatus", { id, status });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("invoice.delete", { id });
      },
    };
  }

  // ── Party ─────────────────────────────────────────────────────

  get party() {
    const c = this;
    return {
      list(input: PartyListInput) {
        return c.query<PaginatedResult<PartySummary>>("party.list", input);
      },
      get(id: string) {
        return c.query<PartyDetail>("party.get", { id });
      },
      create(input: PartyCreateInput) {
        return c.mutate<PartySummary>("party.create", input);
      },
      update(id: string, data: Partial<PartyCreateInput>) {
        return c.mutate<PartyDetail>("party.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("party.delete", { id });
      },
      ledger(partyId: string, input?: LedgerInput) {
        return c.query<LedgerResult>("party.ledger", { partyId, ...input });
      },
      ledgerReport(input: any) {
        return c.query<any>("party.ledgerReport", input);
      },
      getStats(input: any) {
        return c.query<any>("party.getStats", input);
      },
      topItems(input: any) {
        return c.query<any>("party.topItems", input);
      },
      merge(input: any) {
        return c.mutate<any>("party.merge", input);
      },
    };
  }

  // ── Item ──────────────────────────────────────────────────────

  get item() {
    const c = this;
    return {
      list(input: ItemListInput) {
        return c.query<PaginatedResult<ItemSummary>>("item.list", input);
      },
      get(id: string) {
        return c.query<ItemDetail>("item.get", { id });
      },
      create(input: ItemCreateInput) {
        return c.mutate<ItemSummary>("item.create", input);
      },
      update(id: string, data: Partial<ItemCreateInput>) {
        return c.mutate<ItemDetail>("item.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("item.delete", { id });
      },
      adjustStock(input: StockAdjustInput) {
        return c.mutate<ItemSummary>("item.adjustStock", input);
      },
      categories() {
        return c.query<string[]>("item.categories");
      },
      createVariant(input: any) {
        return c.mutate<any>("item.createVariant", input);
      },
      updateVariant(input: any) {
        return c.mutate<any>("item.updateVariant", input);
      },
      deleteVariant(input: any) {
        return c.mutate<any>("item.deleteVariant", input);
      },
      listVariants(input: any) {
        return c.query<any>("item.listVariants", input);
      },
      merge(input: any) {
        return c.mutate<any>("item.merge", input);
      },
      switchBaseUnit(input: any) {
        return c.mutate<any>("item.switchBaseUnit", input);
      },
      renameUnit(input: any) {
        return c.mutate<any>("item.renameUnit", input);
      },
      stockAdjustmentHistory(input: any) {
        return c.query<any>("item.stockAdjustmentHistory", input);
      },
      lowStockCount() {
        return c.query<any>("item.lowStockCount");
      },
      priceHistory(input: any) {
        return c.query<any>("item.priceHistory", input);
      },
      salesStats(input: any) {
        return c.query<any>("item.salesStats", input);
      },
      stockMovements(input: any) {
        return c.query<any>("item.stockMovements", input);
      },
    };
  }

  // ── Payment ───────────────────────────────────────────────────

  get payment() {
    const c = this;
    return {
      list(input: PaymentListInput) {
        return c.query<PaginatedResult<PaymentSummary>>("payment.list", input);
      },
      getById(id: string) {
        return c.query<PaymentDetail | null>("payment.getById", { id });
      },
      create(input: PaymentCreateInput) {
        return c.mutate<PaymentSummary>("payment.create", input);
      },
      update(input: PaymentUpdateInput) {
        return c.mutate<PaymentSummary>("payment.update", input);
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("payment.delete", { id });
      },
      unpaidInvoices(input: any) {
        return c.query<any>("payment.unpaidInvoices", input);
      },
      untrackedPayments(input: any) {
        return c.query<any>("payment.untrackedPayments", input);
      },
      defaultAccount(input?: any) {
        return c.query<any>("payment.defaultAccount", input);
      },
      assignAccount(input: any) {
        return c.mutate<any>("payment.assignAccount", input);
      },
    };
  }

  // ── Expense ───────────────────────────────────────────────────

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

  // ── Dashboard ─────────────────────────────────────────────────

  get dashboard() {
    const c = this;
    return {
      summary(input?: DashboardInput) {
        return c.query<DashboardSummary>("dashboard.summary", input);
      },
      salesTrend(input: { months?: number; fromDate?: string; toDate?: string; granularity?: string }) {
        return c.query<any>("dashboard.salesTrend", input);
      },
      topOutstanding(input?: { limit?: number }) {
        return c.query<any>("dashboard.topOutstanding", input);
      },
      topCustomers(input?: { limit?: number; fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.topCustomers", input);
      },
      topSellingItems(input?: { limit?: number; itemType?: string; fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.topSellingItems", input);
      },
      expensesByCategory(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.expensesByCategory", input);
      },
      invoiceStatusBreakdown(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.invoiceStatusBreakdown", input);
      },
      profitAndLoss(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.profitAndLoss", input);
      },
      receivablesAging() {
        return c.query<any>("dashboard.receivablesAging");
      },
      paymentModeBreakdown(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.paymentModeBreakdown", input);
      },
      collectionEfficiency(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.collectionEfficiency", input);
      },
      monthlyComparison() {
        return c.query<any>("dashboard.monthlyComparison");
      },
      shippingSummary(input?: { fromDate?: string; toDate?: string }) {
        return c.query<any>("dashboard.shippingSummary", input);
      },
    };
  }

  // ── GST ───────────────────────────────────────────────────────

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

  // ── Shipment ──────────────────────────────────────────────────

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

  // ── Bank Account ──────────────────────────────────────────────

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
    };
  }

  // ── Reports ───────────────────────────────────────────────────

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
      salesRegister(input: { fromDate: string; toDate: string; partyId?: string }) {
        return c.query<any>("reports.salesRegister", input);
      },
      purchaseRegister(input: { fromDate: string; toDate: string; partyId?: string }) {
        return c.query<any>("reports.purchaseRegister", input);
      },
      cashFlowForecast(input?: Record<string, unknown>) {
        return c.query<any>("reports.cashFlowForecast", input ?? {});
      },
      collectionEfficiency(input: { fromDate: string; toDate: string }) {
        return c.query<any>("reports.collectionEfficiency", input);
      },
    };
  }

  // ── Store ─────────────────────────────────────────────────────

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
      updateOrder(input: { orderId: string; status: "preparing" | "ready" | "delivered" }) {
        return c.mutate<{ success: boolean; status: string }>("store.updateOrderStatus", input);
      },
      confirmOrder(input: any) {
        return c.mutate<any>("store.confirmOrder", input);
      },
      cancelOrder(input: any) {
        return c.mutate<any>("store.cancelOrder", input);
      },
      checkSlug(input: any) {
        return c.query<any>("store.checkSlug", input);
      },
      listStoreItems(input: any) {
        return c.query<any>("store.listStoreItems", input);
      },
      bulkToggleItems(input: any) {
        return c.mutate<any>("store.bulkToggleItems", input);
      },
    };
  }

  // ── Target ────────────────────────────────────────────────────

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

  // ── Tenant ───────────────────────────────────────────────────

  get tenant() {
    const c = this;
    return {
      list() {
        return c.query<any>("tenant.list");
      },
      select(input: any) {
        return c.mutate<any>("tenant.select", input);
      },
      members() {
        return c.query<any>("tenant.members");
      },
      inviteMember(input: any) {
        return c.mutate<any>("tenant.inviteMember", input);
      },
      removeMember(input: any) {
        return c.mutate<any>("tenant.removeMember", input);
      },
      updateMemberRole(input: any) {
        return c.mutate<any>("tenant.updateMemberRole", input);
      },
    };
  }

  // ── Document ──────────────────────────────────────────────────

  get document() {
    const c = this;
    return {
      convert(input: any) {
        return c.mutate<any>("document.convert", input);
      },
    };
  }

  // ── Quotation ─────────────────────────────────────────────────

  get quotation() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("quotation.list", input);
      },
      getById(input: any) {
        return c.query<any>("quotation.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("quotation.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("quotation.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("quotation.delete", input);
      },
    };
  }

  // ── Credit Note ───────────────────────────────────────────────

  get creditNote() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("creditNote.list", input);
      },
      getById(input: any) {
        return c.query<any>("creditNote.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("creditNote.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("creditNote.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("creditNote.delete", input);
      },
    };
  }

  // ── Debit Note ────────────────────────────────────────────────

  get debitNote() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("debitNote.list", input);
      },
      getById(input: any) {
        return c.query<any>("debitNote.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("debitNote.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("debitNote.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("debitNote.delete", input);
      },
    };
  }

  // ── Delivery Challan ──────────────────────────────────────────

  get deliveryChallan() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("deliveryChallan.list", input);
      },
      getById(input: any) {
        return c.query<any>("deliveryChallan.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("deliveryChallan.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("deliveryChallan.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("deliveryChallan.delete", input);
      },
    };
  }

  // ── Proforma ──────────────────────────────────────────────────

  get proforma() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("proforma.list", input);
      },
      getById(input: any) {
        return c.query<any>("proforma.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("proforma.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("proforma.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("proforma.delete", input);
      },
    };
  }

  // ── Sales Return ──────────────────────────────────────────────

  get salesReturn() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("salesReturn.list", input);
      },
      getById(input: any) {
        return c.query<any>("salesReturn.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("salesReturn.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("salesReturn.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("salesReturn.delete", input);
      },
    };
  }

  // ── Purchase Return ───────────────────────────────────────────

  get purchaseReturn() {
    const c = this;
    return {
      list(input: any) {
        return c.query<any>("purchaseReturn.list", input);
      },
      getById(input: any) {
        return c.query<any>("purchaseReturn.getById", input);
      },
      create(input: any) {
        return c.mutate<any>("purchaseReturn.create", input);
      },
      updateStatus(input: any) {
        return c.mutate<any>("purchaseReturn.updateStatus", input);
      },
      delete(input: any) {
        return c.mutate<any>("purchaseReturn.delete", input);
      },
    };
  }

  // ── Recurring Invoice ─────────────────────────────────────────

  get recurringInvoice() {
    const c = this;
    return {
      list(input: RecurringInvoiceListInput) {
        return c.query<PaginatedResult<RecurringInvoiceSummary>>("recurringInvoice.list", input);
      },
      getById(id: string) {
        return c.query<RecurringInvoiceDetail>("recurringInvoice.getById", { id });
      },
      create(input: RecurringInvoiceCreateInput) {
        return c.mutate<RecurringInvoiceDetail>("recurringInvoice.create", input);
      },
      update(id: string, data: Partial<RecurringInvoiceCreateInput>) {
        return c.mutate<RecurringInvoiceDetail>("recurringInvoice.update", { id, data });
      },
      delete(id: string) {
        return c.mutate<{ success: boolean }>("recurringInvoice.delete", { id });
      },
      pause(id: string) {
        return c.mutate<{ success: boolean }>("recurringInvoice.pause", { id });
      },
      resume(id: string) {
        return c.mutate<{ success: boolean }>("recurringInvoice.resume", { id });
      },
      runNow(id: string) {
        return c.mutate<{ success: boolean; invoiceId?: string }>("recurringInvoice.runNow", { id });
      },
      executionHistory(templateId: string, page?: number, limit?: number) {
        return c.query<PaginatedResult<RecurringInvoiceExecution>>("recurringInvoice.executionHistory", { templateId, page, limit });
      },
      planUsage() {
        return c.query<RecurringInvoicePlanUsage>("recurringInvoice.planUsage");
      },
      suggestions() {
        return c.query<RecurringInvoiceSuggestion[]>("recurringInvoice.suggestions");
      },
    };
  }

  // ── API Key ───────────────────────────────────────────────────

  get apiKey() {
    const c = this;
    return {
      list() {
        return c.query<any>("apiKey.list");
      },
      create(input: any) {
        return c.mutate<any>("apiKey.create", input);
      },
      revoke(input: any) {
        return c.mutate<any>("apiKey.revoke", input);
      },
    };
  }

  // ── Import ────────────────────────────────────────────────────

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
}

// ── Type definitions ───────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
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
  deliveryMethod?: string | null;
  createdByName?: string | null;
  createdAt?: string;
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
  deliveryMethod?: string;
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

export type BankAccountType = "savings" | "current" | "cash" | "credit" | "other";

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

export interface BankAccountDetail extends BankAccountSummary {
  recentTransactions: BankTransactionRow[];
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

export interface StoreSettings {
  storeEnabled: boolean;
  storeSlug: string | null;
  storeName: string | null;
  storeDescription: string | null;
  [key: string]: unknown;
}

export interface StoreSettingsUpdateInput {
  storeEnabled?: boolean;
  storeSlug?: string;
  storeName?: string;
  storeDescription?: string;
  [key: string]: unknown;
}

export interface StoreOrderSummary {
  id: string;
  orderNumber: string;
  customerName: string;
  totalAmount: string;
  status: string;
  createdAt: string;
}

export interface StoreOrderDetail extends StoreOrderSummary {
  items: Array<{ name: string; quantity: number; price: string }>;
  shippingAddress: string | null;
  notes: string | null;
}

export interface StoreOrderListInput {
  status?: string | null;
  page?: number;
  limit?: number;
}

export type TargetType = "order_count" | "order_value" | "item_quantity";
export type TargetPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "custom";

export interface TargetRow {
  id: string;
  type: TargetType;
  period: TargetPeriod;
  targetValue: string;
  startDate: string;
  endDate: string | null;
  assignedToId: string | null;
  itemId: string | null;
  notes: string | null;
}

export interface TargetWithProgress extends TargetRow {
  currentValue: string;
  percentComplete: number;
}

export interface TargetListInput {
  type?: TargetType | null;
  period?: TargetPeriod | null;
  page?: number;
  limit?: number;
}

export interface TargetCreateInput {
  type: TargetType;
  period: TargetPeriod;
  targetValue: string;
  startDate: string;
  endDate?: string;
  assignedToId?: string;
  itemId?: string;
  notes?: string;
}

export interface TargetUpdateInput {
  id: string;
  targetValue?: string;
  endDate?: string;
  notes?: string;
}

export interface ImportPartiesInput {
  parties: Array<Record<string, unknown>>;
}

export interface ImportItemsInput {
  items: Array<Record<string, unknown>>;
}

export interface ImportInvoicesInput {
  invoices: Array<Record<string, unknown>>;
}

export interface ImportPaymentsInput {
  payments: Array<Record<string, unknown>>;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface ImportItemsResult extends ImportResult {
  created: number;
}

// ── Recurring Invoice types ───────────────────────────────────────────────

export type RecurringInvoiceStatus = "active" | "paused" | "completed" | "expired";
export type RecurringInvoiceFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "custom";

export interface RecurringInvoiceSummary {
  id: string;
  name: string;
  partyName: string;
  type: "sale" | "purchase";
  frequency: RecurringInvoiceFrequency;
  status: RecurringInvoiceStatus;
  nextRunDate: string | null;
  lastRunDate: string | null;
  totalRuns: number;
  maxRuns: number | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
}

export interface RecurringInvoiceLineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent?: string;
  discountPercent?: string;
}

export interface RecurringInvoiceDetail extends RecurringInvoiceSummary {
  partyId: string;
  customIntervalDays: number | null;
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
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxPercent?: string;
    discountPercent?: string;
  }>;
  startDate: string;
  endDate?: string;
  maxRuns?: number;
  notes?: string;
}

export interface RecurringInvoiceExecution {
  id: string;
  invoiceNumber: string;
  status: string;
  errorMessage: string | null;
  executedAt: string;
}

export interface RecurringInvoicePlanUsage {
  runsThisMonth: number;
  totalTemplates: number;
}

export interface RecurringInvoiceSuggestion {
  partyId: string;
  partyName: string;
  frequency: string;
  confidence: number;
  reason: string;
}

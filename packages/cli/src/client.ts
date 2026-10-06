/**
 * HisaaboClient — thin fetch wrapper over the tRPC HTTP API.
 * CLI variant: adds x-client-type and X-Hisaabo-Client: "cli" headers.
 */

import superjson from "superjson";
import type { InputArgs, InputOf, MutationPath, OutputOf, QueryPath } from "./api-types.js";

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
  | { code: "rate_limited"; retryAfterMs: number; message: string }
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
    case "rate_limited":
      return `Rate limited: ${err.message}`;
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

// ── Timeouts ───────────────────────────────────────────────────────────────

/** Per-request timeout for API calls. Override with HISAABO_TIMEOUT_MS. */
export function requestTimeoutMs(): number {
  const n = Number(process.env["HISAABO_TIMEOUT_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/** Idle timeout for large streaming transfers (backup download/upload). */
export function transferTimeoutMs(): number {
  const n = Number(process.env["HISAABO_TRANSFER_TIMEOUT_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60_000;
}

// ── HTTP client ────────────────────────────────────────────────────────────

export class HisaaboClient {
  readonly apiUrl: string;

  constructor(private readonly config: ClientConfig) {
    this.apiUrl = config.apiUrl;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "x-tenant-id": this.config.tenantId,
      "x-client-type": "cli",
      "X-Hisaabo-Client": "cli",
    };
    if (this.config.token) headers["Authorization"] = `Bearer ${this.config.token}`;
    // Only include x-business-id when a business is selected — tenant-level
    // operations (backup export/restore) work without one.
    if (this.config.businessId) {
      headers["x-business-id"] = this.config.businessId;
    }
    return headers;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    // Detect rate limiting before tRPC error parsing
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      let retryMs = 60_000;
      if (retryAfter) {
        const parsed = Number(retryAfter);
        if (Number.isFinite(parsed) && parsed > 0) {
          retryMs = Math.min(parsed * 1000, 120_000); // cap at 2 minutes
        }
      }
      throw new HisaaboApiError({
        code: "rate_limited",
        retryAfterMs: retryMs,
        message: `Rate limited. Try again in ${Math.ceil(retryMs / 1000)}s.`,
      });
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new HisaaboApiError({
        code: "api_error",
        message: `Unexpected non-JSON response from API (HTTP ${res.status})`,
      });
    }

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

  async query<P extends QueryPath>(path: P, ...args: InputArgs<P>): Promise<OutputOf<P>> {
    const input: unknown = args[0];
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = new URL(`${this.config.apiUrl}/api/trpc/${path}`);
        if (input !== undefined) {
          url.searchParams.set("input", JSON.stringify(superjson.serialize(input)));
        }
        const res = await fetch(url.toString(), {
          headers: this.buildHeaders(),
          signal: AbortSignal.timeout(requestTimeoutMs()),
        });
        return await this.unwrap<OutputOf<P>>(res);
      } catch (e) {
        // Auto-retry on rate limit for idempotent reads
        if (e instanceof HisaaboApiError && e.hisaaboError.code === "rate_limited" && attempt < maxRetries) {
          const waitMs = Math.min((e.hisaaboError as { retryAfterMs: number }).retryAfterMs, 10_000);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (e instanceof HisaaboApiError) throw e;
        throw new HisaaboApiError({ code: "network_error", message: String(e instanceof Error ? e.message : e) });
      }
    }
    throw new HisaaboApiError({ code: "api_error", message: "Max retries exceeded" });
  }

  async mutate<P extends MutationPath>(path: P, ...args: InputArgs<P>): Promise<OutputOf<P>> {
    const input: unknown = args[0];
    try {
      const res = await fetch(`${this.config.apiUrl}/api/trpc/${path}`, {
        method: "POST",
        headers: { ...this.buildHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(superjson.serialize(input)),
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
      return await this.unwrap<OutputOf<P>>(res);
    } catch (e) {
      if (e instanceof HisaaboApiError) throw e;
      throw new HisaaboApiError({ code: "network_error", message: String(e instanceof Error ? e.message : e) });
    }
  }

  // ── Auth ──────────────────────────────────────────────────────

  get auth() {
    const c = this;
    return {
      nativeStart(input: { redirectUri: string; codeChallenge: string; state: string }) {
        return c.mutate("auth.nativeStart", {
          client: "cli",
          codeChallengeMethod: "S256",
          ...input,
        });
      },
      nativeExchange(input: { requestId: string; code: string; codeVerifier: string }) {
        return c.mutate("auth.nativeExchange", input)
          .then((r) => {
            if (!r.sessionToken) throw new HisaaboApiError({ code: "api_error", message: "Sign-in response did not include a session" });
            return { sessionToken: r.sessionToken, user: r.user };
          });
      },
      logout() {
        return c.mutate("auth.logout");
      },
      me() {
        // The API returns { user, tenantId, tenantName, role }; flatten it.
        return c.query("auth.me").then((r): AuthUser => {
          if (!r.user) throw new HisaaboApiError({ code: "unauthorized", message: "Not authenticated" });
          return { ...r.user, role: r.role ?? "", tenantId: r.tenantId, tenantName: r.tenantName };
        });
      },
      completeProfile(input: InputOf<"auth.completeProfile">) {
        return c.mutate("auth.completeProfile", input);
      },
      logoutAll() {
        return c.mutate("auth.logoutAll");
      },
      updateName(input: InputOf<"auth.updateName">) {
        return c.mutate("auth.updateName", input);
      },
      listSessions(input?: InputOf<"auth.listSessions">) {
        return c.query("auth.listSessions", input);
      },
      revokeSession(input: InputOf<"auth.revokeSession">) {
        return c.mutate("auth.revokeSession", input);
      },
    };
  }

  // ── Business ──────────────────────────────────────────────────

  get business() {
    const c = this;
    return {
      list() {
        return c.query("business.list");
      },
      get(id: string) {
        return c.query("business.getById", { id });
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
      auditTrail(input: InputOf<"business.auditTrail">) {
        return c.query("business.auditTrail", input);
      },
      exportData() {
        return c.mutate("business.exportData");
      },
    };
  }

  // ── Invoice ───────────────────────────────────────────────────

  get invoice() {
    const c = this;
    return {
      list(input: InvoiceListInput) {
        return c.query("invoice.list", input);
      },
      get(id: string) {
        return c.query("invoice.getById", { id });
      },
      create(input: InvoiceCreateInput) {
        return c.mutate("invoice.create", input);
      },
      update(input: InputOf<"invoice.update">) {
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

  // ── Party ─────────────────────────────────────────────────────

  get party() {
    const c = this;
    return {
      list(input: PartyListInput) {
        return c.query("party.list", input);
      },
      get(id: string) {
        return c.query("party.getById", { id });
      },
      create(input: PartyCreateInput) {
        return c.mutate("party.create", input);
      },
      update(id: string, data: InputOf<"party.update">["data"]) {
        return c.mutate("party.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("party.delete", { id });
      },
      ledger(partyId: string, input?: LedgerInput) {
        return c.query("party.ledger", { partyId, ...input });
      },
      ledgerReport(input: InputOf<"party.ledgerReport">) {
        return c.query("party.ledgerReport", input);
      },
      getStats(input: InputOf<"party.getStats">) {
        return c.query("party.getStats", input);
      },
      topItems(input: InputOf<"party.topItems">) {
        return c.query("party.topItems", input);
      },
      merge(input: InputOf<"party.merge">) {
        return c.mutate("party.merge", input);
      },
    };
  }

  // ── Item ──────────────────────────────────────────────────────

  get item() {
    const c = this;
    return {
      list(input: ItemListInput) {
        return c.query("item.list", input);
      },
      get(id: string) {
        return c.query("item.getById", { id });
      },
      create(input: ItemCreateInput) {
        return c.mutate("item.create", input);
      },
      update(id: string, data: InputOf<"item.update">["data"]) {
        return c.mutate("item.update", { id, data });
      },
      delete(id: string) {
        return c.mutate("item.delete", { id });
      },
      adjustStock(input: StockAdjustInput) {
        return c.mutate("item.adjustStock", input);
      },
      createVariant(input: InputOf<"item.createVariant">) {
        return c.mutate("item.createVariant", input);
      },
      updateVariant(input: InputOf<"item.updateVariant">) {
        return c.mutate("item.updateVariant", input);
      },
      deleteVariant(input: InputOf<"item.deleteVariant">) {
        return c.mutate("item.deleteVariant", input);
      },
      listVariants(input: InputOf<"item.listVariants">) {
        return c.query("item.listVariants", input);
      },
      merge(input: InputOf<"item.merge">) {
        return c.mutate("item.merge", input);
      },
      switchBaseUnit(input: InputOf<"item.switchBaseUnit">) {
        return c.mutate("item.switchBaseUnit", input);
      },
      renameUnit(input: InputOf<"item.renameUnit">) {
        return c.mutate("item.renameUnit", input);
      },
      stockAdjustmentHistory(input: InputOf<"item.stockAdjustmentHistory">) {
        return c.query("item.stockAdjustmentHistory", input);
      },
      lowStockCount() {
        return c.query("item.lowStockCount");
      },
      priceHistory(input: InputOf<"item.priceHistory">) {
        return c.query("item.priceHistory", input);
      },
      salesStats(input: InputOf<"item.salesStats">) {
        return c.query("item.salesStats", input);
      },
      stockMovements(input: InputOf<"item.stockMovements">) {
        return c.query("item.stockMovements", input);
      },
    };
  }

  // ── Payment ───────────────────────────────────────────────────

  get payment() {
    const c = this;
    return {
      list(input: PaymentListInput) {
        return c.query("payment.list", input);
      },
      getById(id: string) {
        return c.query("payment.getById", { id });
      },
      create(input: PaymentCreateInput) {
        return c.mutate("payment.create", input);
      },
      update(input: PaymentUpdateInput) {
        return c.mutate("payment.update", input);
      },
      delete(id: string) {
        return c.mutate("payment.delete", { id });
      },
      unpaidInvoices(input: InputOf<"payment.unpaidInvoices">) {
        return c.query("payment.unpaidInvoices", input);
      },
      untrackedPayments(input: InputOf<"payment.untrackedPayments">) {
        return c.query("payment.untrackedPayments", input);
      },
      defaultAccount(input?: InputOf<"payment.defaultAccount">) {
        return c.query("payment.defaultAccount", input);
      },
      assignAccount(input: InputOf<"payment.assignAccount">) {
        return c.mutate("payment.assignAccount", input);
      },
    };
  }

  // ── Expense ───────────────────────────────────────────────────

  get expense() {
    const c = this;
    return {
      list(input: ExpenseListInput) {
        return c.query("expense.list", input);
      },
      create(input: ExpenseCreateInput) {
        return c.mutate("expense.create", input);
      },
      update(id: string, data: InputOf<"expense.update">["data"]) {
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

  // ── Dashboard ─────────────────────────────────────────────────

  get dashboard() {
    const c = this;
    return {
      summary(input?: DashboardInput) {
        return c.query("dashboard.summary", input);
      },
      salesTrend(input: InputOf<"dashboard.salesTrend">) {
        return c.query("dashboard.salesTrend", input);
      },
      topOutstanding(input: InputOf<"dashboard.topOutstanding">) {
        return c.query("dashboard.topOutstanding", input);
      },
      topCustomers(input: InputOf<"dashboard.topCustomers">) {
        return c.query("dashboard.topCustomers", input);
      },
      topSellingItems(input: InputOf<"dashboard.topSellingItems">) {
        return c.query("dashboard.topSellingItems", input);
      },
      expensesByCategory(input: InputOf<"dashboard.expensesByCategory">) {
        return c.query("dashboard.expensesByCategory", input);
      },
      invoiceStatusBreakdown(input: InputOf<"dashboard.invoiceStatusBreakdown">) {
        return c.query("dashboard.invoiceStatusBreakdown", input);
      },
      profitAndLoss(input: InputOf<"dashboard.profitAndLoss">) {
        return c.query("dashboard.profitAndLoss", input);
      },
      receivablesAging() {
        return c.query("dashboard.receivablesAging");
      },
      paymentModeBreakdown(input: InputOf<"dashboard.paymentModeBreakdown">) {
        return c.query("dashboard.paymentModeBreakdown", input);
      },
      collectionEfficiency(input: InputOf<"dashboard.collectionEfficiency">) {
        return c.query("dashboard.collectionEfficiency", input);
      },
      monthlyComparison() {
        return c.query("dashboard.monthlyComparison");
      },
      shippingSummary(input?: InputOf<"dashboard.shippingSummary">) {
        return c.query("dashboard.shippingSummary", input);
      },
    };
  }

  // ── GST ───────────────────────────────────────────────────────

  get gst() {
    const c = this;
    return {
      gstr1(input: GstReportInput) {
        return c.query("gst.gstr1", input);
      },
      gstr3b(input: InputOf<"gst.gstr3b">) {
        return c.query("gst.gstr3b", input);
      },
      gstr1CSV(input: InputOf<"gst.gstr1CSV">) {
        return c.query("gst.gstr1CSV", input);
      },
      gstr9(input: InputOf<"gst.gstr9">) {
        return c.query("gst.gstr9", input);
      },
      gstr2bUploads(input?: InputOf<"gstr2b.uploads">) {
        return c.query("gstr2b.uploads", input ?? {});
      },
    };
  }

  // ── Shipment ──────────────────────────────────────────────────

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

  // ── Bank Account ──────────────────────────────────────────────

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
      update(id: string, data: InputOf<"bankAccount.update">["data"]) {
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

  // ── Reports ───────────────────────────────────────────────────

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
      salesRegister(input: InputOf<"reports.salesRegister">) {
        return c.query("reports.salesRegister", input);
      },
      purchaseRegister(input: InputOf<"reports.purchaseRegister">) {
        return c.query("reports.purchaseRegister", input);
      },
      cashFlowForecast(input?: InputOf<"reports.cashFlowForecast">) {
        return c.query("reports.cashFlowForecast", input ?? {});
      },
      collectionEfficiency(input: InputOf<"reports.collectionEfficiency">) {
        return c.query("reports.collectionEfficiency", input);
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
      tallyExport(input: InputOf<"reports.tallyExport">) {
        return c.query("reports.tallyExport", input);
      },
    };
  }

  // ── Store ─────────────────────────────────────────────────────

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
      updateOrder(input: InputOf<"store.updateOrderStatus">) {
        return c.mutate("store.updateOrderStatus", input);
      },
      confirmOrder(input: InputOf<"store.confirmOrder">) {
        return c.mutate("store.confirmOrder", input);
      },
      cancelOrder(input: InputOf<"store.cancelOrder">) {
        return c.mutate("store.cancelOrder", input);
      },
      checkSlug(input: InputOf<"store.checkSlug">) {
        return c.query("store.checkSlug", input);
      },
      listStoreItems(input: InputOf<"store.listStoreItems">) {
        return c.query("store.listStoreItems", input);
      },
      bulkToggleItems(input: InputOf<"store.bulkToggleItems">) {
        return c.mutate("store.bulkToggleItems", input);
      },
    };
  }

  // ── Target ────────────────────────────────────────────────────

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

  // ── Tenant ───────────────────────────────────────────────────

  get tenant() {
    const c = this;
    return {
      list() {
        return c.query("tenant.list");
      },
      select(input: InputOf<"tenant.select">) {
        return c.mutate("tenant.select", input);
      },
      members() {
        return c.query("tenant.members");
      },
      inviteMember(input: InputOf<"tenant.inviteMember">) {
        return c.mutate("tenant.inviteMember", input);
      },
      removeMember(input: InputOf<"tenant.removeMember">) {
        return c.mutate("tenant.removeMember", input);
      },
      updateMemberRole(input: InputOf<"tenant.updateMemberRole">) {
        return c.mutate("tenant.updateMemberRole", input);
      },
      pendingInvitations() {
        return c.query("tenant.pendingInvitations");
      },
      revokeInvitation(input: InputOf<"tenant.revokeInvitation">) {
        return c.mutate("tenant.revokeInvitation", input);
      },
    };
  }

  // ── Document ──────────────────────────────────────────────────

  get document() {
    const c = this;
    return {
      convert(input: InputOf<"document.convert">) {
        return c.mutate("document.convert", input);
      },
    };
  }

  // ── Quotation ─────────────────────────────────────────────────

  get quotation() {
    const c = this;
    return {
      list(input: InputOf<"quotation.list">) {
        return c.query("quotation.list", input);
      },
      getById(input: InputOf<"quotation.getById">) {
        return c.query("quotation.getById", input);
      },
      create(input: InputOf<"quotation.create">) {
        return c.mutate("quotation.create", input);
      },
      updateStatus(input: InputOf<"quotation.updateStatus">) {
        return c.mutate("quotation.updateStatus", input);
      },
      delete(input: InputOf<"quotation.delete">) {
        return c.mutate("quotation.delete", input);
      },
    };
  }

  // ── Credit Note ───────────────────────────────────────────────

  get creditNote() {
    const c = this;
    return {
      list(input: InputOf<"creditNote.list">) {
        return c.query("creditNote.list", input);
      },
      getById(input: InputOf<"creditNote.getById">) {
        return c.query("creditNote.getById", input);
      },
      create(input: InputOf<"creditNote.create">) {
        return c.mutate("creditNote.create", input);
      },
      updateStatus(input: InputOf<"creditNote.updateStatus">) {
        return c.mutate("creditNote.updateStatus", input);
      },
      delete(input: InputOf<"creditNote.delete">) {
        return c.mutate("creditNote.delete", input);
      },
    };
  }

  // ── Debit Note ────────────────────────────────────────────────

  get debitNote() {
    const c = this;
    return {
      list(input: InputOf<"debitNote.list">) {
        return c.query("debitNote.list", input);
      },
      getById(input: InputOf<"debitNote.getById">) {
        return c.query("debitNote.getById", input);
      },
      create(input: InputOf<"debitNote.create">) {
        return c.mutate("debitNote.create", input);
      },
      updateStatus(input: InputOf<"debitNote.updateStatus">) {
        return c.mutate("debitNote.updateStatus", input);
      },
      delete(input: InputOf<"debitNote.delete">) {
        return c.mutate("debitNote.delete", input);
      },
    };
  }

  // ── Delivery Challan ──────────────────────────────────────────

  get deliveryChallan() {
    const c = this;
    return {
      list(input: InputOf<"deliveryChallan.list">) {
        return c.query("deliveryChallan.list", input);
      },
      getById(input: InputOf<"deliveryChallan.getById">) {
        return c.query("deliveryChallan.getById", input);
      },
      create(input: InputOf<"deliveryChallan.create">) {
        return c.mutate("deliveryChallan.create", input);
      },
      updateStatus(input: InputOf<"deliveryChallan.updateStatus">) {
        return c.mutate("deliveryChallan.updateStatus", input);
      },
      delete(input: InputOf<"deliveryChallan.delete">) {
        return c.mutate("deliveryChallan.delete", input);
      },
    };
  }

  // ── Proforma ──────────────────────────────────────────────────

  get proforma() {
    const c = this;
    return {
      list(input: InputOf<"proforma.list">) {
        return c.query("proforma.list", input);
      },
      getById(input: InputOf<"proforma.getById">) {
        return c.query("proforma.getById", input);
      },
      create(input: InputOf<"proforma.create">) {
        return c.mutate("proforma.create", input);
      },
      updateStatus(input: InputOf<"proforma.updateStatus">) {
        return c.mutate("proforma.updateStatus", input);
      },
      delete(input: InputOf<"proforma.delete">) {
        return c.mutate("proforma.delete", input);
      },
    };
  }

  // ── Sales Return ──────────────────────────────────────────────

  get salesReturn() {
    const c = this;
    return {
      list(input: InputOf<"salesReturn.list">) {
        return c.query("salesReturn.list", input);
      },
      getById(input: InputOf<"salesReturn.getById">) {
        return c.query("salesReturn.getById", input);
      },
      create(input: InputOf<"salesReturn.create">) {
        return c.mutate("salesReturn.create", input);
      },
      updateStatus(input: InputOf<"salesReturn.updateStatus">) {
        return c.mutate("salesReturn.updateStatus", input);
      },
      delete(input: InputOf<"salesReturn.delete">) {
        return c.mutate("salesReturn.delete", input);
      },
    };
  }

  // ── Purchase Return ───────────────────────────────────────────

  get purchaseReturn() {
    const c = this;
    return {
      list(input: InputOf<"purchaseReturn.list">) {
        return c.query("purchaseReturn.list", input);
      },
      getById(input: InputOf<"purchaseReturn.getById">) {
        return c.query("purchaseReturn.getById", input);
      },
      create(input: InputOf<"purchaseReturn.create">) {
        return c.mutate("purchaseReturn.create", input);
      },
      updateStatus(input: InputOf<"purchaseReturn.updateStatus">) {
        return c.mutate("purchaseReturn.updateStatus", input);
      },
      delete(input: InputOf<"purchaseReturn.delete">) {
        return c.mutate("purchaseReturn.delete", input);
      },
    };
  }

  // ── Recurring Invoice ─────────────────────────────────────────

  get recurringInvoice() {
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
      update(id: string, data: InputOf<"recurringInvoice.update">["data"]) {
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

  // ── API Key ───────────────────────────────────────────────────

  get apiKey() {
    const c = this;
    return {
      list() {
        return c.query("apiKey.list");
      },
      create(input: InputOf<"apiKey.create">) {
        return c.mutate("apiKey.create", input);
      },
      revoke(input: InputOf<"apiKey.revoke">) {
        return c.mutate("apiKey.revoke", input);
      },
    };
  }

  // ── Import ────────────────────────────────────────────────────

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

  // ── Journal ───────────────────────────────────────────────────

  get journal() {
    const c = this;
    return {
      list(input: InputOf<"journal.list">) {
        return c.query("journal.list", input);
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
      delete(id: string) {
        return c.mutate("journal.delete", { id });
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

  // ── ITC ───────────────────────────────────────────────────────

  get itc() {
    const c = this;
    return {
      dashboard(input?: InputOf<"itc.dashboard">) {
        return c.query("itc.dashboard", input ?? {});
      },
      ledger(input: InputOf<"itc.ledger">) {
        return c.query("itc.ledger", input);
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

  // ── Bank Recon ────────────────────────────────────────────────

  get bankRecon() {
    const c = this;
    return {
      importList(input: InputOf<"bankRecon.importList">) {
        return c.query("bankRecon.importList", input);
      },
      importDetail(importId: string) {
        return c.query("bankRecon.importDetail", { importId });
      },
      summary(input: InputOf<"bankRecon.summary">) {
        return c.query("bankRecon.summary", input);
      },
      lines(input: InputOf<"bankRecon.lines">) {
        return c.query("bankRecon.lines", input);
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

  // ── E-Invoice ─────────────────────────────────────────────────

  get eInvoice() {
    const c = this;
    return {
      dashboard(input: InputOf<"eInvoice.dashboard">) {
        return c.query("eInvoice.dashboard", input);
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

  // ── E-Way Bill ────────────────────────────────────────────────

  get ewayBill() {
    const c = this;
    return {
      dashboard(input: InputOf<"ewayBill.dashboard">) {
        return c.query("ewayBill.dashboard", input);
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

  // ── GSTR-2B ───────────────────────────────────────────────────

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

  // ── Account ───────────────────────────────────────────────────

  get account() {
    const c = this;
    return {
      list() {
        return c.query("account.list");
      },
      create(input: InputOf<"account.create">) {
        return c.mutate("account.create", input);
      },
      update(input: InputOf<"account.update">) {
        return c.mutate("account.update", input);
      },
      delete(id: string) {
        return c.mutate("account.delete", { id });
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

  // ── Self Export ──────────────────────────────────────────────────

  get selfExport() {
    const c = this;
    return {
      request(input: InputOf<"selfExport.request">) {
        return c.mutate("selfExport.request", input);
      },
    };
  }

  // ── Self Import ──────────────────────────────────────────────────

  get selfImport() {
    const c = this;
    return {
      request(input: InputOf<"selfImport.request">) {
        return c.mutate("selfImport.request", input);
      },
    };
  }
}

// ── Type definitions ───────────────────────────────────────────────────────


export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  tenantId?: string | null;
  tenantName?: string | null;
}


export type InvoiceStatus = InputOf<"invoice.updateStatus">["status"];

export type DocumentType = InputOf<"document.convert">["targetDocumentType"];

export type InvoiceSummary = OutputOf<"invoice.list">["data"][number];



export type InvoiceListInput = InputOf<"invoice.list">;

export type InvoiceLineItemInput = InputOf<"invoice.create">["lineItems"][number];

export type InvoiceCreateInput = InputOf<"invoice.create">;

export type PartySummary = OutputOf<"party.list">["data"][number];


export type PartyListInput = InputOf<"party.list">;

export type PartyCreateInput = InputOf<"party.create">;


export type LedgerInput = Omit<InputOf<"party.ledger">, "partyId">;

export type ItemSummary = OutputOf<"item.list">["data"][number];


export type ItemListInput = InputOf<"item.list">;

export type ItemCreateInput = InputOf<"item.create">;

export type StockAdjustInput = InputOf<"item.adjustStock">;

export type PaymentSummary = OutputOf<"payment.list">["data"][number];


export type PaymentListInput = InputOf<"payment.list">;

export type PaymentCreateInput = InputOf<"payment.create">;

export type PaymentUpdateInput = InputOf<"payment.update">;

export type ExpenseSummary = OutputOf<"expense.list">["data"][number];

export type ExpenseListInput = InputOf<"expense.list">;

export type ExpenseCreateInput = InputOf<"expense.create">;

export type DashboardInput = InputOf<"dashboard.summary">;



export type GstReportInput = InputOf<"gst.gstr1">;



export type ShipmentSummary = OutputOf<"shipment.list">["data"][number];


export type ShipmentListInput = InputOf<"shipment.list">;

export type ShipmentCreateInput = InputOf<"shipment.create">;

export type ShipmentUpdateInput = InputOf<"shipment.update">;


export type GatewayChargeConfig = InputOf<"bankAccount.upsertGatewayConfig">["chargeConfig"];
export type GatewayChargeRate = NonNullable<GatewayChargeConfig[keyof GatewayChargeConfig]>;

export type UpsertGatewayConfigInput = InputOf<"bankAccount.upsertGatewayConfig">;

export type BankAccountSummary = OutputOf<"bankAccount.list">[number];


export type BankTransactionRow = OutputOf<"bankAccount.listTransactions">["data"][number];

export type BankAccountCreateInput = InputOf<"bankAccount.create">;

export type BankTransferInput = InputOf<"bankAccount.transfer">;


export type BankTransactionListInput = InputOf<"bankAccount.listTransactions">;


export type DaybookInput = InputOf<"reports.daybook">;

export type DaybookEntry = OutputOf<"reports.daybook">["entries"][number];


export type OutstandingInput = InputOf<"reports.outstanding">;


export type TaxSummaryInput = InputOf<"reports.taxSummary">;


export type ItemSalesInput = InputOf<"reports.itemSales">;


export type StockSummaryInput = InputOf<"reports.stockSummary">;


export type PartyStatementInput = InputOf<"reports.partyStatement">;


export type PaymentSummaryInput = InputOf<"reports.paymentSummary">;



export type StoreSettingsUpdateInput = InputOf<"store.updateSettings">;

export type StoreOrderSummary = OutputOf<"store.listOrders">["data"][number];


export type StoreOrderListInput = InputOf<"store.listOrders">;


export type TargetRow = OutputOf<"target.list">[number];


export type TargetListInput = InputOf<"target.list">;

export type TargetCreateInput = InputOf<"target.create">;

export type TargetUpdateInput = InputOf<"target.update">;

export type ImportPartiesInput = InputOf<"import.importParties">;

export type ImportItemsInput = InputOf<"import.importItems">;

export type ImportInvoicesInput = InputOf<"import.importInvoices">;

export type ImportPaymentsInput = InputOf<"import.importPayments">;



// ── Recurring Invoice types ───────────────────────────────────────────────


export type RecurringInvoiceSummary = OutputOf<"recurringInvoice.list">["data"][number];



export type RecurringInvoiceListInput = InputOf<"recurringInvoice.list">;

export type RecurringInvoiceCreateInput = InputOf<"recurringInvoice.create">;

export type RecurringInvoiceExecution = OutputOf<"recurringInvoice.executionHistory">["data"][number];


export type RecurringInvoiceSuggestion = OutputOf<"recurringInvoice.suggestions">[number];

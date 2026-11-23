/**
 * WebMCP exposure catalog — which MCP tools the in-browser agent surface offers.
 *
 * WebMCP (apps/web/src/lib/webmcp) is a CURATED surface, not a mirror of this
 * server: a browser agent runs next to the user's open tab, on their cookie
 * session, so it only gets the tools whose blast radius is acceptable there.
 * This file records the decision for every MCP tool, so the answer to "why is
 * X not in the browser?" is a line of data instead of tribal knowledge, and so
 * CI can fail when the two surfaces drift apart:
 *
 *   - `packages/mcp/src/__tests__/webmcp-catalog.test.ts`  catalog covers TOOL_META exactly
 *   - `apps/web/src/lib/webmcp/__tests__/catalog-contract.test.ts`  every web tool is "exposed" here,
 *      annotations match the tier, write tools declare `requires`
 *   - `scripts/check-parity.ts`  the same two rules, run on every PR
 *
 * Statuses
 *
 *   exposed             implemented in apps/web/src/lib/webmcp/tools today
 *   planned             approved for the browser, not built yet
 *   excluded:<reason>   deliberately NOT offered to a browser agent (the reason is
 *                       a short kebab-case slug; keep it stable, tests and docs show it)
 *
 * Tools that exist only in the browser (no MCP twin) are listed in
 * WEBMCP_BROWSER_ONLY_TOOLS and are the only web tools allowed to be absent
 * from WEBMCP_CATALOG.
 *
 * A tool whose MCP tier is destructive/admin may be "exposed" only in a
 * NARROWED form (e.g. invoice_update_status without 'cancelled'). That has to be
 * declared with `narrowed` — the reason is what makes the exception reviewable,
 * and the web contract test then checks the narrowing really happened.
 *
 * DATA ONLY: no imports, no runtime coupling. The web bundle must never import
 * this file (it would ship 194 names to every browser); tests and scripts load
 * it by path. Keep it free of imports so `node --experimental-strip-types` can
 * load it too.
 */

export type WebMcpExposure = "exposed" | "planned" | `excluded:${string}`;

export interface WebMcpCatalogEntry {
  webmcp: WebMcpExposure;
  /**
   * Exposed only in a narrower form than the MCP tool of the same name. Present
   * when the MCP tier is destructive/admin but the browser variant is not.
   */
  narrowed?: string;
  /**
   * An MCP input the browser tool deliberately does not offer (the tool itself is
   * exposed at the same tier). Documentation with a test behind it: the
   * catalog-contract test checks the browser schema really lacks it.
   */
  omits?: Readonly<Record<string, string>>;
}

/** Tools that exist only in the browser: orientation and navigation, no network. */
export const WEBMCP_BROWSER_ONLY_TOOLS: readonly string[] = ["hisaabo_context", "app_navigate"];

const EXPOSED: WebMcpCatalogEntry = { webmcp: "exposed" };
const PLANNED: WebMcpCatalogEntry = { webmcp: "planned" };

function excluded(reason: string): WebMcpCatalogEntry {
  return { webmcp: `excluded:${reason}` };
}

const DOCUMENT_PREFIXES = ["quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] as const;

/** Returns and debit notes move stock and ledger balances against an earlier document: not offered to an agent yet. */
const CREATES_WITH_SIDE_EFFECTS: ReadonlySet<string> = new Set(["debit_note", "sales_return", "purchase_return"]);

/** list/get are planned for every document type, create for the others; status changes and deletes never are. */
const documentTools: Record<string, WebMcpCatalogEntry> = Object.fromEntries(
  DOCUMENT_PREFIXES.flatMap((p) => [
    [`${p}_list`, PLANNED],
    [`${p}_get`, PLANNED],
    [`${p}_create`, CREATES_WITH_SIDE_EFFECTS.has(p) ? excluded("not-curated") : PLANNED],
    [`${p}_update_status`, excluded("status-change-can-void")],
    [`${p}_delete`, excluded("destructive")],
  ]),
);

export const WEBMCP_CATALOG: Readonly<Record<string, WebMcpCatalogEntry>> = {
  ...documentTools,

  // admin: credentials, sessions, membership — never in a page an agent can drive
  api_key_list: excluded("credentials"),
  api_key_create: excluded("credentials"),
  api_key_revoke: excluded("credentials"),
  session_list: excluded("credentials"),
  session_revoke: excluded("credentials"),
  tenant_members: excluded("team-admin"),
  tenant_invite_member: excluded("team-admin"),
  tenant_remove_member: excluded("team-admin"),
  tenant_update_member_role: excluded("team-admin"),
  tenant_pending_invitations: excluded("team-admin"),
  tenant_revoke_invitation: excluded("team-admin"),

  // automated (recurring) invoices
  automated_invoice_list: excluded("not-curated"),
  automated_invoice_get: excluded("not-curated"),
  automated_invoice_create: excluded("not-curated"),
  automated_invoice_update: excluded("not-curated"),
  automated_invoice_delete: excluded("destructive"),
  automated_invoice_pause: excluded("not-curated"),
  automated_invoice_resume: excluded("not-curated"),
  automated_invoice_run_now: excluded("automation-run"),
  automated_invoice_history: excluded("not-curated"),
  automated_invoice_plan_usage: excluded("not-curated"),
  automated_invoice_suggestions: excluded("not-curated"),

  // bank accounts — list/get return the full account number
  bank_account_list: excluded("returns-full-account-number"),
  bank_account_get: excluded("returns-full-account-number"),
  bank_account_create: excluded("not-curated"),
  bank_account_transfer: excluded("money-transfer"),
  bank_account_transactions: PLANNED,
  bank_account_summary: PLANNED,
  bank_account_gateway_config: excluded("gateway-config"),
  bank_account_update_gateway: excluded("gateway-config"),

  // bank reconciliation
  bank_recon_imports: excluded("not-curated"),
  bank_recon_summary: PLANNED,
  bank_recon_rules: excluded("not-curated"),
  bank_recon_lines: PLANNED,

  // dashboard / audit / system
  dashboard_summary: EXPOSED,
  business_audit_trail: excluded("audit-read"),
  system_maintenance_status: excluded("not-curated"),

  // documents
  document_convert: PLANNED,

  // GST compliance
  einvoice_dashboard: excluded("not-curated"),
  einvoice_generate: excluded("external-filing"),
  einvoice_cancel: excluded("external-filing"),
  einvoice_retry: excluded("external-filing"),
  einvoice_status: PLANNED,
  eway_bill_dashboard: excluded("not-curated"),
  eway_bill_generate: excluded("external-filing"),
  eway_bill_cancel: excluded("external-filing"),
  eway_bill_update_vehicle: excluded("external-filing"),
  eway_bill_expiring: PLANNED,
  gst_report_csv: excluded("file-download"),
  gst_report: PLANNED,
  gst_gstr9: excluded("not-curated"),
  gstr2b_uploads: excluded("not-curated"),
  gstr2b_records: excluded("not-curated"),
  gstr2b_summary: PLANNED,
  gstr2b_missing_in_books: excluded("not-curated"),
  gstr2b_missing_in_2b: excluded("not-curated"),

  // expenses
  expense_create: EXPOSED,
  expense_update: PLANNED,
  expense_delete: excluded("destructive"),
  expense_categories: EXPOSED,
  expense_list: EXPOSED,

  // imports
  import_parties: excluded("bulk-import"),
  import_items: excluded("bulk-import"),
  import_invoices: excluded("bulk-import"),
  import_payments: excluded("bulk-import"),

  // invoices
  invoice_list: EXPOSED,
  invoice_create: {
    webmcp: "exposed",
    omits: {
      updateItemPrices:
        "MCP's update_item_prices also rewrites catalog prices after the invoice saves. The browser confirmation dialog shows one write (the invoice), so a second hidden write would go unconfirmed; the user answers the \"Update saved prices?\" prompt in the invoice form, or an agent calls item_update (planned) and gets its own confirmation.",
    },
  },
  invoice_get: EXPOSED,
  invoice_update: excluded("rewrites-posted-document"),
  invoice_update_status: {
    webmcp: "exposed",
    narrowed: "the MCP tool can void ('cancelled'); the browser tool cannot, so it only moves between non-void statuses",
  },
  invoice_delete: excluded("destructive"),
  invoice_pdf_url: excluded("file-download"),

  // input tax credit
  itc_dashboard: PLANNED,
  itc_ledger: PLANNED,
  itc_aging_alerts: excluded("not-curated"),
  itc_mark_blocked: excluded("tax-classification"),
  itc_mark_eligible: excluded("tax-classification"),
  itc_gstr3b_table4: excluded("not-curated"),

  // items
  item_list: EXPOSED,
  item_create: EXPOSED,
  item_get: EXPOSED,
  item_update: PLANNED,
  item_delete: excluded("destructive"),
  item_adjust_stock: PLANNED,
  item_list_variants: excluded("not-curated"),
  item_create_variant: excluded("not-curated"),
  item_update_variant: excluded("not-curated"),
  item_delete_variant: excluded("destructive"),
  item_merge: excluded("merge"),
  item_switch_base_unit: excluded("rewrites-quantities"),
  item_rename_unit: excluded("not-curated"),
  item_stock_adjustment_history: excluded("not-curated"),
  item_low_stock_count: PLANNED,
  item_price_history: excluded("not-curated"),
  item_price_summary: excluded("not-curated"),
  item_stock_movements: excluded("not-curated"),
  item_stock_summary: PLANNED,

  // journal
  journal_list: excluded("not-curated"),
  journal_get: excluded("not-curated"),
  journal_create: excluded("accounting-posting"),
  journal_void: excluded("void"),
  journal_templates: excluded("not-curated"),

  // parties
  party_list: EXPOSED,
  party_create: EXPOSED,
  party_get: EXPOSED,
  party_update: PLANNED,
  party_delete: excluded("destructive"),
  party_ledger: PLANNED,
  party_ledger_report: excluded("not-curated"),
  party_get_stats: PLANNED,
  party_top_items: PLANNED,
  party_merge: excluded("merge"),

  // payments
  payment_create: EXPOSED,
  payment_get: PLANNED,
  payment_update: excluded("rewrites-money-record"),
  payment_delete: excluded("destructive"),
  payment_list: EXPOSED,
  payment_unpaid_invoices: EXPOSED,
  payment_untracked: excluded("not-curated"),
  payment_default_account: excluded("not-curated"),
  tds_section_list: EXPOSED,

  // reports
  report_daybook: PLANNED,
  report_outstanding: PLANNED,
  report_tax_summary: excluded("not-curated"),
  report_item_sales: PLANNED,
  report_stock_summary: excluded("not-curated"),
  report_party_statement: PLANNED,
  report_payment_summary: excluded("not-curated"),
  report_trial_balance: excluded("not-curated"),
  report_balance_sheet: PLANNED,
  report_profit_and_loss: PLANNED,
  report_cash_flow_statement: excluded("not-curated"),
  report_general_ledger: excluded("not-curated"),
  report_comparative_trial_balance: excluded("not-curated"),
  report_comparative_balance_sheet: excluded("not-curated"),
  report_comparative_profit_and_loss: excluded("not-curated"),

  // shipments
  shipment_list: excluded("not-curated"),
  shipment_get: excluded("not-curated"),
  shipment_create: excluded("not-curated"),
  shipment_update: excluded("not-curated"),
  shipment_delete: excluded("destructive"),

  // online store
  store_settings: excluded("not-curated"),
  store_update_settings: excluded("store-config"),
  store_orders: excluded("not-curated"),
  store_order_get: excluded("not-curated"),
  store_order_update: excluded("not-curated"),
  store_confirm_order: excluded("store-order-decision"),
  store_cancel_order: excluded("store-order-decision"),

  // notifications
  notification_list: excluded("not-curated"),
  notification_unread_counts: excluded("not-curated"),
  notification_mark_read: excluded("not-curated"),
  notification_mark_all_read: excluded("not-curated"),
  notification_preferences_get: excluded("not-curated"),
  notification_preference_update: excluded("not-curated"),

  // targets
  target_list: excluded("not-curated"),
  target_create: excluded("not-curated"),
  target_progress: excluded("not-curated"),
  target_my: excluded("not-curated"),

  // tenants
  tenant_list: excluded("not-curated"),
};

/** Names of every tool with the given status ("excluded" matches any reason). */
export function webmcpToolsWithStatus(status: "exposed" | "planned" | "excluded"): string[] {
  return Object.entries(WEBMCP_CATALOG)
    .filter(([, e]) => (status === "excluded" ? e.webmcp.startsWith("excluded:") : e.webmcp === status))
    .map(([name]) => name);
}

/**
 * Central tier / destructiveness metadata for every MCP tool.
 *
 * A tool cannot be registered without an entry here (see registry.ts), so a
 * new tool is forced to declare how dangerous it is.
 *
 *   read   — queries only; exposed in every mode
 *   write  — creates or updates data; needs mode write or admin
 *   admin  — credentials, sessions, membership; needs mode admin AND HISAABO_MCP_ENABLE_ADMIN=1
 *
 * `destructive` tools (delete / void / cancel / merge / import / filings /
 * money movement) additionally require `confirm: true` on every call.
 * `readOnly` marks admin-tier tools that only read (they stay admin because the
 * data itself is sensitive).
 */

export type ToolTier = "read" | "write" | "admin";

export interface ToolMeta {
  tier: ToolTier;
  destructive: boolean;
  readOnly?: boolean;
}

const R: ToolMeta = { tier: "read", destructive: false };
const W: ToolMeta = { tier: "write", destructive: false };
const D: ToolMeta = { tier: "write", destructive: true };
const AR: ToolMeta = { tier: "admin", destructive: false, readOnly: true };
const AW: ToolMeta = { tier: "admin", destructive: false };
const AD: ToolMeta = { tier: "admin", destructive: true };

const DOCUMENT_PREFIXES = ["quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] as const;

const documentTools: Record<string, ToolMeta> = Object.fromEntries(
  DOCUMENT_PREFIXES.flatMap((p) => [
    [`${p}_list`, R],
    [`${p}_get`, R],
    [`${p}_create`, W],
    [`${p}_update_status`, D],
    [`${p}_delete`, D],
  ]),
);

export const TOOL_META: Readonly<Record<string, ToolMeta>> = {
  ...documentTools,
  // admin
  api_key_list: AR,
  api_key_create: AW,
  api_key_revoke: AD,
  session_list: AR,
  session_revoke: AD,
  tenant_members: AR,
  tenant_invite_member: AW,
  tenant_remove_member: AD,
  tenant_update_member_role: AD,
  tenant_pending_invitations: AR,
  tenant_revoke_invitation: AD,

  // automated invoices
  automated_invoice_list: R,
  automated_invoice_get: R,
  automated_invoice_create: W,
  automated_invoice_update: W,
  automated_invoice_delete: D,
  automated_invoice_pause: W,
  automated_invoice_resume: W,
  automated_invoice_run_now: D,
  automated_invoice_history: R,
  automated_invoice_plan_usage: R,
  automated_invoice_suggestions: R,

  // bank accounts
  bank_account_list: R,
  bank_account_get: R,
  bank_account_create: W,
  bank_account_transfer: D,
  bank_account_transactions: R,
  bank_account_summary: R,
  bank_account_gateway_config: R,
  bank_account_update_gateway: D,

  // bank reconciliation
  bank_recon_imports: R,
  bank_recon_summary: R,
  bank_recon_rules: R,
  bank_recon_lines: R,

  // dashboard / audit / system
  dashboard_summary: R,
  business_audit_trail: R,
  system_maintenance_status: R,

  // documents
  document_convert: W,

  // GST compliance
  einvoice_dashboard: R,
  einvoice_generate: D,
  einvoice_cancel: D,
  einvoice_retry: D,
  einvoice_status: R,
  eway_bill_dashboard: R,
  eway_bill_generate: D,
  eway_bill_cancel: D,
  eway_bill_update_vehicle: D,
  eway_bill_expiring: R,
  gst_report_csv: R,
  gst_report: R,
  gst_gstr9: R,
  gstr2b_uploads: R,
  gstr2b_records: R,
  gstr2b_summary: R,
  gstr2b_missing_in_books: R,
  gstr2b_missing_in_2b: R,

  // expenses
  expense_create: W,
  expense_update: W,
  expense_delete: D,
  expense_categories: R,
  expense_list: R,

  // imports
  import_parties: D,
  import_items: D,
  import_invoices: D,
  import_payments: D,

  // invoices
  invoice_list: R,
  invoice_create: W,
  invoice_get: R,
  invoice_update: D,
  invoice_update_status: D,
  invoice_delete: D,
  invoice_pdf_url: R,

  // input tax credit
  itc_dashboard: R,
  itc_ledger: R,
  itc_aging_alerts: R,
  itc_mark_blocked: W,
  itc_mark_eligible: W,
  itc_gstr3b_table4: R,

  // items
  item_list: R,
  item_create: W,
  item_get: R,
  item_update: W,
  item_delete: D,
  item_adjust_stock: W,
  item_list_variants: R,
  item_create_variant: W,
  item_update_variant: W,
  item_delete_variant: D,
  item_merge: D,
  item_switch_base_unit: D,
  item_rename_unit: W,
  item_stock_adjustment_history: R,
  item_low_stock_count: R,
  item_price_history: R,
  item_price_summary: R,
  item_stock_movements: R,
  item_stock_summary: R,

  // journal
  journal_list: R,
  journal_get: R,
  journal_create: W,
  journal_void: D,
  journal_templates: R,

  // parties
  party_list: R,
  party_create: W,
  party_get: R,
  party_update: W,
  party_delete: D,
  party_ledger: R,
  party_ledger_report: R,
  party_get_stats: R,
  party_top_items: R,
  party_merge: D,

  // payments
  payment_create: W,
  payment_get: R,
  payment_update: D,
  payment_delete: D,
  payment_list: R,
  payment_unpaid_invoices: R,
  payment_untracked: R,
  payment_default_account: R,

  // reports
  report_daybook: R,
  report_outstanding: R,
  report_tax_summary: R,
  report_item_sales: R,
  report_stock_summary: R,
  report_party_statement: R,
  report_payment_summary: R,
  report_trial_balance: R,
  report_balance_sheet: R,
  report_profit_and_loss: R,
  report_cash_flow_statement: R,
  report_general_ledger: R,
  report_comparative_trial_balance: R,
  report_comparative_balance_sheet: R,
  report_comparative_profit_and_loss: R,

  // shipments
  shipment_list: R,
  shipment_get: R,
  shipment_create: W,
  shipment_update: W,
  shipment_delete: D,

  // online store
  store_settings: R,
  store_update_settings: D,
  store_orders: R,
  store_order_get: R,
  store_order_update: W,
  store_confirm_order: D,
  store_cancel_order: D,

  // targets
  target_list: R,
  target_create: W,
  target_progress: R,
  target_my: R,

  // tenants
  tenant_list: R,
};

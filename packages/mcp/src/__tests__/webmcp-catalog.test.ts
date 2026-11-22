import { describe, it, expect } from "vitest";
import { TOOL_META } from "../lib/toolMeta.js";
import {
  WEBMCP_BROWSER_ONLY_TOOLS,
  WEBMCP_CATALOG,
  webmcpToolsWithStatus,
} from "../lib/webmcpCatalog.js";

const names = Object.keys(TOOL_META);

/** The 18 tools the browser offers today (the shared subset of the MCP surface). */
const EXPOSED_TODAY = [
  "dashboard_summary",
  "expense_categories",
  "expense_create",
  "expense_list",
  "invoice_create",
  "invoice_get",
  "invoice_list",
  "invoice_update_status",
  "item_create",
  "item_get",
  "item_list",
  "party_create",
  "party_get",
  "party_list",
  "payment_create",
  "payment_list",
  "payment_unpaid_invoices",
  "tds_section_list",
];

describe("WebMCP exposure catalog", () => {
  it("has an entry for every MCP tool and nothing else", () => {
    expect(Object.keys(WEBMCP_CATALOG).sort()).toEqual([...names].sort());
  });

  it("gives every entry a valid status", () => {
    for (const [name, entry] of Object.entries(WEBMCP_CATALOG)) {
      expect(entry.webmcp, name).toMatch(/^(exposed|planned|excluded:[a-z][a-z0-9-]*)$/);
    }
  });

  it("exposes exactly the 18 shared tools that exist in the browser today", () => {
    expect(webmcpToolsWithStatus("exposed").sort()).toEqual(EXPOSED_TODAY);
  });

  it("keeps browser-only tools out of the MCP namespace", () => {
    for (const browserOnly of WEBMCP_BROWSER_ONLY_TOOLS) {
      expect(names).not.toContain(browserOnly);
      expect(WEBMCP_CATALOG[browserOnly]).toBeUndefined();
    }
  });

  it("never plans or exposes an admin tool", () => {
    for (const name of [...webmcpToolsWithStatus("exposed"), ...webmcpToolsWithStatus("planned")]) {
      expect(TOOL_META[name].tier, name).not.toBe("admin");
    }
  });

  it("never plans a destructive tool, and exposes one only in a declared narrowed form", () => {
    for (const name of webmcpToolsWithStatus("planned")) {
      expect(TOOL_META[name].destructive, name).toBe(false);
    }
    for (const name of webmcpToolsWithStatus("exposed")) {
      const narrowed = WEBMCP_CATALOG[name].narrowed;
      if (TOOL_META[name].destructive) {
        expect(narrowed, `${name} is destructive in MCP, so its browser form must be narrowed`).toBeTruthy();
      } else {
        expect(narrowed, `${name} is not destructive, so nothing needs narrowing`).toBeUndefined();
      }
    }
    expect(Object.keys(WEBMCP_CATALOG).filter((n) => WEBMCP_CATALOG[n].narrowed)).toEqual(["invoice_update_status"]);
  });

  describe("review decisions that must never silently flip", () => {
    const excluded = (name: string) => WEBMCP_CATALOG[name].webmcp.startsWith("excluded:");

    it("excludes credentials, sessions, team and invitation management", () => {
      const sensitive = names.filter((n) => /^(api_key_|session_|tenant_(?!list))/.test(n));
      expect(sensitive.length).toBeGreaterThan(8);
      for (const name of sensitive) expect(excluded(name), name).toBe(true);
    });

    it("excludes every import, delete, merge and void", () => {
      const risky = names.filter((n) => /^import_|_delete$|_merge$|_void$/.test(n));
      expect(risky.length).toBeGreaterThan(15);
      for (const name of risky) expect(excluded(name), name).toBe(true);
    });

    it("excludes gateway config, external filings and money transfers", () => {
      for (const name of [
        "bank_account_gateway_config",
        "bank_account_update_gateway",
        "bank_account_transfer",
        "einvoice_generate",
        "einvoice_cancel",
        "eway_bill_generate",
        "eway_bill_cancel",
        "eway_bill_update_vehicle",
      ]) {
        expect(excluded(name), name).toBe(true);
      }
    });

    it("excludes store order decisions, forced recurring runs, journal posting and ITC reclassification", () => {
      for (const name of [
        "store_confirm_order",
        "store_cancel_order",
        "automated_invoice_run_now",
        "journal_create",
        "itc_mark_eligible",
        "itc_mark_blocked",
      ]) {
        expect(excluded(name), name).toBe(true);
      }
    });

    it("excludes audit reads and anything returning a full bank account number", () => {
      for (const name of ["business_audit_trail", "bank_account_list", "bank_account_get"]) {
        expect(excluded(name), name).toBe(true);
      }
    });

    it("plans the reports, GST and ITC reads, document list/get/create, party analytics, inventory reads and updates", () => {
      const planned = new Set(webmcpToolsWithStatus("planned"));
      for (const name of [
        "report_profit_and_loss",
        "report_outstanding",
        "gst_report",
        "gstr2b_summary",
        "itc_dashboard",
        "quotation_list",
        "credit_note_get",
        "proforma_create",
        "party_ledger",
        "party_get_stats",
        "party_top_items",
        "bank_account_summary",
        "bank_recon_summary",
        "payment_get",
        "item_stock_summary",
        "party_update",
        "item_update",
        "expense_update",
        "item_adjust_stock",
      ]) {
        expect(planned.has(name), name).toBe(true);
      }
    });
  });
});

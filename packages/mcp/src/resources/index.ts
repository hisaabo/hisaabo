/**
 * MCP Resource registrations.
 *
 * Resources are read-only data snapshots that MCP hosts (e.g. Claude Desktop)
 * can load into the agent's context window without the agent explicitly calling
 * a tool. They are fetched on demand, not pushed proactively.
 *
 * Resources registered:
 *   business://current          — Active business profile (name, GSTIN, currency, etc.)
 *   parties://customers         — Top 50 customers by name (for quick lookup)
 *   parties://suppliers         — Top 50 suppliers by name
 *   items://inventory           — All inventory items with current stock
 *   invoices://recent           — Last 10 invoices (quick status overview)
 *   dashboard://summary         — Current FY financial summary
 *
 * Cache guidance:
 *   - business://current: long cache — changes rarely
 *   - parties/*: medium cache — new parties added occasionally
 *   - items://inventory: short cache — stock changes with every invoice
 *   - invoices://recent: short cache — changes with every new invoice
 *   - dashboard://summary: no-cache — changes with every transaction
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";

export function registerResources(server: McpServer, client: HisaaboClient) {

  // ── business://current ──────────────────────────────────────────────────
  // Active business profile. Load this to understand the business context:
  // name, GSTIN, GST registration type, currency, financial year start, etc.
  server.resource(
    "business_current",
    "business://current",
    async (_uri) => {
      const biz = await client.business.get();
      return {
        contents: [{
          uri: "business://current",
          text: JSON.stringify(biz, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ── parties://customers ─────────────────────────────────────────────────
  // Top 50 customers sorted by name. Includes id, name, phone, balance.
  // Useful for seeding context before invoice creation or payment recording.
  server.resource(
    "parties_customers",
    "parties://customers",
    async (_uri) => {
      const result = await client.party.list({
        type: "customer",
        sortBy: "name",
        sortDir: "asc",
        limit: 50,
        page: 1,
      });
      return {
        contents: [{
          uri: "parties://customers",
          text: JSON.stringify(result.data, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ── parties://suppliers ─────────────────────────────────────────────────
  // Top 50 suppliers sorted by name. Includes id, name, phone, balance.
  server.resource(
    "parties_suppliers",
    "parties://suppliers",
    async (_uri) => {
      const result = await client.party.list({
        type: "supplier",
        sortBy: "name",
        sortDir: "asc",
        limit: 50,
        page: 1,
      });
      return {
        contents: [{
          uri: "parties://suppliers",
          text: JSON.stringify(result.data, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ── items://inventory ───────────────────────────────────────────────────
  // Inventory items with current stock. Load this to check what products are
  // available, their prices, and which are low on stock.
  server.resource(
    "items_inventory",
    "items://inventory",
    async (_uri) => {
      // Fetch up to 100 items — for context seeding, not exhaustive listing
      const result = await client.item.list({ limit: 100, page: 1 });
      return {
        contents: [{
          uri: "items://inventory",
          text: JSON.stringify(result.data, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ── invoices://recent ───────────────────────────────────────────────────
  // The 10 most recent sale invoices. Load this for a quick status overview.
  server.resource(
    "invoices_recent",
    "invoices://recent",
    async (_uri) => {
      const result = await client.invoice.list({
        type: "sale",
        limit: 10,
        page: 1,
      });
      return {
        contents: [{
          uri: "invoices://recent",
          text: JSON.stringify(result.data, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );

  // ── dashboard://summary ─────────────────────────────────────────────────
  // Current financial year summary: total sales, receivables, payables, cash.
  // This is the same data as dashboard_summary tool with period='this-fy'.
  server.resource(
    "dashboard_summary",
    "dashboard://summary",
    async (_uri) => {
      // No date range = API defaults to current financial year
      const summary = await client.dashboard.summary();
      return {
        contents: [{
          uri: "dashboard://summary",
          text: JSON.stringify(summary, null, 2),
          mimeType: "application/json",
        }],
      };
    }
  );
}

/**
 * Item (inventory) tools.
 *
 * Tools registered:
 *   item_list          — list/search inventory items
 *   item_create        — create a new product or service item
 *   item_get           — get full item details including variants and stock
 *   item_adjust_stock  — record a stock-in or stock-out adjustment
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

export function registerItemTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "item_list",
    [
      "List inventory items and services for the active business.",
      "The 'stockQuantity' field shows current stock. Items with stock below 'lowStockAlert' are low-stock.",
      "Use low_stock=true to find items that need restocking.",
      "Use this to find item UUIDs before creating invoices (linking item_id speeds up invoice creation and updates stock).",
    ].join(" "),
    {
      search: z.string().max(200).optional()
        .describe("Search by item name, SKU, or HSN code."),
      category: z.string().max(100).optional()
        .describe("Filter by category."),
      item_type: z.enum(["product", "service"]).optional()
        .describe("'product' for physical goods with stock, 'service' for billable services (no stock tracking)."),
      low_stock: z.boolean().optional()
        .describe("If true, return only items where current stock is below the low-stock alert threshold."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.item.list({
        search: input.search,
        category: input.category,
        itemType: input.item_type,
        lowStock: input.low_stock,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result), null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_create",
    [
      "Create a new inventory item or service.",
      "For physical products, set item_type='product' and provide initial stock_quantity.",
      "For billable services (consulting, installation, etc.), set item_type='service' — stock is not tracked.",
      "Monetary values (sale_price, purchase_price) are decimal strings without currency symbols: '250.00' not '₹250'.",
      "Setting low_stock_alert triggers warnings when stock falls below that level.",
    ].join(" "),
    {
      name: z.string().min(1).max(200)
        .describe("Item name as it should appear on invoices."),
      item_type: z.enum(["product", "service"]).default("product")
        .describe("'product' for physical goods, 'service' for services (no stock)."),
      unit: z.enum(["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"]).optional()
        .describe("Unit of measurement. Default 'pcs'. Use 'kg' for weight, 'l' for liquids, etc."),
      sale_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Default selling price per unit as decimal string, e.g. '250.00'."),
      purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Default purchase/cost price per unit as decimal string."),
      tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Default GST/tax rate percentage, e.g. '18.00'. Default '0'."),
      stock_quantity: z.string().regex(/^-?\d+(\.\d{1,3})?$/).optional()
        .describe("Opening stock quantity as decimal string, e.g. '100.000'. Default '0'."),
      low_stock_alert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Alert threshold: warn when stock falls below this quantity."),
      hsn: z.string().max(20).optional()
        .describe("HSN (Harmonized System of Nomenclature) code for GST compliance."),
      sku: z.string().max(50).optional()
        .describe("SKU (Stock Keeping Unit) — your internal product code."),
      description: z.string().max(1000).optional()
        .describe("Internal description (not shown on invoices)."),
      category: z.string().max(100).optional()
        .describe("Category for grouping, e.g. 'Electronics', 'Raw Materials'."),
    },
    wrapTool(async (input) => {
      const item = await client.item.create({
        name: input.name,
        itemType: input.item_type,
        unit: input.unit,
        salePrice: input.sale_price,
        purchasePrice: input.purchase_price,
        taxPercent: input.tax_percent,
        stockQuantity: input.stock_quantity,
        lowStockAlert: input.low_stock_alert,
        hsn: input.hsn,
        sku: input.sku,
        description: input.description,
        category: input.category,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(item, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_get",
    [
      "Get full details of a single inventory item, including current stock quantity and variant information.",
      "Use this to check current stock levels or get the full item spec before creating invoices.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID from item_list."),
    },
    wrapTool(async (input) => {
      const item = await client.item.get(input.item_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(item, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_adjust_stock",
    [
      "Record a manual stock adjustment for an inventory item.",
      "Use a positive adjustment to add stock (e.g. '+50' for stock received) and a negative adjustment to remove stock (e.g. '-5' for damaged goods).",
      "Every adjustment is recorded in the audit log — always provide a reason.",
      "Example: to record receiving 100 units from a supplier, set adjustment='+100' and reason='Stock received from Supplier X'.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID from item_list."),
      adjustment: z.string().regex(/^[+-]?\d+(\.\d{1,3})?$/)
        .describe("Signed quantity change as decimal string. '+50' or '50' to add, '-10' to subtract."),
      reason: z.string().max(500).optional()
        .describe("Reason for the adjustment, e.g. 'Stock received from supplier', 'Damaged goods write-off'."),
    },
    wrapTool(async (input) => {
      const result = await client.item.adjustStock({
        itemId: input.item_id,
        adjustment: input.adjustment,
        reason: input.reason,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}

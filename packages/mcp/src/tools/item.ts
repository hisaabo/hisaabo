/**
 * Item (inventory) tools.
 *
 * Tools registered:
 *   item_list                    — list/search inventory items
 *   item_create                  — create a new product or service item
 *   item_get                     — get full item details including variants and stock
 *   item_adjust_stock            — record a stock-in or stock-out adjustment
 *   item_update                  — update an existing item's details or pricing
 *   item_delete                  — permanently delete an item
 *   item_categories              — list all distinct item categories
 *   item_create_variant          — add a variant to a variant-mode item
 *   item_update_variant          — update an existing item variant
 *   item_delete_variant          — permanently delete a variant
 *   item_list_variants           — list all variants for a variant-mode item
 *   item_merge                   — merge two items into one
 *   item_switch_base_unit        — change the base unit of measure for an item
 *   item_rename_unit             — rename a unit (base or alt) across all invoices
 *   item_stock_adjustment_history — view the audit log of stock adjustments
 *   item_low_stock_count         — count items below their low-stock alert threshold
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
    "item_update",
    [
      "Update an existing inventory item's details, pricing, or stock settings.",
      "Only provide fields you want to change — all other fields remain unchanged.",
      "Changing sale_price or purchase_price updates the default price for future invoices but does not retroactively change past invoice line items.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID to update."),
      name: z.string().min(1).max(200).optional()
        .describe("Updated item name."),
      sale_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated selling price per unit as decimal string."),
      purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated purchase/cost price per unit as decimal string."),
      tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated GST/tax rate percentage, e.g. '18.00'."),
      low_stock_alert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Updated low-stock alert threshold."),
      hsn: z.string().max(20).optional()
        .describe("Updated HSN code."),
      sku: z.string().max(50).optional()
        .describe("Updated SKU."),
      description: z.string().max(1000).optional()
        .describe("Updated internal description."),
      category: z.string().max(100).optional()
        .describe("Updated category."),
    },
    wrapTool(async (input) => {
      const { item_id, ...fields } = input;
      const item = await client.item.update(item_id, {
        name: fields.name,
        salePrice: fields.sale_price,
        purchasePrice: fields.purchase_price,
        taxPercent: fields.tax_percent,
        lowStockAlert: fields.low_stock_alert,
        hsn: fields.hsn,
        sku: fields.sku,
        description: fields.description,
        category: fields.category,
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
    "item_delete",
    [
      "Permanently delete an inventory item. Requires admin role.",
      "Warning: this is a hard delete — it removes the item record and its variants.",
      "Existing invoice line items that reference this item are not deleted (they retain the data at time of invoicing).",
      "Only delete if the item was created in error. For discontinued items, consider just setting them inactive.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.item.delete(input.item_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_categories",
    [
      "Get a list of all distinct item categories used in the business.",
      "Use this to discover valid category names before filtering item_list by category or creating items.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const categories = await client.item.categories();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(categories, null, 2),
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

  server.tool(
    "item_list_variants",
    [
      "List all variants for a variant-mode inventory item.",
      "Each variant has its own attribute values (e.g. size, color), SKU, prices, and stock quantity.",
      "The item must be in 'variants' mode (itemMode='variants') for this to return data.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID of the parent variant-mode item."),
    },
    wrapTool(async (input) => {
      const result = await client.item.listVariants(input.item_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_create_variant",
    [
      "Add a new variant to a variant-mode inventory item.",
      "The parent item must already be in 'variants' mode (itemMode='variants').",
      "Attribute values define what makes this variant distinct, e.g. { size: 'L', color: 'Red' }.",
      "Each variant can have its own price and stock quantity.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("UUID of the parent item (must be in variants mode)."),
      attribute_values: z.record(z.string())
        .describe("Key-value pairs defining the variant attributes, e.g. { size: 'L', color: 'Red' }."),
      sku: z.string().max(50).optional()
        .describe("Variant-specific SKU code."),
      sale_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Variant selling price as decimal string."),
      purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Variant purchase/cost price as decimal string."),
      stock_quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Opening stock quantity for this variant as decimal string. Default '0'."),
      low_stock_alert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Low stock alert threshold for this variant."),
    },
    wrapTool(async (input) => {
      const result = await client.item.createVariant(input.item_id, {
        attributeValues: input.attribute_values,
        sku: input.sku,
        salePrice: input.sale_price,
        purchasePrice: input.purchase_price,
        stockQuantity: input.stock_quantity,
        lowStockAlert: input.low_stock_alert,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_update_variant",
    [
      "Update an existing item variant's price, stock, or attributes.",
      "Only provide fields you want to change — all others remain unchanged.",
    ].join(" "),
    {
      variant_id: z.string().uuid()
        .describe("Variant UUID from item_list_variants."),
      attribute_values: z.record(z.string()).optional()
        .describe("Updated attribute key-value pairs."),
      sku: z.string().max(50).optional()
        .describe("Updated variant SKU."),
      sale_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated selling price as decimal string."),
      purchase_price: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated purchase price as decimal string."),
      stock_quantity: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Updated stock quantity as decimal string."),
      low_stock_alert: z.string().regex(/^\d+(\.\d{1,3})?$/).optional()
        .describe("Updated low stock alert threshold."),
    },
    wrapTool(async (input) => {
      const { variant_id, ...fields } = input;
      const result = await client.item.updateVariant(variant_id, {
        attributeValues: fields.attribute_values,
        sku: fields.sku,
        salePrice: fields.sale_price,
        purchasePrice: fields.purchase_price,
        stockQuantity: fields.stock_quantity,
        lowStockAlert: fields.low_stock_alert,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_delete_variant",
    [
      "Permanently delete an item variant. Requires admin role.",
      "Warning: this is a hard delete. Existing invoice line items that referenced this variant retain their data.",
      "Only delete if the variant was created in error.",
    ].join(" "),
    {
      variant_id: z.string().uuid()
        .describe("Variant UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.item.deleteVariant(input.variant_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_merge",
    [
      "Merge two inventory items — moves all invoice history from the source item to the target, then deletes the source.",
      "Cannot merge variant-mode items. Both items must be simple or alt-unit items.",
      "Stock is converted using stock_conversion_factor: if 1 source unit = 2 target units, set stock_conversion_factor=2.",
      "Use this to consolidate duplicate items. Requires admin role.",
    ].join(" "),
    {
      source_id: z.string().uuid()
        .describe("UUID of the item to merge FROM (will be deleted after merging)."),
      target_id: z.string().uuid()
        .describe("UUID of the item to merge INTO (will be kept)."),
      stock_conversion_factor: z.number().positive().default(1)
        .describe("How many target units equal 1 source unit. Default 1 (same unit). Example: if merging 'half-kg sugar' into 'kg sugar', use 0.5."),
    },
    wrapTool(async (input) => {
      const result = await client.item.merge(input.source_id, input.target_id, input.stock_conversion_factor);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_switch_base_unit",
    [
      "Change the base unit of measure for an item (e.g. switch from 'kg' to 'g').",
      "Converts existing stock and prices using the conversion factor provided.",
      "The old base unit is added to the item's alt-unit variants automatically.",
      "Cannot be used on variant-mode items.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID to update."),
      new_unit: z.string().min(1)
        .describe("The new base unit, e.g. 'g', 'ml', 'pcs'."),
      conversion_factor: z.number().positive()
        .describe("How many NEW units equal 1 OLD unit. E.g. switching kg → g: conversion_factor=1000."),
    },
    wrapTool(async (input) => {
      const result = await client.item.switchBaseUnit(input.item_id, input.new_unit, input.conversion_factor);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_rename_unit",
    [
      "Rename a unit (base or alt unit) for an item, cascading the rename across all linked invoice line items.",
      "Use this to correct typos in unit names, e.g. rename 'Kgs' to 'kg'.",
      "Requires admin role.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID whose unit to rename."),
      old_unit: z.string().min(1)
        .describe("The current unit name to rename from."),
      new_unit: z.string().min(1)
        .describe("The new unit name to rename to."),
    },
    wrapTool(async (input) => {
      const result = await client.item.renameUnit(input.item_id, input.old_unit, input.new_unit);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_stock_adjustment_history",
    [
      "View the audit log of manual stock adjustments for an inventory item.",
      "Each entry shows the adjustment quantity, reason, user, and timestamp.",
      "Optionally filter by variant UUID for variant-mode items.",
    ].join(" "),
    {
      item_id: z.string().uuid()
        .describe("Item UUID to view stock adjustments for."),
      variant_id: z.string().uuid().optional()
        .describe("Filter adjustments for a specific variant UUID (for variant-mode items)."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.item.stockAdjustmentHistory({
        itemId: input.item_id,
        variantId: input.variant_id,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result as any), null, 2),
        }],
      };
    })
  );

  server.tool(
    "item_low_stock_count",
    [
      "Get the total count of items (and variants) that are below their low-stock alert threshold.",
      "Use this as a quick dashboard metric to know if restocking is needed.",
      "For the full list of low-stock items, use item_list with low_stock=true.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const count = await client.item.lowStockCount();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ lowStockCount: count }, null, 2),
        }],
      };
    })
  );
}

/**
 * Online store tools — manage the business's public storefront.
 *
 * Tools registered:
 *   store_settings        — get current store configuration
 *   store_update_settings — update store configuration
 *   store_orders          — list customer orders from the store
 *   store_order_get       — get full details of a store order
 *   store_order_update    — update order status (preparing/ready/delivered)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"] as const;

export function registerStoreTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "store_settings",
    [
      "Get the current online store configuration for the active business.",
      "Returns whether the store is enabled, the store URL slug, tagline, accent color, minimum order amount, and order prefix.",
      "If storeEnabled=false, the public store is not accessible.",
      "The store URL is: https://<storeSlug>.hisaabo.in (when enabled).",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const settings = await client.store.getSettings();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(settings, null, 2),
        }],
      };
    })
  );

  server.tool(
    "store_update_settings",
    [
      "Update the online store configuration.",
      "Enable/disable the store, change the URL slug, tagline, accent color, minimum order amount, etc.",
      "store_slug must be unique across all businesses and match the pattern: lowercase letters, numbers, and hyphens.",
      "Setting store_enabled=true activates the public storefront.",
    ].join(" "),
    {
      store_enabled: z.boolean().optional()
        .describe("Enable (true) or disable (false) the public storefront."),
      store_slug: z.string().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/).optional().nullable()
        .describe("URL slug for the store, e.g. 'acme-traders'. Must be lowercase alphanumeric with hyphens."),
      store_tagline: z.string().max(200).optional().nullable()
        .describe("Short tagline shown on the store homepage, e.g. 'Fresh groceries delivered daily'."),
      store_accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable()
        .describe("Brand accent color as hex code, e.g. '#FF5722'."),
      store_min_order_amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable()
        .describe("Minimum order value as decimal string, e.g. '200.00'. Null to remove minimum."),
      store_delivery_note: z.string().max(500).optional().nullable()
        .describe("Note shown at checkout about delivery, e.g. 'Delivery within 2 hours in city limits'."),
      store_whatsapp_number: z.string().max(15).optional().nullable()
        .describe("WhatsApp number for order notifications (digits only)."),
      store_allow_negative_stock: z.boolean().optional()
        .describe("If true, orders can be placed even when stock is zero or negative."),
      store_order_prefix: z.string().min(1).max(10).optional()
        .describe("Prefix for store order numbers, e.g. 'ORD'. Default 'ORD'."),
    },
    wrapTool(async (input) => {
      const settings = await client.store.updateSettings({
        storeEnabled: input.store_enabled,
        storeSlug: input.store_slug,
        storeTagline: input.store_tagline,
        storeAccentColor: input.store_accent_color,
        storeMinOrderAmount: input.store_min_order_amount,
        storeDeliveryNote: input.store_delivery_note,
        storeWhatsappNumber: input.store_whatsapp_number,
        storeAllowNegativeStock: input.store_allow_negative_stock,
        storeOrderPrefix: input.store_order_prefix,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(settings, null, 2),
        }],
      };
    })
  );

  server.tool(
    "store_orders",
    [
      "List customer orders placed through the online store.",
      "Orders progress through statuses: pending → confirmed → preparing → ready → delivered.",
      "Use status='pending' to find new orders requiring attention.",
      "Search by customer name, phone number, or order number.",
    ].join(" "),
    {
      status: z.enum(ORDER_STATUSES).optional()
        .describe("Filter by order status. 'pending' = new orders awaiting confirmation."),
      from_date: z.string().datetime().optional()
        .describe("Filter orders placed on or after this date (ISO 8601)."),
      to_date: z.string().datetime().optional()
        .describe("Filter orders placed on or before this date (ISO 8601)."),
      search: z.string().max(200).optional()
        .describe("Search by customer name, phone number, or order number."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.store.listOrders({
        status: input.status,
        fromDate: input.from_date,
        toDate: input.to_date,
        search: input.search,
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
    "store_order_get",
    [
      "Get full details of a single store order, including line items and linked invoice.",
      "If the order has been confirmed, it will have a linked invoice (invoiceId) in the response.",
    ].join(" "),
    {
      order_id: z.string().uuid()
        .describe("Store order UUID from store_orders."),
    },
    wrapTool(async (input) => {
      const order = await client.store.getOrder(input.order_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(order, null, 2),
        }],
      };
    })
  );

  server.tool(
    "store_order_update",
    [
      "Update a confirmed store order's status to 'preparing', 'ready', or 'delivered'.",
      "Orders must be confirmed first (status='confirmed') before they can be updated.",
      "Use 'preparing' when the order is being packed, 'ready' when ready for pickup/delivery, 'delivered' when handed to customer.",
      "To confirm a pending order or cancel an order, use the Hisaabo web app — those actions also update the linked invoice.",
    ].join(" "),
    {
      order_id: z.string().uuid()
        .describe("Store order UUID."),
      status: z.enum(["preparing", "ready", "delivered"])
        .describe("New status: 'preparing' (being packed), 'ready' (ready to deliver), 'delivered' (handed to customer)."),
    },
    wrapTool(async (input) => {
      const result = await client.store.updateOrderStatus({
        orderId: input.order_id,
        status: input.status,
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

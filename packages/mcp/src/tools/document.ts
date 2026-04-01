/**
 * Document tools — manage non-invoice business documents.
 *
 * Covers document conversion plus per-type CRUD for:
 *   quotation, credit_note, debit_note, delivery_challan,
 *   proforma, sales_return, purchase_return
 *
 * Tools registered:
 *   document_convert         — convert a document to another type (e.g. quotation → invoice)
 *   quotation_list/create/get/update_status/delete
 *   credit_note_list/create/get/update_status/delete
 *   debit_note_list/create/get/update_status/delete
 *   delivery_challan_list/create/get/update_status/delete
 *   proforma_list/create/get/update_status/delete
 *   sales_return_list/create/get/update_status/delete
 *   purchase_return_list/create/get/update_status/delete
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const DOCUMENT_TYPES = [
  "quotation", "credit_note", "debit_note", "delivery_challan",
  "proforma", "sales_return", "purchase_return",
] as const;

// Shared line item schema reused across create tools
const lineItemSchema = z.object({
  description: z.string().min(1).max(500)
    .describe("Product or service name/description."),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/)
    .describe("Quantity as decimal string, e.g. '1.000'."),
  unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/)
    .describe("Price per unit as decimal string, e.g. '250.00'."),
  tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0")
    .describe("GST/tax rate percentage, e.g. '18.00'."),
  discount_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0")
    .describe("Line-level discount percentage."),
  item_id: z.string().uuid().optional()
    .describe("Link to an inventory item UUID (optional)."),
});

// Shared list input schema
const listInput = {
  type: z.enum(["sale", "purchase"]).optional()
    .describe("'sale' for customer documents, 'purchase' for supplier documents."),
  status: z.string().optional()
    .describe("Filter by status: 'draft', 'sent', 'cancelled', etc."),
  party_id: z.string().uuid().optional()
    .describe("Filter by customer or supplier UUID."),
  from_date: z.string().datetime().optional()
    .describe("Start of date range (ISO 8601)."),
  to_date: z.string().datetime().optional()
    .describe("End of date range (ISO 8601)."),
  search: z.string().max(200).optional()
    .describe("Search by document number or party name."),
  page: z.number().int().min(1).default(1)
    .describe("Page number for pagination."),
};

// Shared create input schema
const createInput = {
  party_id: z.string().uuid()
    .describe("UUID of the customer or supplier."),
  type: z.enum(["sale", "purchase"])
    .describe("'sale' for customer documents, 'purchase' for supplier documents."),
  line_items: z.array(lineItemSchema).min(1)
    .describe("At least one line item is required."),
  document_date: z.string().datetime().optional()
    .describe("Document date (ISO 8601). Defaults to today."),
  due_date: z.string().datetime().optional()
    .describe("Expiry or due date (ISO 8601)."),
  notes: z.string().max(2000).optional()
    .describe("Notes printed on the document."),
  terms_and_conditions: z.string().max(2000).optional()
    .describe("Terms and conditions text."),
  reference_document_id: z.string().uuid().optional()
    .describe("Source document UUID (e.g. quotation being converted)."),
};

type DocumentNs = "quotation" | "creditNote" | "debitNote" | "deliveryChallan" | "proforma" | "salesReturn" | "purchaseReturn";

function mapLineItems(lineItems: Array<{
  description: string;
  quantity: string;
  unit_price: string;
  tax_percent: string;
  discount_percent: string;
  item_id?: string;
}>) {
  return lineItems.map((li) => ({
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unit_price,
    taxPercent: li.tax_percent,
    discountPercent: li.discount_percent,
    itemId: li.item_id,
  }));
}

function registerDocTypeTools(
  server: McpServer,
  client: HisaaboClient,
  docType: string,
  nsKey: DocumentNs,
  label: string,
  allowedStatuses: string[],
) {
  const prefix = docType;

  server.tool(
    `${prefix}_list`,
    `List ${label} documents for the active business. Supports filtering by party, date range, and status.`,
    listInput,
    wrapTool(async (input) => {
      const result = await (client[nsKey] as any).list({
        type: input.type,
        status: input.status,
        partyId: input.party_id,
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
    `${prefix}_get`,
    `Get the full details of a single ${label}, including all line items.`,
    {
      document_id: z.string().uuid()
        .describe(`${label} UUID from ${prefix}_list.`),
    },
    wrapTool(async (input) => {
      const result = await (client[nsKey] as any).getById(input.document_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    `${prefix}_create`,
    [
      `Create a new ${label}.`,
      "Monetary values are decimal strings, e.g. '1500.00' not 1500.",
      "Set reference_document_id when creating from a converted source document.",
    ].join(" "),
    createInput,
    wrapTool(async (input) => {
      const result = await (client[nsKey] as any).create({
        partyId: input.party_id,
        type: input.type,
        invoiceDate: input.document_date,
        dueDate: input.due_date,
        notes: input.notes,
        termsAndConditions: input.terms_and_conditions,
        referenceDocumentId: input.reference_document_id,
        lineItems: mapLineItems(input.line_items),
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
    `${prefix}_update_status`,
    `Update the status of a ${label}. Allowed statuses: ${allowedStatuses.join(", ")}.`,
    {
      document_id: z.string().uuid()
        .describe(`${label} UUID.`),
      status: z.enum(allowedStatuses as [string, ...string[]])
        .describe(`New status. Allowed: ${allowedStatuses.join(", ")}.`),
    },
    wrapTool(async (input) => {
      const result = await (client[nsKey] as any).updateStatus(input.document_id, input.status);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    `${prefix}_delete`,
    [
      `Soft-delete a ${label}. Requires admin role.`,
      "The document is hidden from lists but not physically removed.",
    ].join(" "),
    {
      document_id: z.string().uuid()
        .describe(`${label} UUID to delete.`),
    },
    wrapTool(async (input) => {
      const result = await (client[nsKey] as any).delete(input.document_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}

export function registerDocumentTools(server: McpServer, client: HisaaboClient) {

  // ── document_convert ─────────────────────────────────────────

  server.tool(
    "document_convert",
    [
      "Convert a document to a different type — for example, a quotation to an invoice, or a proforma to a delivery challan.",
      "Copies all line items from the source document and creates a new linked document.",
      "The original document is not modified. The new document references the source via referenceDocumentId.",
      "Common flows: quotation → invoice, proforma → invoice, delivery_challan → invoice.",
    ].join(" "),
    {
      source_id: z.string().uuid()
        .describe("UUID of the source document to convert from (e.g. quotation UUID)."),
      target_type: z.enum(DOCUMENT_TYPES)
        .describe("Document type to convert to: 'quotation', 'credit_note', 'debit_note', 'delivery_challan', 'proforma', 'sales_return', or 'purchase_return'."),
    },
    wrapTool(async (input) => {
      const result = await client.document.convert({
        sourceId: input.source_id,
        targetType: input.target_type as any,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  // ── Per-document-type CRUD ───────────────────────────────────

  registerDocTypeTools(server, client, "quotation", "quotation", "Quotation", ["draft", "sent", "cancelled"]);
  registerDocTypeTools(server, client, "credit_note", "creditNote", "Credit Note", ["draft", "sent", "paid", "cancelled"]);
  registerDocTypeTools(server, client, "debit_note", "debitNote", "Debit Note", ["draft", "sent", "paid", "cancelled"]);
  registerDocTypeTools(server, client, "delivery_challan", "deliveryChallan", "Delivery Challan", ["draft", "sent", "cancelled"]);
  registerDocTypeTools(server, client, "proforma", "proforma", "Proforma Invoice", ["draft", "sent", "cancelled"]);
  registerDocTypeTools(server, client, "sales_return", "salesReturn", "Sales Return", ["draft", "sent", "cancelled"]);
  registerDocTypeTools(server, client, "purchase_return", "purchaseReturn", "Purchase Return", ["draft", "sent", "cancelled"]);
}

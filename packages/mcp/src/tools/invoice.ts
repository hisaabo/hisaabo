/**
 * Invoice tools — the core of Hisaabo's invoicing workflow.
 *
 * Tools registered:
 *   invoice_list          — search and filter invoices with pagination
 *   invoice_create        — create a new sale invoice or purchase bill
 *   invoice_get           — fetch full invoice details (line items, payments, balance)
 *   invoice_update_status — change invoice status (mark sent, cancel, etc.)
 *   invoice_pdf_url       — get a URL to download/view the PDF (A4 or thermal)
 *   invoice_delete        — soft-delete an invoice (admin or seller_manager within 2 hours)
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const INVOICE_STATUS = ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"] as const;
const DOCUMENT_TYPE = ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] as const;

export function registerInvoiceTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "invoice_list",
    [
      "List invoices for the active business. Returns up to 25 invoices per page with pagination metadata.",
      "Use `page` to fetch subsequent pages when `hasMore` is true in the response.",
      "Example: to find all unpaid invoices from a customer, set status='sent' or status='partial' and party_id=<uuid>.",
      "To find overdue invoices across all customers, set status='overdue'.",
    ].join(" "),
    {
      type: z.enum(["sale", "purchase"]).optional()
        .describe("sale = customer invoices, purchase = supplier bills. Omit to return both."),
      document_type: z.enum(DOCUMENT_TYPE).optional()
        .describe("Filter by document type (default: invoice). Use 'quotation' for quotes, 'credit_note' for credits."),
      status: z.enum(INVOICE_STATUS).optional()
        .describe("Filter by status. Common values: 'sent' (awaiting payment), 'paid', 'overdue', 'draft'."),
      party_id: z.string().uuid().optional()
        .describe("UUID of a specific customer or supplier to filter by."),
      from_date: z.string().datetime().optional()
        .describe("Start of invoice date range (ISO 8601, e.g. '2024-04-01T00:00:00Z')."),
      to_date: z.string().datetime().optional()
        .describe("End of invoice date range (ISO 8601)."),
      search: z.string().max(200).optional()
        .describe("Search by invoice number or party name (partial match)."),
      sort_by: z.enum(["date", "amount", "number"]).optional()
        .describe("Sort field. Defaults to date descending."),
      sort_dir: z.enum(["asc", "desc"]).optional()
        .describe("Sort direction. Defaults to desc."),
      page: z.number().int().min(1).default(1)
        .describe("Page number (1-indexed). Use with hasMore in the response to paginate."),
    },
    wrapTool(async (input) => {
      const result = await client.invoice.list({
        type: input.type,
        documentType: input.document_type,
        status: input.status,
        partyId: input.party_id,
        fromDate: input.from_date,
        toDate: input.to_date,
        search: input.search,
        sortBy: input.sort_by,
        sortDir: input.sort_dir,
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
    "invoice_create",
    [
      "Create a new invoice or bill for the active business. Returns the created invoice with its assigned invoice number.",
      "For sale invoices (customer billing), set type='sale'. For purchase bills (supplier invoices), set type='purchase'.",
      "Each line item requires a description, quantity (decimal string), and unit_price (decimal string, no currency symbol).",
      "Monetary values are always decimal strings, e.g. '1500.00' not 1500.",
      "If a line item corresponds to an inventory item, set item_id to link it and update stock automatically.",
      "Example: { party_id: 'uuid', type: 'sale', line_items: [{ description: 'Web Design', quantity: '1.00', unit_price: '15000.00', tax_percent: '18.00' }] }",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("UUID of the customer (for sales) or supplier (for purchases). Use party_list to find UUIDs."),
      type: z.enum(["sale", "purchase"])
        .describe("'sale' for customer invoices (money coming in), 'purchase' for supplier bills (money going out)."),
      document_type: z.enum(DOCUMENT_TYPE).optional()
        .describe("Document type (default: 'invoice'). Use 'quotation' to create a quote instead of an invoice."),
      line_items: z.array(z.object({
        description: z.string().min(1).max(500)
          .describe("Product or service name/description."),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/)
          .describe("Quantity as decimal string, e.g. '1.000', '7.500', '100'."),
        unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/)
          .describe("Price per unit as decimal string, e.g. '250.00', '15000.00'."),
        tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0")
          .describe("GST/tax rate percentage as decimal string: '0', '5.00', '12.00', '18.00', '28.00'."),
        discount_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).default("0")
          .describe("Line-level discount percentage, e.g. '10.00' for 10% off."),
        item_id: z.string().uuid().optional()
          .describe("Link to an inventory item UUID to auto-fill price and update stock (optional)."),
      })).min(1)
        .describe("At least one line item is required."),
      invoice_date: z.string().datetime().optional()
        .describe("Invoice date (ISO 8601). Defaults to today if omitted."),
      due_date: z.string().datetime().optional()
        .describe("Payment due date (ISO 8601). Set to enforce credit terms."),
      notes: z.string().max(2000).optional()
        .describe("Notes visible on the printed invoice, e.g. bank account details or thank-you message."),
      terms_and_conditions: z.string().max(2000).optional()
        .describe("Terms and conditions text printed on the invoice."),
      invoice_discount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Invoice-level discount. Interpretation depends on invoice_discount_type."),
      invoice_discount_type: z.enum(["amount", "percent"]).optional()
        .describe("Whether invoice_discount is a flat amount or percentage (default: 'amount')."),
      round_off: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional()
        .describe("Round-off adjustment for the total, e.g. '0.50' or '-0.25' (typically small). Default '0'."),
      reference_document_id: z.string().uuid().optional()
        .describe("UUID of a source document (e.g. quotation UUID when converting quote to invoice)."),
    },
    wrapTool(async (input) => {
      const invoice = await client.invoice.create({
        partyId: input.party_id,
        type: input.type,
        documentType: input.document_type,
        invoiceDate: input.invoice_date,
        dueDate: input.due_date,
        notes: input.notes,
        termsAndConditions: input.terms_and_conditions,
        invoiceDiscount: input.invoice_discount,
        invoiceDiscountType: input.invoice_discount_type,
        roundOff: input.round_off,
        referenceDocumentId: input.reference_document_id,
        lineItems: input.line_items.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unitPrice: li.unit_price,
          taxPercent: li.tax_percent,
          discountPercent: li.discount_percent,
          itemId: li.item_id,
        })),
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(invoice, null, 2),
        }],
      };
    })
  );

  server.tool(
    "invoice_get",
    [
      "Get the full details of a single invoice, including all line items, payment history, and outstanding balance.",
      "Use this after invoice_list to get complete details. The 'balanceDue' field shows how much is still owed.",
      "Payments already applied to this invoice appear in the response.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID from invoice_list or invoice_create."),
    },
    wrapTool(async (input) => {
      const invoice = await client.invoice.get(input.invoice_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(invoice, null, 2),
        }],
      };
    })
  );

  server.tool(
    "invoice_update_status",
    [
      "Change the status of an invoice.",
      "Typical workflow: create (draft) → mark sent → payment received (handled by payment_create, which auto-updates status to 'paid' or 'partial').",
      "Use this tool to manually set status to 'sent' (invoice delivered), 'cancelled' (void the invoice), or 'overdue' (mark past due).",
      "Note: 'paid' and 'partial' status is normally set automatically when payments are recorded — prefer payment_create over forcing 'paid' here.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID."),
      status: z.enum(INVOICE_STATUS)
        .describe("New status. 'sent' = delivered to customer. 'cancelled' = voided. 'draft' = revert to draft."),
    },
    wrapTool(async (input) => {
      const result = await client.invoice.updateStatus(input.invoice_id, input.status);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "invoice_delete",
    [
      "Soft-delete an invoice (marks it as cancelled and hides it from lists).",
      "Admins can delete any invoice. Seller managers can only delete unpaid invoices created within the last 2 hours.",
      "Paid invoices cannot be deleted — void them by recording a credit note instead.",
      "This is a soft delete — the invoice is not physically removed from the database.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.invoice.delete(input.invoice_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "invoice_pdf_url",
    [
      "Get the URL to download or view an invoice as a PDF.",
      "The URL requires the HISAABO_TOKEN for authentication (pass as a Bearer token).",
      "Use format='a4' for standard invoices and format='thermal' for 80mm receipt printing.",
      "The URL is valid for as long as the session token is valid.",
    ].join(" "),
    {
      invoice_id: z.string().uuid()
        .describe("Invoice UUID."),
      format: z.enum(["a4", "thermal"]).default("a4")
        .describe("'a4' for standard A4 invoice PDF, 'thermal' for 80mm thermal receipt."),
    },
    wrapTool(async (input) => {
      // The PDF endpoint is a Hono route, not tRPC — return the URL for the caller to use
      const url = `${client.apiUrl}/api/invoice/${input.invoice_id}/pdf?format=${input.format}`;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            url,
            note: "Fetch this URL with the Authorization: Bearer <HISAABO_TOKEN> header to download the PDF.",
            format: input.format,
          }, null, 2),
        }],
      };
    })
  );
}

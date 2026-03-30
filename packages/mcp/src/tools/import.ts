/**
 * Data import tools — batch import parties, items, invoices, and payments.
 *
 * Tools registered:
 *   import_parties  — batch import customers and suppliers
 *   import_items    — batch import inventory items
 *   import_invoices — batch import historical invoices with line items
 *   import_payments — batch import payment records
 *
 * All import operations require admin role. Duplicate records (matched by
 * name or invoice number) are skipped, never overwritten.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerImportTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "import_parties",
    [
      "Batch import customers and/or suppliers. Requires admin role.",
      "Duplicates (same name, case-insensitive) are automatically skipped — never overwritten.",
      "Returns a summary: created (new records), skipped (duplicates), total (input count).",
      "Use source to tag where the data came from, e.g. 'mybillbook', 'tally', 'excel'.",
    ].join(" "),
    {
      source: z.string().default("excel")
        .describe("Source system name, e.g. 'mybillbook', 'tally', 'excel'. Used for audit trail."),
      parties: z.array(z.object({
        name: z.string().min(1).max(200)
          .describe("Party name. Duplicate names (case-insensitive) are skipped."),
        type: z.enum(["customer", "supplier"]).default("customer")
          .describe("'customer' for buyers, 'supplier' for sellers."),
        phone: z.string().max(15).optional()
          .describe("Phone number."),
        email: z.string().optional()
          .describe("Email address."),
        gstin: z.string().optional()
          .describe("GST Identification Number (15 chars)."),
        pan: z.string().optional()
          .describe("PAN number."),
        opening_balance: z.string().optional()
          .describe("Opening balance as decimal string. Positive = they owe you. Default '0'."),
        billing_address: z.string().optional()
          .describe("Billing address."),
        shipping_address: z.string().optional()
          .describe("Shipping address (if different from billing)."),
        city: z.string().optional()
          .describe("City."),
        state: z.string().optional()
          .describe("State name."),
        pincode: z.string().optional()
          .describe("PIN code."),
      })).min(1).max(5000)
        .describe("Array of party records to import. Max 5000 per call."),
    },
    wrapTool(async (input) => {
      const result = await client.import.importParties({
        source: input.source,
        parties: input.parties.map((p) => ({
          name: p.name,
          type: p.type,
          phone: p.phone,
          email: p.email,
          gstin: p.gstin,
          pan: p.pan,
          openingBalance: p.opening_balance,
          billingAddress: p.billing_address,
          shippingAddress: p.shipping_address,
          city: p.city,
          state: p.state,
          pincode: p.pincode,
        })),
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
    "import_items",
    [
      "Batch import inventory items or services. Requires admin role.",
      "Duplicates (same name, case-insensitive) are automatically skipped.",
      "Returns: created, skipped, total, and unmappedUnits (unit codes that were not recognized and defaulted to 'other').",
      "Common unit codes are auto-mapped: KGS→kg, PCS→pcs, LTR→l, BOX→box, etc.",
      "Stock quantity is always set to 0 on import — use import_invoices or item_adjust_stock to build stock from history.",
    ].join(" "),
    {
      source: z.string().default("excel")
        .describe("Source system name for audit trail."),
      items: z.array(z.object({
        name: z.string().min(1).max(200)
          .describe("Item name. Duplicates (case-insensitive) are skipped."),
        item_type: z.enum(["product", "service"]).default("product")
          .describe("'product' for physical goods, 'service' for services."),
        sale_price: z.string().optional()
          .describe("Default selling price as decimal string."),
        purchase_price: z.string().optional()
          .describe("Default purchase price as decimal string."),
        tax_percent: z.string().default("0")
          .describe("GST rate percentage, e.g. '18'. Default '0'."),
        hsn: z.string().optional()
          .describe("HSN code for GST compliance."),
        unit: z.string().default("pcs")
          .describe("Unit code. Common values: pcs, kg, l, box, m. Auto-mapped from MyBillBook/Tally format."),
        sku: z.string().optional()
          .describe("SKU / product code."),
        category: z.string().optional()
          .describe("Category name for grouping."),
      })).min(1).max(5000)
        .describe("Array of item records to import. Max 5000 per call."),
    },
    wrapTool(async (input) => {
      const result = await client.import.importItems({
        source: input.source,
        items: input.items.map((item) => ({
          name: item.name,
          itemType: item.item_type,
          salePrice: item.sale_price,
          purchasePrice: item.purchase_price,
          taxPercent: item.tax_percent,
          hsn: item.hsn,
          unit: item.unit,
          sku: item.sku,
          category: item.category,
        })),
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
    "import_invoices",
    [
      "Batch import historical invoices with optional line items. Requires admin role.",
      "Parties referenced by party_name must already exist (import them first with import_parties).",
      "Invoices with duplicate invoice_number are skipped.",
      "Set auto_create_payments=true to automatically create payment records for paid invoices.",
      "Use this for migrating historical data from MyBillBook, Tally, Busy, or Excel.",
    ].join(" "),
    {
      source: z.string().default("excel")
        .describe("Source system name for audit trail."),
      auto_create_payments: z.boolean().default(false)
        .describe("If true, automatically create payment records for invoices with amountPaid > 0."),
      default_payment_mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash")
        .describe("Payment mode to use when auto-creating payments from paid invoices."),
      invoices: z.array(z.object({
        invoice_number: z.string().min(1)
          .describe("Invoice number. Duplicates are skipped."),
        invoice_date: z.string()
          .describe("Invoice date (YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY)."),
        due_date: z.string().optional()
          .describe("Due date (same formats as invoice_date)."),
        party_name: z.string().min(1)
          .describe("Exact party name — must match an existing party (case-insensitive)."),
        type: z.enum(["sale", "purchase"]).default("sale")
          .describe("'sale' for customer invoice, 'purchase' for supplier bill."),
        status: z.enum(["draft", "sent", "paid", "partial", "overdue", "cancelled"]).default("sent")
          .describe("Invoice status. Use 'paid' for fully paid historical invoices."),
        total_amount: z.string()
          .describe("Total invoice amount including tax, as decimal string."),
        amount_paid: z.string().default("0")
          .describe("Amount already paid. '0' for unpaid, same as total_amount for fully paid."),
        subtotal: z.string().default("0")
          .describe("Pre-tax subtotal as decimal string."),
        tax_amount: z.string().default("0")
          .describe("Total tax amount as decimal string."),
        discount_amount: z.string().default("0")
          .describe("Total discount amount as decimal string."),
        notes: z.string().optional()
          .describe("Invoice notes."),
        line_items: z.array(z.object({
          description: z.string()
            .describe("Line item description or product name."),
          quantity: z.string().default("1")
            .describe("Quantity as decimal string."),
          unit_price: z.string()
            .describe("Price per unit as decimal string."),
          tax_percent: z.string().default("0")
            .describe("Tax rate percentage, e.g. '18'."),
          discount_percent: z.string().default("0")
            .describe("Discount percentage."),
          item_name: z.string().optional()
            .describe("If provided, links to an existing inventory item by name."),
        })).optional()
          .describe("Line items. Optional — if omitted, a single line item using total_amount is created."),
      })).min(1).max(1000)
        .describe("Array of invoice records. Max 1000 per call."),
    },
    wrapTool(async (input) => {
      const result = await client.import.importInvoices({
        source: input.source,
        autoCreatePayments: input.auto_create_payments,
        defaultPaymentMode: input.default_payment_mode,
        invoices: input.invoices.map((inv) => ({
          invoiceNumber: inv.invoice_number,
          invoiceDate: inv.invoice_date,
          dueDate: inv.due_date,
          partyName: inv.party_name,
          type: inv.type,
          status: inv.status,
          totalAmount: inv.total_amount,
          amountPaid: inv.amount_paid,
          subtotal: inv.subtotal,
          taxAmount: inv.tax_amount,
          discountAmount: inv.discount_amount,
          notes: inv.notes,
          lineItems: inv.line_items?.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unit_price,
            taxPercent: li.tax_percent,
            discountPercent: li.discount_percent,
            itemName: li.item_name,
          })) ?? [],
        })),
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
    "import_payments",
    [
      "Batch import historical payment records. Requires admin role.",
      "Parties referenced by party_name must already exist.",
      "Invoices referenced by invoice_numbers must already exist (import invoices first).",
      "Use this to import payment history after invoices are already imported.",
      "Returns: created, skipped, total, and any errors encountered.",
    ].join(" "),
    {
      source: z.string().default("excel")
        .describe("Source system name for audit trail."),
      paid_invoice_numbers: z.array(z.string()).default([])
        .describe("List of invoice numbers that were fully paid in the source system. Used for auto-allocation fallback."),
      payments: z.array(z.object({
        party_name: z.string().min(1)
          .describe("Party name — must match an existing party (case-insensitive)."),
        amount: z.string()
          .describe("Payment amount as decimal string."),
        mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).default("cash")
          .describe("Payment mode."),
        payment_date: z.string().optional()
          .describe("Payment date (YYYY-MM-DD or DD/MM/YYYY)."),
        payment_number: z.string().optional()
          .describe("Original payment number from source system."),
        reference_number: z.string().optional()
          .describe("Transaction reference, cheque number, UTR, etc."),
        notes: z.string().optional()
          .describe("Notes about this payment."),
        invoice_numbers: z.array(z.string()).optional()
          .describe("Explicit invoice numbers to allocate this payment against."),
      })).min(1).max(5000)
        .describe("Array of payment records. Max 5000 per call."),
    },
    wrapTool(async (input) => {
      const result = await client.import.importPayments({
        source: input.source,
        paidInvoiceNumbers: input.paid_invoice_numbers,
        payments: input.payments.map((p) => ({
          partyName: p.party_name,
          amount: p.amount,
          mode: p.mode,
          paymentDate: p.payment_date,
          paymentNumber: p.payment_number,
          referenceNumber: p.reference_number,
          notes: p.notes,
          invoiceNumbers: p.invoice_numbers,
        })),
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

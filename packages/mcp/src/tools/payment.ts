/**
 * Payment tools — record and query payments.
 *
 * Tools registered:
 *   payment_create            — record a payment received from a customer or made to a supplier
 *   payment_list              — list payments with filtering
 *   payment_get               — get full payment details including linked invoices
 *   payment_update            — update an existing payment record
 *   payment_delete            — soft-delete a payment
 *   payment_unpaid_invoices   — list unpaid invoices for a party
 *   payment_untracked         — list payments not linked to a bank account
 *   payment_default_account   — get the recommended bank account for recording a payment
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const PAYMENT_MODES = ["cash", "bank", "upi", "cheque", "other"] as const;

export function registerPaymentTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "payment_create",
    [
      "Record a payment received from a customer or made to a supplier.",
      "If the payment is for a specific invoice, set invoice_id — the invoice status will update automatically to 'paid' or 'partial'.",
      "If the payment is not tied to a specific invoice (advance payment or bulk payment), omit invoice_id — it applies to the party's account balance.",
      "To split a payment across multiple invoices, use the allocations array instead of invoice_id.",
      "Example: customer paid invoice INV-001 by UPI: { party_id: '<uuid>', amount: '5000.00', mode: 'upi', invoice_id: '<uuid>' }",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("UUID of the customer (payment received) or supplier (payment made)."),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/)
        .describe("Payment amount as decimal string, e.g. '5000.00'."),
      mode: z.enum(PAYMENT_MODES)
        .describe("Payment method: 'cash', 'bank' (bank transfer/NEFT/RTGS), 'upi', 'cheque', or 'other'."),
      invoice_id: z.string().uuid().optional()
        .describe("Link this payment to a specific invoice UUID. The invoice status updates automatically. Omit for advance payments."),
      discount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Discount or write-off amount applied alongside this payment, e.g. '100.00'. Default '0'."),
      reference_number: z.string().max(100).optional()
        .describe("Transaction reference, UTR number, cheque number, or any payment identifier."),
      payment_date: z.string().datetime().optional()
        .describe("Date the payment was received/made (ISO 8601). Defaults to today."),
      notes: z.string().max(500).optional()
        .describe("Internal notes about this payment."),
      bank_account_id: z.string().uuid().optional()
        .describe("Bank/cash account UUID to record this transaction against (for cash flow tracking)."),
      allocations: z.array(z.object({
        invoice_id: z.string().uuid()
          .describe("Invoice UUID to allocate part of this payment to."),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/)
          .describe("Amount to allocate to this invoice."),
      })).optional()
        .describe("Allocate a single payment across multiple invoices. Use instead of invoice_id when splitting a payment."),
    },
    wrapTool(async (input) => {
      const payment = await client.payment.create({
        partyId: input.party_id,
        amount: input.amount,
        mode: input.mode,
        invoiceId: input.invoice_id,
        discount: input.discount,
        referenceNumber: input.reference_number,
        paymentDate: input.payment_date,
        notes: input.notes,
        bankAccountId: input.bank_account_id,
        allocations: input.allocations?.map((a) => ({
          invoiceId: a.invoice_id,
          amount: a.amount,
        })),
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(payment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "payment_get",
    [
      "Get full details of a single payment, including the invoices it was applied to.",
      "The 'linkedInvoices' field shows which invoices received allocations from this payment.",
    ].join(" "),
    {
      payment_id: z.string().uuid()
        .describe("Payment UUID from payment_list."),
    },
    wrapTool(async (input) => {
      const payment = await client.payment.getById(input.payment_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(payment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "payment_update",
    [
      "Update an existing payment record. This reverses the old allocation and re-applies the new one.",
      "The linked invoice's amountPaid and status are recalculated automatically.",
      "Only provide fields you want to change.",
      "Warning: updating a payment recalculates invoice statuses — ensure the new amount/allocation is correct.",
    ].join(" "),
    {
      payment_id: z.string().uuid()
        .describe("Payment UUID to update."),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("New payment amount as decimal string."),
      mode: z.enum(PAYMENT_MODES).optional()
        .describe("Updated payment mode."),
      discount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Updated discount/write-off amount."),
      reference_number: z.string().max(100).optional().nullable()
        .describe("Updated transaction reference number."),
      payment_date: z.string().datetime().optional()
        .describe("Updated payment date (ISO 8601)."),
      notes: z.string().max(500).optional().nullable()
        .describe("Updated internal notes."),
      bank_account_id: z.string().uuid().optional().nullable()
        .describe("Updated bank account UUID. Null to unlink from any account."),
      allocations: z.array(z.object({
        invoice_id: z.string().uuid()
          .describe("Invoice UUID to allocate part of this payment to."),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/)
          .describe("Amount to allocate."),
      })).optional()
        .describe("Updated invoice allocations. Replaces all existing allocations."),
    },
    wrapTool(async (input) => {
      const payment = await client.payment.update({
        id: input.payment_id,
        amount: input.amount,
        mode: input.mode,
        discount: input.discount,
        referenceNumber: input.reference_number,
        paymentDate: input.payment_date,
        notes: input.notes,
        bankAccountId: input.bank_account_id,
        allocations: input.allocations?.map((a) => ({
          invoiceId: a.invoice_id,
          amount: a.amount,
        })),
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(payment, null, 2),
        }],
      };
    })
  );

  server.tool(
    "payment_delete",
    [
      "Soft-delete a payment record. Requires admin role.",
      "Deleting a payment reverses the invoice allocation: the linked invoice's amountPaid is reduced and its status is recalculated.",
      "The bank account balance is also reversed if the payment was recorded against an account.",
    ].join(" "),
    {
      payment_id: z.string().uuid()
        .describe("Payment UUID to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.payment.delete(input.payment_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "payment_list",
    [
      "List payments for the active business, filtered by party, invoice, or date range.",
      "Use party_id to see all payments from/to a specific customer or supplier.",
      "Use invoice_id to see all payments applied to a specific invoice.",
    ].join(" "),
    {
      party_id: z.string().uuid().optional()
        .describe("Filter by customer or supplier UUID."),
      invoice_id: z.string().uuid().optional()
        .describe("Filter payments linked to a specific invoice."),
      from_date: z.string().datetime().optional()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime().optional()
        .describe("End date (ISO 8601)."),
      search: z.string().max(200).optional()
        .describe("Search by payment number, party name, or reference number."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.payment.list({
        partyId: input.party_id,
        invoiceId: input.invoice_id,
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
    "payment_unpaid_invoices",
    [
      "List all unpaid or partially-paid invoices for a specific party.",
      "Returns invoices with status 'sent', 'partial', or 'overdue' — excludes paid and cancelled.",
      "Each result includes the remaining balance (totalAmount - amountPaid).",
      "Use this before recording a payment to find which invoices to allocate it against.",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("Party UUID to find unpaid invoices for."),
    },
    wrapTool(async (input) => {
      const result = await client.payment.unpaidInvoices(input.party_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "payment_untracked",
    [
      "List payments that have not been linked to a bank account.",
      "These are payments recorded without specifying which cash/bank account received the money.",
      "Use this to find payments that need to be assigned to a bank account for accurate cash flow tracking.",
      "Filter by mode (cash, upi, bank) or date range to narrow results.",
    ].join(" "),
    {
      search: z.string().max(200).optional()
        .describe("Search by payment number or party name."),
      mode: z.enum(["cash", "bank", "upi", "cheque", "other"]).optional()
        .describe("Filter by payment mode."),
      from_date: z.string().datetime().optional()
        .describe("Start date (ISO 8601)."),
      to_date: z.string().datetime().optional()
        .describe("End date (ISO 8601)."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.payment.untrackedPayments({
        search: input.search,
        mode: input.mode,
        fromDate: input.from_date,
        toDate: input.to_date,
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
    "payment_default_account",
    [
      "Get the recommended bank/cash account to use when recording a payment.",
      "Priority: most recently used account for this party → most common recent account → business default account.",
      "Optionally provide party_id to get a party-specific recommendation.",
      "Use this to pre-fill the bank account field in payment_create.",
    ].join(" "),
    {
      party_id: z.string().uuid().optional()
        .describe("Party UUID to get a party-specific account recommendation (optional)."),
    },
    wrapTool(async (input) => {
      const result = await client.payment.defaultAccount(input.party_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );
}

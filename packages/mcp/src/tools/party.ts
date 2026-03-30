/**
 * Party tools — manage customers and suppliers.
 *
 * Tools registered:
 *   party_list    — search parties with filter/sort options
 *   party_create  — create a new customer or supplier
 *   party_get     — get party details including outstanding balance
 *   party_ledger  — get full transaction ledger for a party
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

export function registerPartyTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "party_list",
    [
      "List customers and suppliers (parties) for the active business.",
      "The 'balance' field in each result shows the outstanding amount: positive = they owe you (receivable), negative = you owe them (payable).",
      "Use filter='outstanding' to find parties with unpaid balances. Use filter='overdue' for parties with overdue invoices.",
      "Use this tool to find party UUIDs before calling invoice_create or payment_create.",
    ].join(" "),
    {
      type: z.enum(["customer", "supplier"]).optional()
        .describe("'customer' for buyers, 'supplier' for vendors. Omit to return both."),
      filter: z.enum(["all", "customer", "supplier", "outstanding", "overdue"]).optional()
        .describe("'outstanding' = parties with unpaid balance, 'overdue' = parties with overdue invoices."),
      search: z.string().max(200).optional()
        .describe("Search by party name, phone, email, or GSTIN (partial match)."),
      category: z.string().max(100).optional()
        .describe("Filter by party category tag."),
      sort_by: z.enum(["name", "balance"]).optional()
        .describe("Sort by name (alphabetical) or balance (largest first)."),
      sort_dir: z.enum(["asc", "desc"]).optional()
        .describe("Sort direction."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.party.list({
        type: input.type,
        filter: input.filter,
        search: input.search,
        category: input.category,
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
    "party_create",
    [
      "Create a new customer or supplier party.",
      "Minimum required: type ('customer' or 'supplier') and name.",
      "For GST-registered parties, provide gstin (format: 22AAAAA0000A1Z5). For unregistered, omit it.",
      "opening_balance sets their starting account balance: positive = they owe you, negative = you owe them.",
    ].join(" "),
    {
      type: z.enum(["customer", "supplier"])
        .describe("'customer' for buyers/clients, 'supplier' for vendors/sellers."),
      name: z.string().min(1).max(200)
        .describe("Full name of the customer or business."),
      phone: z.string().max(15).optional()
        .describe("Phone number (digits only, no country code prefix required)."),
      email: z.string().email().optional()
        .describe("Email address for sending invoices."),
      gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional()
        .describe("GST Identification Number (15 characters), e.g. '22AAAAA0000A1Z5'. Omit if unregistered."),
      pan: z.string().optional()
        .describe("PAN (Permanent Account Number), 10 characters."),
      billing_address: z.string().max(500).optional()
        .describe("Full billing address."),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      pincode: z.string().max(10).optional(),
      opening_balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional()
        .describe("Starting balance as decimal string. Positive = they owe you, negative = you owe them. Default '0'."),
      category: z.string().max(100).optional()
        .describe("Category tag for grouping parties, e.g. 'retail', 'wholesale', 'government'."),
      credit_period_days: z.number().int().min(0).max(365).optional()
        .describe("Number of days before payment is due (e.g. 30 for net-30 terms)."),
      credit_limit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
        .describe("Maximum credit amount as decimal string."),
    },
    wrapTool(async (input) => {
      const party = await client.party.create({
        type: input.type,
        name: input.name,
        phone: input.phone,
        email: input.email,
        gstin: input.gstin,
        pan: input.pan,
        billingAddress: input.billing_address,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        openingBalance: input.opening_balance,
        category: input.category,
        creditPeriodDays: input.credit_period_days,
        creditLimit: input.credit_limit,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(party, null, 2),
        }],
      };
    })
  );

  server.tool(
    "party_get",
    [
      "Get full details of a single customer or supplier, including their current outstanding balance.",
      "'balance' shows net amount: positive = they owe you, negative = you owe them.",
      "Use this to answer questions like 'What does Acme Corp owe us?' or 'What is our balance with Supplier X?'",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("Party UUID from party_list."),
    },
    wrapTool(async (input) => {
      const party = await client.party.get(input.party_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(party, null, 2),
        }],
      };
    })
  );

  server.tool(
    "party_ledger",
    [
      "Get the full transaction ledger (account statement) for a customer or supplier.",
      "Shows all invoices, payments, and credit notes in chronological order with running balance.",
      "Use this to answer 'Show me all transactions with Customer X' or 'What is the payment history for this supplier?'",
      "The closing_balance field is the current net balance for the party.",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("Party UUID."),
      from_date: z.string().datetime().optional()
        .describe("Start date for ledger entries (ISO 8601). Omit for all-time."),
      to_date: z.string().datetime().optional()
        .describe("End date for ledger entries (ISO 8601)."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const ledger = await client.party.ledger(input.party_id, {
        fromDate: input.from_date,
        toDate: input.to_date,
        page: input.page,
        limit: MAX_PAGE_SIZE,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(ledger, null, 2),
        }],
      };
    })
  );
}

/**
 * Journal entry tools.
 *
 * Tools registered:
 *   journal_list          — list journal entries
 *   journal_get           — get a single journal entry by ID
 *   journal_create        — create a new journal entry
 *   journal_void          — void an existing journal entry
 *   journal_templates     — list journal entry templates
 */

import { z } from "zod";
import type { ToolServer } from "../lib/registry.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerJournalTools(server: ToolServer, client: HisaaboClient) {

  server.tool(
    "journal_list",
    [
      "List journal entries for the business.",
      "Supports date range filtering.",
      "Returns voucher number, date, narration, and status for each entry.",
      "Use journal_get to retrieve full line-item details for a specific entry.",
    ].join(" "),
    {
      from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("Start date in YYYY-MM-DD format."),
      to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
        .describe("End date in YYYY-MM-DD format."),
    },
    wrapTool(async (input) => {
      // The server expects full ISO datetimes; widen YYYY-MM-DD to the whole day.
      const result = await client.journal.list({
        fromDate: input.from_date ? `${input.from_date}T00:00:00.000Z` : undefined,
        toDate: input.to_date ? `${input.to_date}T23:59:59.999Z` : undefined,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "journal_get",
    [
      "Get full details of a journal entry including all debit/credit lines.",
      "Returns the voucher number, date, narration, status, and all account lines.",
    ].join(" "),
    {
      id: z.string().uuid()
        .describe("Journal entry UUID from journal_list."),
    },
    wrapTool(async (input) => {
      const result = await client.journal.getById(input.id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "journal_create",
    [
      "Create a new journal entry (manual accounting adjustment).",
      "A journal entry must have at least two lines, with total debits equalling total credits.",
      "Each line specifies an account ID, whether it is a debit or credit, and the amount.",
      "Use this for adjusting entries, depreciation, accruals, and other manual accounting transactions.",
    ].join(" "),
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Journal entry date in YYYY-MM-DD format."),
      narration: z.string().min(1).max(500)
        .describe("Description or narration for the journal entry."),
      lines: z.array(z.object({
        accountId: z.string().uuid().describe("Account UUID from account_list."),
        debit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().describe("Debit amount (string, e.g. '1000.00')."),
        credit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().describe("Credit amount (string, e.g. '1000.00')."),
        description: z.string().max(200).optional().describe("Line-level description."),
      })).min(2)
        .describe("Debit/credit lines. Total debits must equal total credits."),
    },
    wrapTool(async (input) => {
      const result = await client.journal.create({
        entryDate: `${input.date}T00:00:00.000Z`,
        narration: input.narration,
        lines: input.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          narration: l.description,
        })),
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "journal_void",
    [
      "Void a journal entry, reversing its accounting effect.",
      "A voided entry cannot be edited. Use this to correct mistakes.",
    ].join(" "),
    {
      id: z.string().uuid()
        .describe("Journal entry UUID to void."),
    },
    wrapTool(async (input) => {
      const result = await client.journal.void(input.id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "journal_templates",
    [
      "List saved journal entry templates.",
      "Templates store pre-configured debit/credit lines for recurring manual entries.",
      "Use journal_create to create an entry from scratch, or createFromTemplate for template-based entries.",
    ].join(" "),
    {},
    wrapTool(async () => {
      const result = await client.journal.templateList();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}

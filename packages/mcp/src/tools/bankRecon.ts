/**
 * Bank reconciliation tools.
 *
 * Tools registered:
 *   bank_recon_imports  — list bank statement imports
 *   bank_recon_summary  — get reconciliation summary for an import
 *   bank_recon_rules    — list auto-matching rules
 *   bank_recon_lines    — get unmatched lines for an import
 *
 * Note: CSV upload, mapping confirmation, and template management are
 * excluded (interactive UI workflows not suited for MCP agents).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

export function registerBankReconTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "bank_recon_imports",
    [
      "List bank statement imports for reconciliation.",
      "Returns each import with its date, bank account, total lines, matched count, and status.",
      "Use bank_recon_summary with an import ID to get detailed reconciliation progress.",
    ].join(" "),
    {
      bank_account_id: z.string().uuid().optional()
        .describe("Filter imports by bank account UUID."),
      page: z.number().int().min(1).default(1)
        .describe("Page number."),
      limit: z.number().int().min(1).max(50).default(20)
        .describe("Results per page."),
    },
    wrapTool(async (input) => {
      const result = await client.bankRecon.importList({
        bankAccountId: input.bank_account_id,
        page: input.page,
        limit: input.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "bank_recon_summary",
    [
      "Get reconciliation summary for a bank statement import.",
      "Returns total lines, matched, unmatched, ignored counts, and opening/closing balances.",
      "Use this to check reconciliation progress for a specific import.",
    ].join(" "),
    {
      import_id: z.string().uuid()
        .describe("Import UUID from bank_recon_imports."),
    },
    wrapTool(async (input) => {
      const result = await client.bankRecon.summary(input.import_id);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "bank_recon_rules",
    [
      "List auto-matching rules for bank reconciliation.",
      "Rules automatically match bank statement lines to transactions using pattern matching.",
      "Returns rule name, match condition (e.g. description contains 'NEFT'), and mapped action.",
    ].join(" "),
    {},
    wrapTool(async () => {
      const result = await client.bankRecon.ruleList();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "bank_recon_lines",
    [
      "Get bank statement lines for a reconciliation import.",
      "Returns transaction lines with their match status.",
      "Filter by status='unmatched' to see lines that still need to be matched.",
    ].join(" "),
    {
      import_id: z.string().uuid()
        .describe("Import UUID from bank_recon_imports."),
      status: z.enum(["all", "matched", "unmatched", "ignored"]).default("all").optional()
        .describe("Filter lines by match status."),
      page: z.number().int().min(1).default(1)
        .describe("Page number."),
      limit: z.number().int().min(1).max(100).default(50)
        .describe("Results per page."),
    },
    wrapTool(async (input) => {
      const result = await client.bankRecon.lines({
        importId: input.import_id,
        status: input.status,
        page: input.page,
        limit: input.limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );
}

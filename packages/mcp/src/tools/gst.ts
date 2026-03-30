/**
 * GST reporting tools.
 *
 * Tools registered:
 *   gst_report     — generate GSTR1 or GSTR3B summary data for a given month/year
 *   gst_report_csv — get GSTR-1 data in CSV format ready for portal upload
 *
 * Note: PDF generation is intentionally excluded. AI agents cannot consume
 * binary content in tool responses. The JSON report is designed to let agents
 * summarize GST liability, answer questions, and guide filing.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const CURRENT_YEAR = new Date().getFullYear();

export function registerGstTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "gst_report_csv",
    [
      "Get GSTR-1 data as a CSV string ready for upload to the GST portal.",
      "Returns the CSV content and a suggested filename (e.g. 'GSTR1_March_2024.csv').",
      "Save the CSV content to a file and upload it at https://www.gst.gov.in/.",
      "Month is 1–12 (1 = January, 3 = March, etc.).",
    ].join(" "),
    {
      month: z.number().int().min(1).max(12)
        .describe("Month number (1 = January, 12 = December)."),
      year: z.number().int().min(2020).max(CURRENT_YEAR + 1)
        .describe(`Year, e.g. ${CURRENT_YEAR}.`),
    },
    wrapTool(async (input) => {
      const result = await client.gst.gstr1CSV({ month: input.month, year: input.year });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "gst_report",
    [
      "Generate a GST report (GSTR1 or GSTR3B) for a specific month and year.",
      "GSTR1 = outward supplies summary (sales). GSTR3B = monthly return summary (sales + purchases + ITC).",
      "Returns JSON data — use this to answer 'What is our GST liability for March 2024?' or 'How much ITC can we claim this month?'",
      "Month is 1–12 (1 = January, 3 = March, etc.).",
      "Example: { report_type: 'gstr3b', month: 3, year: 2024 } for March 2024 GSTR3B.",
    ].join(" "),
    {
      report_type: z.enum(["gstr1", "gstr3b"])
        .describe("'gstr1' for outward supplies (sales) report. 'gstr3b' for monthly summary return."),
      month: z.number().int().min(1).max(12)
        .describe("Month number (1 = January, 12 = December)."),
      year: z.number().int().min(2020).max(CURRENT_YEAR + 1)
        .describe(`Year, e.g. ${CURRENT_YEAR}.`),
    },
    wrapTool(async (input) => {
      const report = input.report_type === "gstr1"
        ? await client.gst.gstr1({ month: input.month, year: input.year })
        : await client.gst.gstr3b({ month: input.month, year: input.year });

      const monthName = new Date(input.year, input.month - 1, 1)
        .toLocaleString("en-IN", { month: "long" });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              ...report,
              _meta: {
                reportType: input.report_type.toUpperCase(),
                period: `${monthName} ${input.year}`,
              },
            },
            null,
            2
          ),
        }],
      };
    })
  );
}

/**
 * Automated / Recurring Invoice tools — manage recurring invoice templates.
 *
 * Tools registered:
 *   automated_invoice_list        — list recurring invoice templates
 *   automated_invoice_get         — get a specific template by ID
 *   automated_invoice_create      — create a new recurring invoice template
 *   automated_invoice_update      — update an existing template
 *   automated_invoice_delete      — delete a template
 *   automated_invoice_pause       — pause an active template
 *   automated_invoice_resume      — resume a paused template
 *   automated_invoice_run_now     — manually trigger invoice generation
 *   automated_invoice_history     — get execution history for a template
 *   automated_invoice_plan_usage  — get current month's usage stats
 *   automated_invoice_suggestions — get AI-detected recurring billing patterns
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { MAX_PAGE_SIZE, withPaginationMeta } from "../lib/pagination.js";

const TEMPLATE_STATUSES = ["active", "paused", "completed", "expired"] as const;
const INVOICE_TYPES = ["sale", "purchase"] as const;
const FREQUENCIES = [
  "weekly", "biweekly", "monthly", "quarterly",
  "half_yearly", "yearly", "custom",
] as const;

export function registerAutomatedInvoiceTools(server: McpServer, client: HisaaboClient) {

  // ── List templates ──────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_list",
    [
      "List recurring invoice templates for the current business.",
      "Optionally filter by status (active, paused, completed, expired).",
      "Returns paginated results — use the 'page' parameter to fetch subsequent pages.",
    ].join(" "),
    {
      status: z.enum(TEMPLATE_STATUSES).optional()
        .describe("Filter by template status: 'active', 'paused', 'completed', or 'expired'."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.list({
        status: input.status,
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

  // ── Get template by ID ──────────────────────────────────────────────────

  server.tool(
    "automated_invoice_get",
    [
      "Get full details of a specific recurring invoice template by ID.",
      "Returns the template configuration, schedule info, party details, and embedded line items.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the recurring invoice template."),
    },
    wrapTool(async (input) => {
      const template = await client.automatedInvoice.getById(input.template_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(template, null, 2),
        }],
      };
    })
  );

  // ── Create template ─────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_create",
    [
      "Create a new recurring invoice template.",
      "The system will automatically generate invoices based on the specified frequency.",
      "Line items must be passed as a JSON string containing an array of objects with: description, quantity, unitPrice, and optional taxPercent and discountPercent.",
      "All money values (unitPrice, taxPercent, discountPercent) should be decimal strings like '100.00'.",
      "Frequency options: weekly, biweekly, monthly, quarterly, half_yearly, yearly, or custom (requires custom_interval_days).",
    ].join(" "),
    {
      party_id: z.string().uuid()
        .describe("UUID of the party (customer/supplier) for recurring invoices."),
      name: z.string().min(1).max(200)
        .describe("Human-readable name for this template, e.g. 'Monthly hosting for Acme Corp'."),
      type: z.enum(INVOICE_TYPES)
        .describe("Invoice type: 'sale' or 'purchase'."),
      frequency: z.enum(FREQUENCIES)
        .describe("How often to generate invoices: weekly, biweekly, monthly, quarterly, half_yearly, yearly, or custom."),
      custom_interval_days: z.number().int().min(1).optional()
        .describe("Required when frequency is 'custom'. Number of days between each invoice generation."),
      line_items: z.string()
        .describe("JSON string of line items array. Each item: { description: string, quantity: string, unitPrice: string, taxPercent?: string, discountPercent?: string }."),
      start_date: z.string().datetime()
        .describe("When to start generating invoices (ISO 8601 datetime). First invoice is generated on this date."),
      end_date: z.string().datetime().optional()
        .describe("Optional end date (ISO 8601). Template expires after this date."),
      max_runs: z.number().int().min(1).optional()
        .describe("Optional maximum number of invoices to generate. Template completes after reaching this count."),
      notes: z.string().max(1000).optional()
        .describe("Optional notes to include on each generated invoice."),
    },
    wrapTool(async (input) => {
      const lineItems = JSON.parse(input.line_items);
      const template = await client.automatedInvoice.create({
        partyId: input.party_id,
        name: input.name,
        type: input.type,
        frequency: input.frequency,
        customIntervalDays: input.custom_interval_days,
        lineItems,
        startDate: input.start_date,
        endDate: input.end_date,
        maxRuns: input.max_runs,
        notes: input.notes,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(template, null, 2),
        }],
      };
    })
  );

  // ── Update template ─────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_update",
    [
      "Update an existing recurring invoice template.",
      "Only provide fields you want to change — all other fields remain unchanged.",
      "If updating line_items, pass the complete new array as a JSON string (replaces all existing items).",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the template to update."),
      name: z.string().min(1).max(200).optional()
        .describe("Updated template name."),
      party_id: z.string().uuid().optional()
        .describe("Updated party UUID."),
      type: z.enum(INVOICE_TYPES).optional()
        .describe("Updated invoice type: 'sale' or 'purchase'."),
      frequency: z.enum(FREQUENCIES).optional()
        .describe("Updated frequency."),
      custom_interval_days: z.number().int().min(1).optional()
        .describe("Updated custom interval (only when frequency is 'custom')."),
      line_items: z.string().optional()
        .describe("Updated line items as JSON string (replaces all existing). Same format as create."),
      end_date: z.string().datetime().optional()
        .describe("Updated end date (ISO 8601)."),
      max_runs: z.number().int().min(1).optional()
        .describe("Updated maximum number of runs."),
      notes: z.string().max(1000).optional()
        .describe("Updated notes for generated invoices."),
    },
    wrapTool(async (input) => {
      const lineItems = input.line_items ? JSON.parse(input.line_items) : undefined;
      const template = await client.automatedInvoice.update(input.template_id, {
        name: input.name,
        partyId: input.party_id,
        type: input.type,
        frequency: input.frequency,
        customIntervalDays: input.custom_interval_days,
        lineItems,
        endDate: input.end_date,
        maxRuns: input.max_runs,
        notes: input.notes,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(template, null, 2),
        }],
      };
    })
  );

  // ── Delete template ─────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_delete",
    [
      "Delete a recurring invoice template.",
      "Previously generated invoices are not affected — only future generation stops.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the template to delete."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.delete(input.template_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  // ── Pause template ──────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_pause",
    [
      "Pause an active recurring invoice template.",
      "No new invoices will be generated while paused. Use automated_invoice_resume to reactivate.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the active template to pause."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.pause(input.template_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  // ── Resume template ─────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_resume",
    [
      "Resume a paused recurring invoice template.",
      "Invoice generation will restart from the next scheduled date.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the paused template to resume."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.resume(input.template_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  // ── Run now (manual trigger) ────────────────────────────────────────────

  server.tool(
    "automated_invoice_run_now",
    [
      "Manually trigger immediate invoice generation from a template.",
      "This creates an invoice right now regardless of the next scheduled date.",
      "The run counts toward the template's maxRuns limit and the monthly plan usage.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the template to trigger."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.runNow(input.template_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  // ── Execution history ───────────────────────────────────────────────────

  server.tool(
    "automated_invoice_history",
    [
      "Get the execution history for a recurring invoice template.",
      "Shows each run with its status (success, failed, skipped_limit), the generated invoice ID, and any error messages.",
      "Results are paginated — use the 'page' parameter to fetch older entries.",
    ].join(" "),
    {
      template_id: z.string().uuid()
        .describe("UUID of the template to get history for."),
      page: z.number().int().min(1).default(1)
        .describe("Page number for pagination."),
    },
    wrapTool(async (input) => {
      const result = await client.automatedInvoice.executionHistory(
        input.template_id,
        input.page,
        MAX_PAGE_SIZE,
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(withPaginationMeta(result), null, 2),
        }],
      };
    })
  );

  // ── Plan usage ──────────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_plan_usage",
    [
      "Get the current month's recurring invoice usage statistics.",
      "Shows how many automated invoices have been generated this month versus the plan limit.",
      "Use this to check if the business is approaching or has reached their monthly quota.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const usage = await client.automatedInvoice.planUsage();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(usage, null, 2),
        }],
      };
    })
  );

  // ── Suggestions ─────────────────────────────────────────────────────────

  server.tool(
    "automated_invoice_suggestions",
    [
      "Get AI-detected recurring billing patterns from invoice history.",
      "Analyzes the last 12 months of invoices to find parties with regular billing intervals and consistent line items.",
      "Returns suggested templates that the user can review and activate.",
      "Use this to help users discover automation opportunities they may not have noticed.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const suggestions = await client.automatedInvoice.suggestions();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(suggestions, null, 2),
        }],
      };
    })
  );
}

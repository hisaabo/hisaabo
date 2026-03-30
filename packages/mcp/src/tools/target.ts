/**
 * Sales target tools — create and track sales goals for team members.
 *
 * Tools registered:
 *   target_list     — list all sales targets (admin view)
 *   target_create   — create a new sales target for a seller
 *   target_progress — get progress for a specific target
 *   target_my       — get the current user's active targets with progress
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const TARGET_TYPES = ["order_count", "order_value", "item_quantity"] as const;
const PERIOD_TYPES = ["daily", "weekly", "monthly", "quarterly", "custom"] as const;

export function registerTargetTools(server: McpServer, client: HisaaboClient) {

  server.tool(
    "target_list",
    [
      "List sales targets for the active business (admin/viewer view).",
      "Filter by user, period type, or active targets only.",
      "Set with_progress=true to include real-time progress (current vs target, percentage, on-track status).",
      "Use user_id to see targets for a specific seller.",
    ].join(" "),
    {
      user_id: z.string().uuid().optional()
        .describe("Filter targets assigned to a specific user UUID."),
      period_type: z.enum(PERIOD_TYPES).optional()
        .describe("Filter by period: 'daily', 'weekly', 'monthly', 'quarterly', or 'custom'."),
      active: z.boolean().optional()
        .describe("If true, return only targets whose period includes today (active targets)."),
      with_progress: z.boolean().default(false)
        .describe("If true, compute and return real-time progress for each target. Adds latency."),
    },
    wrapTool(async (input) => {
      const targets = await client.target.list({
        userId: input.user_id,
        periodType: input.period_type,
        active: input.active,
        withProgress: input.with_progress,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(targets, null, 2),
        }],
      };
    })
  );

  server.tool(
    "target_create",
    [
      "Create a sales target for a seller. Requires admin role.",
      "target_type options: 'order_count' (number of invoices), 'order_value' (total revenue), 'item_quantity' (units sold of a specific item).",
      "For 'item_quantity' targets, item_id is required.",
      "period_start and period_end define the target window. Use period_type to categorize (daily/weekly/monthly/quarterly/custom).",
      "Example: set a monthly revenue target of ₹1,00,000 for a seller.",
    ].join(" "),
    {
      user_id: z.string().uuid()
        .describe("UUID of the seller this target is assigned to."),
      target_type: z.enum(TARGET_TYPES)
        .describe("'order_count' = number of invoices, 'order_value' = total revenue amount, 'item_quantity' = units of a specific item sold."),
      target_value: z.string().regex(/^\d+(\.\d{1,2})?$/)
        .describe("Target value as decimal string: e.g. '100000.00' for ₹1 lakh revenue, or '50' for 50 orders."),
      item_id: z.string().uuid().optional().nullable()
        .describe("Required for 'item_quantity' targets — the specific item UUID to track."),
      period_type: z.enum(PERIOD_TYPES)
        .describe("Categorization: 'daily', 'weekly', 'monthly', 'quarterly', or 'custom'."),
      period_start: z.string().datetime()
        .describe("Start of the target period (ISO 8601)."),
      period_end: z.string().datetime()
        .describe("End of the target period (ISO 8601). Must be after period_start."),
      notes: z.string().max(500).optional().nullable()
        .describe("Optional notes about this target, e.g. 'Q1 FY2025 target'."),
    },
    wrapTool(async (input) => {
      const target = await client.target.create({
        userId: input.user_id,
        targetType: input.target_type,
        targetValue: input.target_value,
        itemId: input.item_id,
        periodType: input.period_type,
        periodStart: input.period_start,
        periodEnd: input.period_end,
        notes: input.notes,
      });
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(target, null, 2),
        }],
      };
    })
  );

  server.tool(
    "target_progress",
    [
      "Get real-time progress for a specific sales target.",
      "Returns current achievement, target value, percentage, remaining amount, and whether the seller is on track.",
      "Also shows timeline: days total, days elapsed, days remaining.",
      "'onTrack' is true if current progress is >= what it should be based on time elapsed.",
    ].join(" "),
    {
      target_id: z.string().uuid()
        .describe("Target UUID from target_list."),
    },
    wrapTool(async (input) => {
      const result = await client.target.getProgress(input.target_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "target_my",
    [
      "Get the current user's active sales targets with real-time progress.",
      "Returns targets whose period includes today, with progress data for each.",
      "Sellers use this to check their own performance without needing admin access.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const targets = await client.target.myTargets();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(targets, null, 2),
        }],
      };
    })
  );
}

/**
 * Notification tools — the inbox and the caller's own notification preferences.
 *
 * Tools registered:
 *   notification_list               — inbox for the active business
 *   notification_unread_counts      — unread counts per business
 *   notification_mark_read          — mark entries read
 *   notification_mark_all_read      — mark the active business's inbox read
 *   notification_preferences_get    — effective preferences per channel
 *   notification_preference_update  — change one channel's preference
 *
 * Push-device registration and marketing consent are deliberately not exposed:
 * devices belong to interactive sessions, and consent must come from the user.
 */

import { z } from "zod";
import type { ToolServer } from "../lib/registry.js";
import type { HisaaboClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const CHANNELS = [
  "money_in", "collections", "sales", "store", "payables", "banking", "compliance",
  "inventory", "targets", "security", "digest", "general", "promotions",
] as const;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function registerNotificationTools(server: ToolServer, client: HisaaboClient) {
  server.tool(
    "notification_list",
    [
      "List the caller's notifications for the active business (plus organization-wide ones like team changes), newest first.",
      "Each entry has a channel (money_in, collections, store, compliance, security, …), title, body, a target ({kind, id}) pointing at the record, and readAt.",
      "Use unread_only=true to act on what's new, e.g. follow up overdue invoices from 'collections'.",
      "Paginate with the returned nextCursor.",
    ].join(" "),
    {
      limit: z.number().int().min(1).max(100).default(30).describe("Entries per page (max 100)."),
      cursor: z.string().datetime().optional().describe("nextCursor from the previous page."),
      unread_only: z.boolean().default(false).describe("Only unread entries."),
      channel: z.enum(CHANNELS).optional().describe("Only this channel."),
    },
    wrapTool(async (input) => json(await client.notification.list({
      limit: input.limit,
      cursor: input.cursor,
      unreadOnly: input.unread_only,
      channel: input.channel,
    }))),
  );

  server.tool(
    "notification_unread_counts",
    "Unread notification counts for the organization: total, organization-wide, and per business.",
    {},
    wrapTool(async () => json(await client.notification.unreadCounts())),
  );

  server.tool(
    "notification_mark_read",
    "Mark notifications as read by id (from notification_list).",
    {
      ids: z.array(z.string().uuid()).min(1).max(200).describe("Notification ids."),
    },
    wrapTool(async (input) => json(await client.notification.markRead(input.ids))),
  );

  server.tool(
    "notification_mark_all_read",
    "Mark every notification in the active business (and organization-wide ones) as read.",
    {},
    wrapTool(async () => json(await client.notification.markAllRead())),
  );

  server.tool(
    "notification_preferences_get",
    [
      "Get the caller's notification preferences for every channel: delivery (push, inbox, digest, off),",
      "scope (mine = only records they created, everyone), amount threshold in paise, email copy,",
      "where each value comes from (role_default, tenant, business), and whether the channel is locked",
      "(required for their role) or unavailable. Pass business_id for one business, omit for the organization default.",
    ].join(" "),
    {
      business_id: z.string().uuid().optional().describe("A business in this organization; omit for the organization-wide default."),
    },
    wrapTool(async (input) => json(await client.notification.getPreferences(input.business_id ?? null))),
  );

  server.tool(
    "notification_preference_update",
    [
      "Change the caller's preference for one notification channel, for the whole organization (business_id omitted) or one business.",
      "Only the fields given are changed; reset=true removes the override so the next level applies.",
      "Locked channels (security; GST failures for owners and accountants) cannot be muted.",
      "Example: owners who find 'sales' too busy can set delivery='digest'.",
    ].join(" "),
    {
      channel: z.enum(CHANNELS).describe("Channel to change."),
      business_id: z.string().uuid().optional().describe("Limit the change to one business."),
      delivery: z.enum(["push", "inbox", "digest", "off"]).optional().describe("push = phone alert + inbox; inbox = inbox only; digest = summary only; off = nothing."),
      scope: z.enum(["mine", "everyone"]).optional().describe("Only for money_in, collections, sales, targets."),
      threshold_paise: z.number().int().min(0).optional().describe("Push only at or above this amount, in paise (₹10,000 = 1000000)."),
      email: z.boolean().optional().describe("Also send an email copy."),
      reset: z.boolean().optional().describe("Remove this override."),
    },
    wrapTool(async (input) => json(await client.notification.updatePreference({
      businessId: input.business_id ?? null,
      channel: input.channel,
      delivery: input.delivery,
      scope: input.scope,
      thresholdPaise: input.threshold_paise,
      email: input.email,
      reset: input.reset,
    }))),
  );
}

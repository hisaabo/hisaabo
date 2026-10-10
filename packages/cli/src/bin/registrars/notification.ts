import { Command } from "commander";
import {
  notificationListCommand,
  notificationReadCommand,
  notificationPrefsCommand,
  notificationSetCommand,
} from "../../commands/notification/index.js";

export function registerNotificationCommands(program: Command): void {
  // ── notifications ─────────────────────────────────────────────────────────

  const notifications = program.command("notifications").description("Notification inbox and preferences");

  notifications
    .command("list")
    .description("List notifications for the active business")
    .option("--json", "JSON output")
    .option("--unread", "Only unread notifications")
    .option("--channel <channel>", "Only one channel (money_in, collections, store, compliance, security, …)")
    .option("--limit <n>", "Number of notifications (1–100)", "30")
    .action(async (opts) => {
      await notificationListCommand({ json: opts.json, unread: opts.unread, channel: opts.channel, limit: opts.limit });
    });

  notifications
    .command("read")
    .description("Mark notifications as read")
    .argument("[ids...]", "Notification ids (full or the short prefix shown by `list`)")
    .option("--all", "Mark everything in the active business as read")
    .option("--json", "JSON output")
    .action(async (ids: string[], opts) => {
      await notificationReadCommand(ids, { all: opts.all, json: opts.json });
    });

  notifications
    .command("prefs")
    .description("Show your notification preferences per channel")
    .option("--business <id>", "Preferences for one business (default: organization-wide)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await notificationPrefsCommand({ json: opts.json, business: opts.business });
    });

  notifications
    .command("set")
    .description("Change your preference for one channel")
    .argument("<channel>", "Channel id, e.g. sales")
    .option("--delivery <mode>", "push, inbox, digest or off")
    .option("--scope <scope>", "mine or everyone")
    .option("--threshold <rupees>", "Push only at or above this amount ('none' to clear)")
    .option("--email", "Also send an email copy")
    .option("--no-email", "Stop email copies")
    .option("--business <id>", "Only for this business (default: organization-wide)")
    .option("--reset", "Remove your override for this channel")
    .option("--json", "JSON output")
    .action(async (channel: string, opts) => {
      await notificationSetCommand(channel, {
        json: opts.json,
        business: opts.business,
        delivery: opts.delivery,
        scope: opts.scope,
        threshold: opts.threshold,
        // commander sets email=true by default when --no-email is declared; only pass it when given
        email: process.argv.includes("--email") ? true : process.argv.includes("--no-email") ? false : undefined,
        reset: opts.reset,
      });
    });
}

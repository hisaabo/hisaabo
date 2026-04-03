import { Command } from "commander";

export function registerStoreCommands(program: Command): void {
  // ── store ─────────────────────────────────────────────────────────────────

  const store = program.command("store").description("Online store management");

  store
    .command("settings")
    .description("Show store settings")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { storeSettingsCommand } = await import("../../commands/store/index.js");
      await storeSettingsCommand({ json: opts.json });
    });

  store
    .command("update-settings")
    .description("Update store settings")
    .option("--slug <slug>", "Store URL slug")
    .option("--tagline <text>", "Store tagline / description")
    .option("--enabled <bool>", "Enable or disable store (true/false)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { storeUpdateSettingsCommand } = await import("../../commands/store/update-settings.js");
      await storeUpdateSettingsCommand({
        slug: opts.slug,
        tagline: opts.tagline,
        enabled: opts.enabled,
        json: opts.json,
      });
    });

  store
    .command("items")
    .description("List items available in the store")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { storeItemsCommand } = await import("../../commands/store/items.js");
      await storeItemsCommand({ json: opts.json, format: opts.format });
    });

  store
    .command("items-toggle")
    .description("Bulk enable / disable store items")
    .option("--enable <ids>", "Comma-separated item IDs to enable")
    .option("--disable <ids>", "Comma-separated item IDs to disable")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { storeItemsToggleCommand } = await import("../../commands/store/items-toggle.js");
      await storeItemsToggleCommand({
        enable: opts.enable,
        disable: opts.disable,
        json: opts.json,
      });
    });

  store
    .command("orders")
    .description("List store orders")
    .option("--json", "JSON output")
    .option("--status <status>", "Filter by order status")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      const { storeOrdersCommand } = await import("../../commands/store/index.js");
      await storeOrdersCommand({
        json: opts.json,
        status: opts.status,
        page: opts.page,
        limit: opts.limit,
      });
    });

  store
    .command("order-get <id>")
    .description("Get order details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { storeOrderGetCommand } = await import("../../commands/store/order-get.js");
      await storeOrderGetCommand(id, { json: opts.json });
    });

  store
    .command("order-confirm <id>")
    .description("Confirm a pending order")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { storeOrderConfirmCommand } = await import("../../commands/store/order-confirm.js");
      await storeOrderConfirmCommand(id, { json: opts.json, yes: opts.yes });
    });

  store
    .command("order-cancel <id>")
    .description("Cancel an order")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--reason <text>", "Cancellation reason")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { storeOrderCancelCommand } = await import("../../commands/store/order-cancel.js");
      await storeOrderCancelCommand(id, {
        json: opts.json,
        yes: opts.yes,
        reason: opts.reason,
      });
    });

  store
    .command("order-update <id>")
    .description("Update order status")
    .option("--status <status>", "New status: preparing, ready, delivered")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const { storeOrderUpdateCommand } = await import("../../commands/store/order-update.js");
      await storeOrderUpdateCommand(id, { json: opts.json, status: opts.status });
    });

  store
    .command("check-slug <slug>")
    .description("Check store slug availability")
    .option("--json", "JSON output")
    .action(async (slug, opts) => {
      const { storeCheckSlugCommand } = await import("../../commands/store/check-slug.js");
      await storeCheckSlugCommand(slug, { json: opts.json });
    });
}

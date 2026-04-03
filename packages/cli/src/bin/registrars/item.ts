import { Command } from "commander";
import { requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, EXIT, outputJSON } from "../../output.js";
import { itemListCommand } from "../../commands/item/list.js";
import { itemCreateCommand } from "../../commands/item/create.js";
import { itemDeleteCommand } from "../../commands/item/delete.js";
import { itemStockCommand } from "../../commands/item/stock.js";

export function registerItemCommands(program: Command): void {
  // ── item ──────────────────────────────────────────────────────────────────

  const item = program.command("item").description("Item / product management");

  item
    .command("list")
    .description("List items")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv, ids")
    .option("--search <q>", "Search")
    .option("--category <cat>", "Filter by category")
    .option("--type <type>", "product or service")
    .option("--low-stock", "Show only low-stock items")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (opts) => {
      await itemListCommand({
        json: opts.json,
        format: opts.format,
        search: opts.search,
        category: opts.category,
        type: opts.type,
        lowStock: opts.lowStock,
        page: opts.page,
        limit: opts.limit,
      });
    });

  item
    .command("get <id>")
    .description("Get item details")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);
      try {
        const it = await client.item.get(id);
        if (opts.json) { outputJSON(it); return; }
        console.log(`\n  ${it.name} (${it.itemType})`);
        console.log("  " + "─".repeat(40));
        if (it.sku) console.log(`  SKU:      ${it.sku}`);
        if (it.hsn) console.log(`  HSN:      ${it.hsn}`);
        console.log(`  Unit:     ${it.unit}`);
        if (it.salePrice) console.log(`  Sale:     ₹${it.salePrice}`);
        if (it.purchasePrice) console.log(`  Purchase: ₹${it.purchasePrice}`);
        console.log(`  Tax:      ${it.taxPercent}%`);
        if (it.itemType === "product") console.log(`  Stock:    ${it.stockQuantity}`);
        console.log();
      } catch (e) {
        if (e instanceof HisaaboApiError && e.hisaaboError.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });

  item
    .command("create")
    .description("Create a new item")
    .option("--json", "JSON output")
    .option("--name <name>", "Item name")
    .option("--unit <unit>", "Unit (pcs, kg, etc.)")
    .option("--sale-price <price>", "Sale price")
    .option("--purchase-price <price>", "Purchase price")
    .option("--tax <percent>", "Tax percentage")
    .option("--stock <qty>", "Opening stock quantity")
    .option("--hsn <code>", "HSN code")
    .option("--category <cat>", "Category")
    .option("--type <type>", "product or service")
    .option("-y, --yes", "Skip confirmation")
    .action(async (opts) => {
      await itemCreateCommand({
        json: opts.json,
        name: opts.name,
        unit: opts.unit,
        salePrice: opts.salePrice,
        purchasePrice: opts.purchasePrice,
        taxPercent: opts.tax,
        stock: opts.stock,
        hsn: opts.hsn,
        category: opts.category,
        type: opts.type,
        yes: opts.yes,
      });
    });

  item
    .command("delete <id>")
    .description("Delete an item")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await itemDeleteCommand(id, { yes: opts.yes, json: opts.json });
    });

  item
    .command("stock <id> <adjustment>")
    .description("Adjust item stock (+10, -5, 100)")
    .option("--json", "JSON output")
    .option("--reason <text>", "Reason for adjustment")
    .action(async (id, adjustment, opts) => {
      await itemStockCommand(id, adjustment, { json: opts.json, reason: opts.reason });
    });
}

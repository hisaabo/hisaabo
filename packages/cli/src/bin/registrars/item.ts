import { Command } from "commander";
import { requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, EXIT, outputJSON } from "../../output.js";
import { itemListCommand } from "../../commands/item/list.js";
import { itemCreateCommand } from "../../commands/item/create.js";
import { itemDeleteCommand } from "../../commands/item/delete.js";
import { itemStockCommand } from "../../commands/item/stock.js";
import { itemUpdateCommand } from "../../commands/item/update.js";
import { itemMergeCommand } from "../../commands/item/merge.js";
import { itemPriceHistoryCommand } from "../../commands/item/price-history.js";
import { itemPriceSummaryCommand } from "../../commands/item/price-summary.js";
import { itemStockMovementsCommand } from "../../commands/item/stock-movements.js";
import { itemStockSummaryCommand } from "../../commands/item/stock-summary.js";
import { itemRenameUnitCommand } from "../../commands/item/rename-unit.js";
import { itemSalesStatsCommand } from "../../commands/item/sales-stats.js";
import { itemStockHistoryCommand } from "../../commands/item/stock-history.js";
import { itemSwitchBaseUnitCommand } from "../../commands/item/switch-base-unit.js";
import { itemLowStockCountCommand } from "../../commands/item/low-stock-count.js";
import { itemVariantsListCommand } from "../../commands/item/variants-list.js";
import { itemVariantsCreateCommand } from "../../commands/item/variants-create.js";
import { itemVariantsUpdateCommand } from "../../commands/item/variants-update.js";
import { itemVariantsDeleteCommand } from "../../commands/item/variants-delete.js";

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
        if (!it) fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
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

  item
    .command("update <id>")
    .description("Update an item (only the options you pass are changed)")
    .option("--json", "JSON output")
    .option("--name <name>", "Item name")
    .option("--sale-price <price>", "Sale price")
    .option("--purchase-price <price>", "Purchase price")
    .option("--tax <percent>", "Tax percentage")
    .option("--hsn <code>", "HSN code")
    .option("--unit <unit>", "Unit (pcs, kg, etc.)")
    .option("--category <cat>", "Category")
    .option("--sku <sku>", "SKU")
    .option("--low-stock-alert <qty>", "Low-stock alert threshold")
    .action(async (id, opts) => {
      await itemUpdateCommand(id, {
        json: opts.json,
        name: opts.name,
        salePrice: opts.salePrice,
        purchasePrice: opts.purchasePrice,
        taxPercent: opts.tax,
        hsn: opts.hsn,
        unit: opts.unit,
        category: opts.category,
        sku: opts.sku,
        lowStockAlert: opts.lowStockAlert,
      });
    });

  item
    .command("merge <sourceId> <targetId>")
    .description("Merge one item into another (moves invoice history)")
    .option("--json", "JSON output")
    .option("--conversion-factor <n>", "Stock conversion factor from source to target unit")
    .option("-y, --yes", "Skip confirmation")
    .action(async (sourceId, targetId, opts) => {
      await itemMergeCommand(sourceId, targetId, { conversionFactor: opts.conversionFactor, yes: opts.yes, json: opts.json });
    });

  item
    .command("price-history <id>")
    .description("Show past invoiced prices for an item")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--period <period>", "Time window: 6m, 1y, all (default: all)")
    .option("--limit <n>", "Max lines to return (1-500, default 50)", parseInt)
    .action(async (id, opts) => {
      await itemPriceHistoryCommand(id, { json: opts.json, format: opts.format, period: opts.period, limit: opts.limit });
    });

  item
    .command("price-summary <id>")
    .description("Min / max / average / latest invoiced price over a whole period")
    .option("--json", "JSON output")
    .option("--period <period>", "Time window: 6m, 1y, all (default: all)")
    .option("--unit <unit>", "Display unit (base or alt unit; default: base unit)")
    .option("--type <type>", "Price series: sale or purchase (default: sale)")
    .action(async (id, opts) => {
      await itemPriceSummaryCommand(id, { json: opts.json, period: opts.period, unit: opts.unit, type: opts.type });
    });

  item
    .command("stock-movements <id>")
    .description("Show invoice-driven stock movements (in/out) for an item")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--period <period>", "Time window: 6m, 1y, all (default: all)")
    .option("--limit <n>", "Max movements to return (1-500, default 50)", parseInt)
    .action(async (id, opts) => {
      await itemStockMovementsCommand(id, { json: opts.json, format: opts.format, period: opts.period, limit: opts.limit });
    });

  item
    .command("stock-summary <id>")
    .description("Total stock in / out / net change over a whole period")
    .option("--json", "JSON output")
    .option("--period <period>", "Time window: 6m, 1y, all (default: all)")
    .option("--unit <unit>", "Display unit (base or alt unit; default: base unit)")
    .action(async (id, opts) => {
      await itemStockSummaryCommand(id, { json: opts.json, period: opts.period, unit: opts.unit });
    });

  item
    .command("rename-unit <id>")
    .description("Rename one of an item's units")
    .option("--json", "JSON output")
    .requiredOption("--old <unit>", "Current unit name")
    .requiredOption("--new <unit>", "New unit name")
    .action(async (id, opts) => {
      await itemRenameUnitCommand(id, { old: opts.old, new: opts.new, json: opts.json });
    });

  item
    .command("sales-stats <id>")
    .description("Show lifetime sales totals for an item")
    .option("--json", "JSON output")
    .action(async (id, opts) => {
      await itemSalesStatsCommand(id, { json: opts.json });
    });

  item
    .command("stock-history <id>")
    .description("Show stock adjustment history for an item")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .option("--page <n>", "Page number", parseInt)
    .option("--limit <n>", "Items per page", parseInt)
    .action(async (id, opts) => {
      await itemStockHistoryCommand(id, { json: opts.json, format: opts.format, page: opts.page, limit: opts.limit });
    });

  item
    .command("switch-base-unit <id>")
    .description("Switch an item's base unit")
    .option("--json", "JSON output")
    .requiredOption("--unit <unit>", "New base unit")
    .requiredOption("--conversion-factor <n>", "How many new base units make one old base unit")
    .action(async (id, opts) => {
      await itemSwitchBaseUnitCommand(id, { unit: opts.unit, conversionFactor: opts.conversionFactor, json: opts.json });
    });

  item
    .command("low-stock-count")
    .description("Count items below their low-stock threshold")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await itemLowStockCountCommand({ json: opts.json });
    });

  const variants = item.command("variants").description("Item variant management");

  variants
    .command("list <itemId>")
    .description("List an item's variants")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (itemId, opts) => {
      await itemVariantsListCommand(itemId, { json: opts.json, format: opts.format });
    });

  variants
    .command("create <itemId>")
    .description("Create a variant")
    .option("--json", "JSON output")
    .requiredOption("--attributes <json>", "Attributes as a JSON object of strings, e.g. '{\"size\":\"M\"}'")
    .option("--sku <sku>", "SKU")
    .option("--sale-price <price>", "Sale price")
    .option("--purchase-price <price>", "Purchase price")
    .option("--stock <qty>", "Opening stock quantity")
    .option("--low-stock-alert <qty>", "Low-stock alert threshold")
    .action(async (itemId, opts) => {
      await itemVariantsCreateCommand(itemId, opts);
    });

  variants
    .command("update <variantId>")
    .description("Update a variant (only the options you pass are changed)")
    .option("--json", "JSON output")
    .option("--attributes <json>", "Attributes as a JSON object of strings")
    .option("--sku <sku>", "SKU")
    .option("--sale-price <price>", "Sale price")
    .option("--purchase-price <price>", "Purchase price")
    .option("--stock <qty>", "Stock quantity")
    .option("--low-stock-alert <qty>", "Low-stock alert threshold")
    .action(async (variantId, opts) => {
      await itemVariantsUpdateCommand(variantId, opts);
    });

  variants
    .command("delete <variantId>")
    .description("Delete a variant")
    .option("--json", "JSON output")
    .option("-y, --yes", "Skip confirmation")
    .action(async (variantId, opts) => {
      await itemVariantsDeleteCommand(variantId, { yes: opts.yes, json: opts.json });
    });
}

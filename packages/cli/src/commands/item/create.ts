import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface CreateOpts {
  json?: boolean;
  name?: string;
  unit?: string;
  salePrice?: string;
  purchasePrice?: string;
  taxPercent?: string;
  stock?: string;
  hsn?: string;
  category?: string;
  type?: string;
  yes?: boolean;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

export async function itemCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  let name = opts.name;
  let unit = opts.unit ?? "pcs";
  let salePrice = opts.salePrice;
  let purchasePrice = opts.purchasePrice;
  let taxPercent = opts.taxPercent ?? "0";
  let stockQuantity = opts.stock;
  let hsn = opts.hsn;
  let category = opts.category;
  let itemType = (opts.type ?? "product") as "product" | "service";

  if (!isNonInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\n  New Item\n  " + "─".repeat(30) + "\n");

    if (!name) name = (await prompt(rl, "  Name: ")).trim();
    const typeStr = await prompt(rl, "  Type (product/service) [product]: ");
    itemType = (typeStr.trim() || "product") as "product" | "service";

    const unitStr = await prompt(rl, "  Unit [pcs]: ");
    unit = unitStr.trim() || "pcs";

    const spStr = await prompt(rl, "  Sale Price: ");
    if (spStr.trim()) salePrice = spStr.trim();

    const ppStr = await prompt(rl, "  Purchase Price: ");
    if (ppStr.trim()) purchasePrice = ppStr.trim();

    const taxStr = await prompt(rl, "  Tax % [0]: ");
    taxPercent = taxStr.trim() || "0";

    if (itemType === "product") {
      const stockStr = await prompt(rl, "  Opening Stock [0]: ");
      stockQuantity = stockStr.trim() || "0";
    }

    const hsnStr = await prompt(rl, "  HSN Code: ");
    if (hsnStr.trim()) hsn = hsnStr.trim();

    const catStr = await prompt(rl, "  Category: ");
    if (catStr.trim()) category = catStr.trim();

    rl.close();
  }

  if (!name) fatalError("--name is required", EXIT.USAGE);

  try {
    const item = await client.item.create({
      name, unit, salePrice, purchasePrice, taxPercent,
      stockQuantity, hsn, category, itemType,
    });

    if (opts.json) {
      outputJSON(item);
      return;
    }

    success(`Created: ${item.name} (${item.itemType})`);
    console.log(`  ID: ${item.id}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

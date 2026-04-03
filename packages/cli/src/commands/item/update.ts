import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface UpdateOpts {
  name?: string;
  salePrice?: string;
  purchasePrice?: string;
  taxPercent?: string;
  hsn?: string;
  unit?: string;
  category?: string;
  sku?: string;
  lowStockAlert?: string;
  json?: boolean;
}

export async function itemUpdateCommand(id: string, opts: UpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Only send explicitly provided fields
  const data: Record<string, unknown> = {};
  if (opts.name !== undefined) data["name"] = opts.name;
  if (opts.salePrice !== undefined) data["salePrice"] = opts.salePrice;
  if (opts.purchasePrice !== undefined) data["purchasePrice"] = opts.purchasePrice;
  if (opts.taxPercent !== undefined) data["taxPercent"] = opts.taxPercent;
  if (opts.hsn !== undefined) data["hsn"] = opts.hsn;
  if (opts.unit !== undefined) data["unit"] = opts.unit;
  if (opts.category !== undefined) data["category"] = opts.category;
  if (opts.sku !== undefined) data["sku"] = opts.sku;
  if (opts.lowStockAlert !== undefined) data["lowStockAlert"] = opts.lowStockAlert;

  if (Object.keys(data).length === 0) {
    fatalError("No fields to update. Provide at least one option.", EXIT.USAGE);
  }

  try {
    const result = await client.item.update(id, data as Parameters<typeof client.item.update>[1]);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Updated item: ${result.name}`);
    console.log(`  ID: ${result.id}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

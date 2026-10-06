import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import type { InputOf } from "../../api-types.js";

interface VariantsUpdateOpts {
  sku?: string;
  salePrice?: string;
  purchasePrice?: string;
  stock?: string;
  lowStockAlert?: string;
  attributes?: string;
  json?: boolean;
}

export async function itemVariantsUpdateCommand(variantId: string, opts: VariantsUpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  let parsedAttributes: Record<string, string> | undefined;
  if (opts.attributes) {
    try {
      const raw: unknown = JSON.parse(opts.attributes);
      if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !Object.values(raw).every((v) => typeof v === "string")) {
        throw new Error("not a string map");
      }
      parsedAttributes = raw as Record<string, string>;
    } catch {
      fatalError('--attributes must be a JSON object of string values, e.g. \'{"size":"M"}\'', EXIT.USAGE);
    }
  }

  const data: InputOf<"item.updateVariant">["data"] = {};
  if (opts.sku !== undefined) data.sku = opts.sku;
  if (opts.salePrice !== undefined) data.salePrice = opts.salePrice;
  if (opts.purchasePrice !== undefined) data.purchasePrice = opts.purchasePrice;
  if (opts.stock !== undefined) data.stockQuantity = opts.stock;
  if (opts.lowStockAlert !== undefined) data.lowStockAlert = opts.lowStockAlert;
  if (parsedAttributes !== undefined) data.attributeValues = parsedAttributes;

  if (Object.keys(data).length === 0) {
    fatalError("No fields to update. Provide at least one option.", EXIT.USAGE);
  }

  try {
    const result = await client.item.updateVariant({ variantId, data });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Updated variant: ${variantId}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Variant not found: ${variantId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

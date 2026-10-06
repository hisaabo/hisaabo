import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface VariantsCreateOpts {
  sku?: string;
  salePrice?: string;
  purchasePrice?: string;
  stock?: string;
  lowStockAlert?: string;
  attributes?: string;
  json?: boolean;
}

export async function itemVariantsCreateCommand(itemId: string, opts: VariantsCreateOpts): Promise<void> {
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

  if (parsedAttributes === undefined) {
    fatalError("--attributes is required (JSON object, e.g. '{\"size\":\"M\"}')", EXIT.USAGE);
  }

  try {
    const result = await client.item.createVariant({
      itemId,
      variant: {
        attributeValues: parsedAttributes,
        sku: opts.sku,
        salePrice: opts.salePrice,
        purchasePrice: opts.purchasePrice,
        stockQuantity: opts.stock,
        lowStockAlert: opts.lowStockAlert,
      },
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Created variant: ${result.id}`);
    if (result.sku) console.log(`  SKU: ${result.sku}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${itemId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

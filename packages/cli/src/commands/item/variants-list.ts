import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV,
  EXIT, type ColumnDef,
} from "../../output.js";
import { formatAmount } from "../../format.js";

interface VariantsListOpts {
  json?: boolean;
  format?: string;
}

interface VariantRow {
  id: string;
  sku: string;
  salePrice: string;
  purchasePrice: string;
  stockQuantity: string;
  attributes: string;
}

export async function itemVariantsListCommand(itemId: string, opts: VariantsListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const result = await client.item.listVariants({ itemId });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const variants: VariantRow[] = Array.isArray(result?.variants) ? result.variants : (Array.isArray(result) ? result : []);

    console.log(`\n  Variants for item: ${itemId}\n`);

    const cols: ColumnDef<VariantRow>[] = [
      { key: "id", header: "ID", width: 12 },
      { key: "sku", header: "SKU", width: 14 },
      { key: "salePrice", header: "Sale (₹)", align: "right", width: 12, format: (v) => v ? formatAmount(String(v)) : "-" },
      { key: "purchasePrice", header: "Purchase (₹)", align: "right", width: 14, format: (v) => v ? formatAmount(String(v)) : "-" },
      { key: "stockQuantity", header: "Stock", align: "right", width: 10, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "attributes", header: "Attributes", width: 20, format: (v) => v ? JSON.stringify(v) : "-" },
    ];

    if (opts.format === "tsv") outputTSV(variants, cols);
    else if (opts.format === "csv") outputCSV(variants, cols);
    else outputTable(variants, cols);

    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Item not found: ${itemId}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

/**
 * Shared invoice/document line-item schema and mapping to the API contract.
 *
 * The API names the billed text `itemName` (max 200); the tool keeps the
 * model-friendly `description` input and maps it here. `taxPercent` is only
 * sent when the caller supplied it or it can be resolved from the linked item,
 * so a tax rate is never silently defaulted to 0.
 */

import { z } from "zod";
import type { HisaaboClient, InvoiceLineItemInput } from "../client.js";

export const lineItemShape = {
  description: z.string().min(1).max(200)
    .describe("Product or service name as printed on the invoice (max 200 chars)."),
  quantity: z.string().regex(/^\d+(\.\d{1,3})?$/)
    .describe("Quantity as decimal string, e.g. '1.000', '7.500', '100'."),
  unit_price: z.string().regex(/^\d+(\.\d{1,2})?$/)
    .describe("Price per unit as decimal string, e.g. '250.00', '15000.00'."),
  tax_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
    .describe("GST/tax rate percentage as decimal string: '0', '5.00', '12.00', '18.00', '28.00'. Omit to use the linked item's rate (when item_id is set) or the server default of 0."),
  discount_percent: z.string().regex(/^\d+(\.\d{1,2})?$/).optional()
    .describe("Line-level discount percentage, e.g. '10.00' for 10% off. Omit for no discount."),
  item_id: z.string().uuid().optional()
    .describe("Link to an inventory item UUID to update stock and inherit its tax rate (optional)."),
};

export const lineItemSchema = z.object(lineItemShape);
export type McpLineItem = z.infer<typeof lineItemSchema>;

export async function toApiLineItems(
  client: Pick<HisaaboClient, "item">,
  items: readonly McpLineItem[],
): Promise<InvoiceLineItemInput[]> {
  const itemTax = new Map<string, string | undefined>();
  const out: InvoiceLineItemInput[] = [];
  for (const li of items) {
    let taxPercent = li.tax_percent;
    if (taxPercent === undefined && li.item_id) {
      if (!itemTax.has(li.item_id)) {
        const item = await client.item.get(li.item_id).catch(() => null);
        itemTax.set(li.item_id, item?.taxPercent ?? undefined);
      }
      taxPercent = itemTax.get(li.item_id);
    }
    out.push({
      itemId: li.item_id,
      itemName: li.description,
      quantity: li.quantity,
      unitPrice: li.unit_price,
      ...(taxPercent !== undefined ? { taxPercent } : {}),
      ...(li.discount_percent !== undefined ? { discountPercent: li.discount_percent } : {}),
    });
  }
  return out;
}

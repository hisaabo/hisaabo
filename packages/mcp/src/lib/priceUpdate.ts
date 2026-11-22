/**
 * "Also update the item prices": shared by invoice_create and invoice_update.
 *
 * The caller (an agent) opting in with `update_item_prices: true` is the
 * confirmation; the rules are the shared ones the web and mobile dialogs use
 * (packages/shared/src/price-propagation.ts) and the write is the server's
 * `item.updatePricesFromDocument`, which checks Item:update, business scope and
 * audits it with source "mcp". It never throws: the invoice is already saved, so
 * the outcome rides along in the tool result as `itemPriceUpdate`.
 */

import {
  propagateBillPrices,
  type PriceSide,
  type PricePropagationClient,
  type PricePropagationOutcome,
  type PricingCatalogItem,
} from "@hisaabo/shared";
import type { HisaaboClient, InvoiceLineItemInput } from "../client.js";

export const UPDATE_ITEM_PRICES_DESCRIPTION =
  "When true, after the invoice is saved also update the saved price of every linked item (item_id) whose unit_price differs from the item's current price: the selling price on a sale, the purchase price on a purchase. " +
  "The invoice is saved either way; the result's itemPriceUpdate says what changed (or why nothing did, e.g. the key's role cannot update items). " +
  "Leave it off for a one-off or negotiated price. Invoices only (not quotations, notes or returns); lines with a discount still compare the unit_price, not the discounted net.";

function priceClient(client: Pick<HisaaboClient, "item">): PricePropagationClient {
  return {
    getItem: (id) => client.item.get(id).catch(() => null) as unknown as Promise<PricingCatalogItem | null>,
    applyUpdates: (input) => client.item.updatePricesFromDocument(input),
  };
}

export function propagateFromInvoice(
  client: Pick<HisaaboClient, "item">,
  saved: { id: string; documentType: string; type: PriceSide },
  lines: readonly InvoiceLineItemInput[] | undefined,
): Promise<PricePropagationOutcome> {
  if (!lines) {
    return Promise.resolve({
      status: "not_applicable",
      updated: [],
      skipped: [],
      message: "No line_items were supplied, so there are no rates to compare with the saved item prices.",
    });
  }
  return propagateBillPrices({
    client: priceClient(client),
    documentType: saved.documentType,
    side: saved.type,
    documentId: saved.id,
    lines: lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice })),
  });
}

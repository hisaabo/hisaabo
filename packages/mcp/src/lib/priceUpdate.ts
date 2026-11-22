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
  "Leave it off for a one-off or negotiated price. Invoices only (not quotations, notes or returns); lines with a discount still compare the unit_price, not the discounted net. " +
  "On invoice_update a line resent at the rate it already had on the saved invoice is not a price change.";

function priceClient(client: Pick<HisaaboClient, "item">): PricePropagationClient {
  return {
    getItem: (id) => client.item.get(id).catch(() => null) as unknown as Promise<PricingCatalogItem | null>,
    applyUpdates: (input) => client.item.updatePricesFromDocument(input),
  };
}

/** The rates a saved bill held before an edit: the baseline a resent line is compared with. */
export interface SavedBillLine {
  itemId?: string | null;
  unitPrice: string;
  selectedUnit?: string | null;
  variantId?: string | null;
}

/**
 * The saved bill's lines, read BEFORE `invoice_update` replaces them, or null when they cannot be read
 * (the caller then compares nothing: without the baseline a resent, unchanged line is indistinguishable
 * from an edited one and would write the bill's old rate over a catalog price that moved on since).
 */
export async function loadBillBaseline(client: Pick<HisaaboClient, "invoice">, invoiceId: string): Promise<SavedBillLine[] | null> {
  try {
    const bill = (await client.invoice.get(invoiceId)) as { lineItems?: ReadonlyArray<SavedBillLine> } | null;
    if (!bill) return null;
    return (bill.lineItems ?? []).map((l) => ({
      itemId: l.itemId ?? null,
      unitPrice: l.unitPrice,
      selectedUnit: l.selectedUnit ?? null,
      variantId: l.variantId ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Seed `originalUnitPrice` on the lines of an edited bill from the bill as it was saved: the n-th resent line of an
 * item is matched with the n-th saved base-unit line of that item. A line that keeps its saved rate is then "not
 * edited" (the rule that makes an unchanged line propose nothing); a changed rate is a real edit; a line with no
 * saved counterpart is new and is compared with the catalog price as on create. (MCP lines carry no unit or variant,
 * so only the saved base-unit lines can match.)
 */
export function withSavedBaseline(
  lines: readonly InvoiceLineItemInput[],
  previous: readonly SavedBillLine[],
): Array<{ itemId?: string | null; unitPrice: string; taxPercent?: string | null; originalUnitPrice?: string }> {
  const queues = new Map<string, string[]>();
  for (const p of previous) {
    if (!p.itemId || p.selectedUnit || p.variantId) continue;
    const q = queues.get(p.itemId) ?? [];
    q.push(p.unitPrice);
    queues.set(p.itemId, q);
  }
  return lines.map((l) => {
    const saved = l.itemId ? queues.get(l.itemId)?.shift() : undefined;
    return {
      itemId: l.itemId,
      unitPrice: l.unitPrice,
      taxPercent: l.taxPercent,
      ...(saved !== undefined ? { originalUnitPrice: saved } : {}),
    };
  });
}

/**
 * `previous`: for `invoice_update`, the saved bill's lines read before the update (see `loadBillBaseline`), or null
 * when they could not be read. Omit for `invoice_create` (every line is new).
 */
export function propagateFromInvoice(
  client: Pick<HisaaboClient, "item">,
  saved: { id: string; documentType: string; type: PriceSide },
  lines: readonly InvoiceLineItemInput[] | undefined,
  previous?: readonly SavedBillLine[] | null,
): Promise<PricePropagationOutcome> {
  if (!lines) {
    return Promise.resolve({
      status: "not_applicable",
      updated: [],
      skipped: [],
      message: "No line_items were supplied, so there are no rates to compare with the saved item prices.",
    });
  }
  if (previous === null) {
    return Promise.resolve({
      status: "failed",
      updated: [],
      skipped: [],
      message:
        "The invoice was updated, but its previous lines could not be read, so no rate was compared with the saved item prices and no item price was changed.",
    });
  }
  return propagateBillPrices({
    client: priceClient(client),
    documentType: saved.documentType,
    side: saved.type,
    documentId: saved.id,
    lines: previous
      ? withSavedBaseline(lines, previous)
      : lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice, taxPercent: l.taxPercent })),
  });
}

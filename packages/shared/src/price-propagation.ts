/**
 * Price propagation: turning the rates typed on a bill into proposed updates of
 * the catalog prices ("Update saved prices?").
 *
 * One pure function, used by every surface that offers the prompt (web, mobile,
 * CLI `--update-item-prices`, MCP `update_item_prices`), so they all decide the
 * same way. The server never trusts it: `item.updatePricesFromDocument`
 * re-validates every update against the live catalog.
 *
 * The rules, in the order they are applied to each line:
 *
 *  1. A line with no catalog item is ignored (free-text line).
 *  2. EDITED RATE ONLY. When the caller knows the rate the field held when the
 *     line was added or loaded (`originalUnitPrice`), a line whose rate still
 *     equals it is ignored. That is what stops "edit an old bill" from offering
 *     to revert every price that changed in the catalog since. Callers with no
 *     such baseline (CLI / MCP, where the rate is always typed explicitly) omit
 *     it and every linked line counts as edited.
 *  3. THE RATE FIELD, NEVER THE NET. A line-level discount is not part of the
 *     rate; `discountPercent` is deliberately not read. A discounted line whose
 *     rate was not touched proposes nothing; one whose rate was changed proposes
 *     that rate, not the discounted amount.
 *  4. The target price is the one the rate field was filled from:
 *       - base unit        -> item.salePrice / item.purchasePrice
 *       - alternate unit   -> that unit's own salePrice / purchasePrice in
 *                             item.unitVariants (alt units carry explicit prices,
 *                             so there is nothing to convert and nothing to drift)
 *       - product variant  -> that variant's salePrice / purchasePrice
 *     If the line's unit or conversion factor no longer matches the item (a unit
 *     renamed, a base unit switched, a variant removed or never chosen) the line
 *     is ambiguous and is SKIPPED with a note instead of guessing.
 *  5. TAX BASIS. A bill rate is always TAX-EXCLUSIVE. A sale price saved
 *     "including tax" (items.tax_inclusive; purchase prices are never inclusive,
 *     see inclusive-price.ts) was converted down to its exclusive rate when it
 *     was put on the bill, so the rate is converted back UP at the line's GST
 *     rate before it is compared with the saved price, and the proposal is in the
 *     saved price's own basis (`priceIncludesTax`); the dialog labels it. A
 *     caller that states a different basis is converted by the server at the
 *     item's tax rate.
 *  6. A zero rate (a free sample) never proposes a price, and a rate equal to
 *     the stored price proposes nothing.
 *  7. One slot priced differently on several lines is ambiguous: skipped.
 */

import { money } from "./money.js";
import { exclusiveRateFromInclusive, inclusiveFromExclusive, priceIsTaxInclusive } from "./inclusive-price.js";

/** Document types whose line rates may propose a catalog price update. */
export const PRICE_PROPAGATION_DOCUMENT_TYPES = ["invoice"] as const;

/**
 * Only the document that fixes the price actually charged or paid (a sale or
 * purchase invoice) proposes updates. Quotations, proformas and delivery
 * challans are offers and movement notes, usually priced per customer, and the
 * invoice they convert into asks; credit / debit notes and returns copy the
 * original invoice's rates, so a change there is an adjustment, not a new price.
 */
export function supportsPricePropagation(documentType: string | null | undefined): boolean {
  return (PRICE_PROPAGATION_DOCUMENT_TYPES as readonly string[]).includes(documentType ?? "");
}

export const priceSides = ["sale", "purchase"] as const;
export type PriceSide = (typeof priceSides)[number];

/** The slice of a catalog item the decision needs (a subset of `item.getById`). */
export interface PricingCatalogItem {
  id: string;
  name: string;
  /** Base unit. */
  unit: string;
  itemMode?: string | null;
  salePrice?: string | null;
  purchasePrice?: string | null;
  /** GST rate of the item: the fallback when a line carries no tax rate of its own. */
  taxPercent?: string | null;
  taxInclusive?: boolean | null;
  unitVariants?: ReadonlyArray<{
    unit: string;
    conversionFactor: number | string;
    salePrice?: string | null;
    purchasePrice?: string | null;
  }> | null;
  variants?: ReadonlyArray<{
    id: string;
    attributeValues?: Record<string, string> | null;
    salePrice?: string | null;
    purchasePrice?: string | null;
  }> | null;
}

/** A bill line as the forms hold it (extra fields are ignored; `discountPercent` is never read). */
export interface PriceLineInput {
  itemId?: string | null;
  variantId?: string | null;
  selectedUnit?: string | null;
  conversionFactor?: string | null;
  /** The rate field (tax-exclusive). */
  unitPrice: string;
  /** The line's GST %: what an inclusive price is converted back at. Falls back to the item's. */
  taxPercent?: string | null;
  /** What the rate field held when the line was added or loaded; omit when unknown. */
  originalUnitPrice?: string | null;
}

export interface PriceUpdateProposal {
  /** Stable per (item, variant, unit, side): the checkbox key. */
  key: string;
  itemId: string;
  variantId?: string;
  /** Alternate unit whose own price changes; absent for the base unit and variants. */
  unit?: string;
  side: PriceSide;
  itemName: string;
  /** Catalog name plus unit or variant, e.g. "Basmati Rice (5 kg)". */
  label: string;
  /** Stored price now (null when the slot has no price yet). */
  oldPrice: string | null;
  newPrice: string;
  /** Basis of both prices: true when the saved price (and so the proposal) includes GST. */
  priceIncludesTax: boolean;
}

export interface PriceUpdateSkip {
  itemName: string;
  reason: string;
}

export interface PricePropagationResult {
  proposals: PriceUpdateProposal[];
  skipped: PriceUpdateSkip[];
}

const RATE_RE = /^\d{1,13}(\.\d{1,2})?$/;

function toRate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!RATE_RE.test(v)) return null;
  return money.add(v, "0");
}

function sameNumber(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a == null || b == null || a === "" || b === "") return false;
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1e-9;
}

export function priceUpdateKey(u: { itemId: string; variantId?: string | null; unit?: string | null; side: PriceSide }): string {
  return `${u.side}:${u.itemId}:${u.variantId ?? ""}:${u.unit ?? ""}`;
}

/** The input of one `item.updatePricesFromDocument` update, from an accepted proposal. */
export function proposalToUpdate(p: PriceUpdateProposal) {
  return {
    itemId: p.itemId,
    ...(p.variantId ? { variantId: p.variantId } : {}),
    ...(p.unit ? { unit: p.unit } : {}),
    side: p.side,
    newPrice: p.newPrice,
    priceIncludesTax: p.priceIncludesTax,
  };
}

export function proposePriceUpdates(input: {
  side: PriceSide;
  lines: readonly PriceLineInput[];
  items: readonly PricingCatalogItem[];
}): PricePropagationResult {
  const { side } = input;
  const priceKey = side === "sale" ? "salePrice" : "purchasePrice";
  const itemById = new Map(input.items.map((i) => [i.id, i]));

  const proposals = new Map<string, PriceUpdateProposal>();
  const conflicted = new Map<string, PriceUpdateSkip>();
  const skipped: PriceUpdateSkip[] = [];

  for (const line of input.lines) {
    // 1. only catalog-linked lines
    if (!line.itemId) continue;
    const item = itemById.get(line.itemId);
    if (!item) continue;

    // 2. the rate must have been edited (when we can tell)
    if (line.originalUnitPrice != null && sameNumber(line.originalUnitPrice, line.unitPrice)) continue;

    // 6a. a rate that is not a valid, positive amount proposes nothing
    const rate = toRate(line.unitPrice);
    if (rate === null || !money.isPositive(rate)) continue;

    // 4. which stored price did this rate come from?
    const unitName = (line.selectedUnit ?? "").trim();
    let stored: string | null;
    let unit: string | undefined;
    let variantId: string | undefined;
    let label = item.name;

    if (item.itemMode === "variants") {
      const variant = item.variants?.find((v) => v.id === line.variantId);
      if (!line.variantId || !variant) {
        skipped.push({
          itemName: item.name,
          reason: line.variantId
            ? "this variant is no longer on the item"
            : "no variant is selected, so there is no variant price to update",
        });
        continue;
      }
      variantId = variant.id;
      stored = variant[priceKey] ?? null;
      const attrs = Object.values(variant.attributeValues ?? {}).join(" / ");
      label = attrs ? `${item.name} (${attrs})` : item.name;
    } else if (unitName && unitName !== item.unit) {
      const altUnit = item.unitVariants?.find((u) => u.unit === unitName);
      if (!altUnit) {
        skipped.push({ itemName: `${item.name} (${unitName})`, reason: `"${unitName}" is no longer one of this item's units` });
        continue;
      }
      if (line.conversionFactor && !sameNumber(line.conversionFactor, altUnit.conversionFactor)) {
        skipped.push({ itemName: `${item.name} (${unitName})`, reason: "the unit's conversion changed since this line was added" });
        continue;
      }
      unit = altUnit.unit;
      stored = altUnit[priceKey] ?? null;
      label = `${item.name} (${unit})`;
    } else {
      if (line.conversionFactor && !sameNumber(line.conversionFactor, 1)) {
        skipped.push({ itemName: item.name, reason: "the line's unit conversion does not match the item's base unit" });
        continue;
      }
      stored = item[priceKey] ?? null;
    }

    // The saved price may include GST while the rate cannot: compare in the saved price's basis.
    const inclusive = priceIsTaxInclusive(item, side);
    let candidate = rate;
    if (inclusive) {
      const taxPercent = line.taxPercent ?? item.taxPercent ?? "0";
      try {
        candidate = inclusiveFromExclusive(rate, taxPercent);
        // 6b'. The conversion is lossy: the rate a saved inclusive price derives to (₹1.02 at 18% -> 0.86) converts
        // BACK to a different price (0.86 -> ₹1.01). A line at exactly the rate the saved price derives to is the
        // saved price, not an edit: compare in the rate's basis too, so a paisa is never rewritten for nothing.
        if (stored !== null && sameNumber(exclusiveRateFromInclusive(stored, taxPercent), rate)) continue;
      } catch {
        continue; // a tax rate that is not a plain number: nothing safe to propose
      }
    }

    // 6b. same as the stored price: nothing to propose
    if (stored !== null && sameNumber(stored, candidate)) continue;

    const proposal: PriceUpdateProposal = {
      key: "",
      itemId: item.id,
      ...(variantId ? { variantId } : {}),
      ...(unit ? { unit } : {}),
      side,
      itemName: item.name,
      label,
      oldPrice: stored === null ? null : money.add(stored, "0"),
      newPrice: candidate,
      priceIncludesTax: inclusive,
    };
    proposal.key = priceUpdateKey(proposal);

    // 7. the same slot at two different rates is ambiguous
    // (compared as PRICES in the saved basis: for an inclusive item `rate` is the exclusive rate, the proposal holds the
    // inclusive price, and two lines at the same rate propose the same price, which is not a conflict)
    const earlier = proposals.get(proposal.key);
    if (earlier && !sameNumber(earlier.newPrice, candidate)) {
      proposals.delete(proposal.key);
      conflicted.set(proposal.key, { itemName: label, reason: "it is billed at different prices on this bill" });
    } else if (!conflicted.has(proposal.key)) {
      proposals.set(proposal.key, proposal);
    }
  }

  return { proposals: [...proposals.values()], skipped: [...skipped, ...conflicted.values()] };
}

/**
 * Item price after a basis conversion: `price` is stated including (`fromIncludesTax`
 * true) or excluding tax, the item stores prices in the other basis. Exact integer-paise
 * arithmetic. Used by the server when a caller declares a basis different from the item's.
 */
export function convertPriceBasis(price: string, taxPercent: string | number, fromIncludesTax: boolean): string {
  return fromIncludesTax ? exclusiveRateFromInclusive(price, taxPercent) : inclusiveFromExclusive(price, taxPercent);
}

// ── Orchestration for clients without a dialog (CLI, MCP) ─────────────────────

/** The two API calls `propagateBillPrices` needs, supplied by the CLI / MCP client. */
export interface PricePropagationClient {
  /** `item.getById`: null when the item does not exist. */
  getItem(id: string): Promise<PricingCatalogItem | null>;
  /** `item.updatePricesFromDocument`. */
  applyUpdates(input: {
    documentId: string;
    updates: ReturnType<typeof proposalToUpdate>[];
  }): Promise<{
    updated: Array<{ label: string; side: PriceSide; oldPrice: string | null; newPrice: string }>;
    unchanged: Array<{ label: string; side: PriceSide; oldPrice: string | null; newPrice: string }>;
  }>;
}

export type PricePropagationStatus = "updated" | "nothing_to_update" | "not_applicable" | "failed";

export interface PricePropagationOutcome {
  status: PricePropagationStatus;
  /** Catalog prices that were changed. */
  updated: Array<{ label: string; side: PriceSide; oldPrice: string | null; newPrice: string }>;
  /** Lines that changed but could not be offered, with the reason. */
  skipped: PriceUpdateSkip[];
  /** Why nothing was updated (not applicable / failed). */
  message?: string;
}

/**
 * "--update-item-prices" / `update_item_prices`: after the bill is saved, update the
 * catalog price of every linked item whose rate differs from the saved price.
 * There is nobody to ask, so the caller opting in is the confirmation; everything
 * else is the same rules and the same server procedure as the dialog.
 *
 * NEVER throws: the bill is already saved, so a failure (no permission, an item
 * deleted meanwhile, the network) is reported in the outcome and nothing else.
 */
export async function propagateBillPrices(input: {
  client: PricePropagationClient;
  documentType: string;
  side: PriceSide;
  documentId: string;
  lines: readonly PriceLineInput[];
}): Promise<PricePropagationOutcome> {
  if (!supportsPricePropagation(input.documentType)) {
    return {
      status: "not_applicable",
      updated: [],
      skipped: [],
      message: `Item prices are updated from invoices only, not from a ${input.documentType.replace(/_/g, " ")}.`,
    };
  }
  try {
    const itemIds = [...new Set(input.lines.map((l) => l.itemId).filter((id): id is string => !!id))];
    const fetched = await Promise.all(itemIds.map((id) => input.client.getItem(id)));
    const items = fetched.filter((i): i is PricingCatalogItem => !!i);
    const { proposals, skipped } = proposePriceUpdates({ side: input.side, lines: input.lines, items });
    if (proposals.length === 0) return { status: "nothing_to_update", updated: [], skipped };
    const res = await input.client.applyUpdates({ documentId: input.documentId, updates: proposals.map(proposalToUpdate) });
    return { status: res.updated.length > 0 ? "updated" : "nothing_to_update", updated: res.updated, skipped };
  } catch (err) {
    return {
      status: "failed",
      updated: [],
      skipped: [],
      message: `The bill was saved, but item prices were not updated: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

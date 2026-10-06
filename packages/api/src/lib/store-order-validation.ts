/** Validation helpers for the public store order/identify endpoints. */

export const MAX_ORDER_ITEMS = 100;
export const MAX_ITEM_QUANTITY = 10_000;

/** Returns an error message, or null when the items array is acceptable. */
export function validateOrderItemsShape(orderItems: unknown): string | null {
  if (!Array.isArray(orderItems) || orderItems.length === 0) {
    return "items array is required and must not be empty";
  }
  if (orderItems.length > MAX_ORDER_ITEMS) {
    return `An order can contain at most ${MAX_ORDER_ITEMS} items`;
  }
  for (const it of orderItems) {
    if (typeof it !== "object" || it === null) return "Invalid item in items array";
    const item = it as Record<string, unknown>;
    if (typeof item.itemId !== "string") return "Each item must have an itemId";
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return "Each item must have a positive quantity";
    if (qty > MAX_ITEM_QUANTITY) return `Quantity per item must not exceed ${MAX_ITEM_QUANTITY}`;
    if (item.variantId !== undefined && typeof item.variantId !== "string") return "variantId must be a string";
    if (item.selectedUnit !== undefined && typeof item.selectedUnit !== "string") return "selectedUnit must be a string";
    if (item.conversionFactor !== undefined && (!Number.isFinite(Number(item.conversionFactor)) || Number(item.conversionFactor) <= 0)) {
      return "conversionFactor must be a positive number";
    }
  }
  return null;
}

/**
 * Normalise an Indian mobile number to exactly 10 digits. Accepts an optional
 * +91 / 91 / 0 prefix and separators; returns null for anything else.
 */
export function normalizeIndianMobile(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export interface StockLine {
  itemId: string;
  variantId?: string;
  quantity: string;
  conversionFactor?: string;
}

/**
 * Total stock (in base units) each order needs, keyed by variant id or item id.
 * Mirrors the decrement in POST /store/:slug/order: variant lines consume
 * `quantity`, other lines consume `quantity * conversionFactor`.
 */
export function aggregateStockDemand(lines: StockLine[]): { items: Map<string, number>; variants: Map<string, number> } {
  const items = new Map<string, number>();
  const variants = new Map<string, number>();
  for (const li of lines) {
    const qty = Number(li.quantity);
    if (li.variantId) {
      variants.set(li.variantId, (variants.get(li.variantId) ?? 0) + qty);
    } else {
      const cf = Number(li.conversionFactor || "1");
      items.set(li.itemId, (items.get(li.itemId) ?? 0) + qty * cf);
    }
  }
  return { items, variants };
}

/** Ids whose available stock is below the demanded amount. */
export function findInsufficientStock(
  demand: Map<string, number>,
  available: Map<string, string | number>,
): string[] {
  const short: string[] = [];
  for (const [id, need] of demand) {
    const have = Number(available.get(id) ?? 0);
    // numeric(15,3): compare at milli-unit precision to dodge float noise.
    if (Math.round(have * 1000) < Math.round(need * 1000)) short.push(id);
  }
  return short;
}

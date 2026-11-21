/**
 * Cart hand-off links and item deep links.
 *
 * A business's own website can list items from the public catalog and send the
 * shopper to the store with a prefilled cart:
 *
 *   https://store.hisaabo.in/<slug>#cart=<encodeURIComponent(JSON)>
 *   JSON = { "v": 1, "items": [{ "id", "qty", "variantId"?, "unit"? }] }
 *
 * The cart lives in the URL fragment so it never reaches a server or CDN log.
 * Nothing in the link is trusted beyond the ids, quantity, unit name and
 * variant id: every line is resolved against the live catalog, and the price,
 * name, stock and conversion factor all come from there.
 *
 * Everything here is pure (no DOM, no fetch, no React) so it can be unit tested.
 */
import type { CartItem, StoreItem } from "./types";
import { cartItemKey } from "./types";

export const CART_LINK_VERSION = 1;
/** Longest accepted raw fragment, `#cart=` included. */
export const MAX_FRAGMENT_LENGTH = 8 * 1024;
/** Most lines one link may carry. */
export const MAX_LINES = 50;
/** Largest quantity per line; the API rejects more than 10,000 per order line. */
export const MAX_QTY = 9999;
const MAX_UNIT_LENGTH = 64;

// Catalog item and variant ids are Postgres uuids.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface CartLinkLine {
  /** Catalog item id (lower-cased). */
  id: string;
  /** Whole number, 1..MAX_QTY. */
  qty: number;
  /** Catalog variant id, for items in variants mode. */
  variantId?: string;
  /** Alternate unit name exactly as the catalog lists it, for alt-unit items. */
  unit?: string;
}

export type CartLinkParse =
  /** The URL carries no `cart` fragment. */
  | { status: "none" }
  /** There is a `cart` fragment but it is malformed or over a limit. */
  | { status: "invalid" }
  | { status: "ok"; lines: CartLinkLine[] };

const NONE: CartLinkParse = { status: "none" };
const INVALID: CartLinkParse = { status: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse `location.hash`. Never throws.
 *
 * Rejects the whole link (`invalid`) on: a fragment over 8 KB, bad JSON, a
 * version other than 1, no lines or more than 50, or any line with a
 * non-UUID id/variantId, a quantity that is not a whole number >= 1, or a bad
 * unit. Quantities above 9999 are clamped. Lines naming the same
 * item/variant/unit are summed, so a link can never hold two lines for one
 * cart entry. Unknown extra fields are ignored.
 */
export function parseCartLink(hash: string): CartLinkParse {
  if (typeof hash !== "string") return NONE;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!/(^|&)cart=/.test(body)) return NONE;
  if (hash.length > MAX_FRAGMENT_LENGTH) return INVALID;

  let data: unknown;
  try {
    const raw = new URLSearchParams(body).get("cart");
    if (!raw) return INVALID;
    data = JSON.parse(raw);
  } catch {
    return INVALID;
  }

  if (!isRecord(data) || data.v !== CART_LINK_VERSION || !Array.isArray(data.items)) return INVALID;
  if (data.items.length === 0 || data.items.length > MAX_LINES) return INVALID;

  const lines = new Map<string, CartLinkLine>();
  for (const entry of data.items) {
    if (!isRecord(entry)) return INVALID;
    const { id, qty, variantId, unit } = entry;
    if (!isUuid(id)) return INVALID;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) return INVALID;
    if (variantId != null && !isUuid(variantId)) return INVALID;
    if (unit != null && (typeof unit !== "string" || unit.length === 0 || unit.length > MAX_UNIT_LENGTH)) {
      return INVALID;
    }

    const line: CartLinkLine = { id: id.toLowerCase(), qty: Math.min(qty, MAX_QTY) };
    if (variantId != null) line.variantId = (variantId as string).toLowerCase();
    if (unit != null) line.unit = unit as string;

    const key = `${line.id}|${line.variantId ?? ""}|${line.unit ?? ""}`;
    const existing = lines.get(key);
    if (existing) existing.qty = Math.min(existing.qty + line.qty, MAX_QTY);
    else lines.set(key, line);
  }
  return { status: "ok", lines: [...lines.values()] };
}

/** Item id from a `?item=<id>` query string, or null when absent or not a UUID. */
export function parseItemParam(search: string): string | null {
  const value = new URLSearchParams(search).get("item");
  return isUuid(value) ? value.toLowerCase() : null;
}

export type DropReason =
  /** The item is not in the store (never was, disabled, or deleted). */
  | "not_found"
  | "out_of_stock"
  /** The variant or unit named by the link is not offered for that item. */
  | "unavailable_option"
  /** A variants-mode item was named without a variant. */
  | "needs_option";

export interface DroppedLine {
  line: CartLinkLine;
  /** Item name when the item was found, plus the variant when one was named. */
  name?: string;
  reason: DropReason;
}

export interface ResolvedCartLink {
  /** Cart entries built from the live catalog, quantities from the link. */
  entries: CartItem[];
  dropped: DroppedLine[];
}

function isOrderable(item: StoreItem): boolean {
  // Same test the item card uses: allow-negative-stock stores report
  // `lowStock` for sold-out items they still accept orders for.
  return item.inStock || item.lowStock === true;
}

/**
 * Turn link lines into cart entries using the live catalog `items`. A line is
 * dropped when its item is missing, out of stock, or the variant/unit it names
 * does not exist. Price, conversion factor and the item snapshot are taken from
 * the catalog; only the quantity comes from the link.
 */
export function resolveCartLink(lines: CartLinkLine[], items: StoreItem[]): ResolvedCartLink {
  const byId = new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const entries: CartItem[] = [];
  const dropped: DroppedLine[] = [];

  for (const line of lines) {
    const item = byId.get(line.id);
    if (!item) {
      dropped.push({ line, reason: "not_found" });
      continue;
    }
    // Naming the item's own unit is the same as naming none.
    const unit = line.unit && line.unit !== item.unit ? line.unit : undefined;
    const mode = item.itemMode || "simple";

    if (mode === "variants") {
      if (unit) {
        dropped.push({ line, name: item.name, reason: "unavailable_option" });
        continue;
      }
      if (!line.variantId) {
        dropped.push({ line, name: item.name, reason: "needs_option" });
        continue;
      }
      const variant = item.variants?.find((v) => v.id.toLowerCase() === line.variantId);
      if (!variant) {
        dropped.push({ line, name: item.name, reason: "unavailable_option" });
        continue;
      }
      if (!variant.inStock) {
        const label = Object.values(variant.attributes).filter(Boolean).join(", ");
        dropped.push({ line, name: label ? `${item.name} (${label})` : item.name, reason: "out_of_stock" });
        continue;
      }
      entries.push({ item, quantity: line.qty, selectedVariantId: variant.id, effectivePrice: variant.price });
      continue;
    }

    if (line.variantId) {
      dropped.push({ line, name: item.name, reason: "unavailable_option" });
      continue;
    }

    if (unit) {
      const alt = mode === "alt_units" ? item.unitVariants?.find((u) => u.unit === unit) : undefined;
      if (!alt) {
        dropped.push({ line, name: item.name, reason: "unavailable_option" });
        continue;
      }
      if (!isOrderable(item)) {
        dropped.push({ line, name: item.name, reason: "out_of_stock" });
        continue;
      }
      entries.push({
        item,
        quantity: line.qty,
        selectedUnit: alt.unit,
        conversionFactor: alt.conversionFactor,
        effectivePrice: alt.price,
      });
      continue;
    }

    if (!isOrderable(item)) {
      dropped.push({ line, name: item.name, reason: "out_of_stock" });
      continue;
    }
    entries.push({ item, quantity: line.qty, effectivePrice: item.price });
  }

  return { entries, dropped };
}

/**
 * Merge resolved entries into the persisted cart. An entry for the same
 * item+variant+unit replaces the existing line in place with the link's
 * quantity (and the fresh catalog snapshot) rather than adding to it, so
 * opening the same link twice leaves the cart unchanged. Other entries are
 * appended; lines the link does not mention are left alone.
 */
export function mergeCartLink(cart: CartItem[], entries: CartItem[]): CartItem[] {
  const next = [...cart];
  for (const entry of entries) {
    const key = cartItemKey(entry);
    const idx = next.findIndex((c) => cartItemKey(c) === key);
    if (idx >= 0) next[idx] = entry;
    else next.push(entry);
  }
  return next;
}

export interface CartLinkNotice {
  kind: "success" | "warning" | "error";
  message: string;
  /** One line per dropped item. */
  details: string[];
}

const DROP_TEXT: Record<DropReason, string> = {
  not_found: "no longer available",
  out_of_stock: "out of stock",
  unavailable_option: "that option is no longer available",
  needs_option: "choose an option in the store",
};

/** Notice for a link that could not be parsed. */
export const INVALID_LINK_NOTICE: CartLinkNotice = {
  kind: "error",
  message: "This cart link couldn't be read.",
  details: [],
};

/** Notice for a link whose items could not be looked up (network or server error). */
export const UNREACHABLE_LINK_NOTICE: CartLinkNotice = {
  kind: "error",
  message: "This cart link couldn't be loaded. Please try again.",
  details: [],
};

export function describeCartLinkResult(applied: number, dropped: DroppedLine[]): CartLinkNotice {
  const details = dropped.map((d) => `${d.name ?? "An item"}: ${DROP_TEXT[d.reason]}`);
  if (applied === 0) {
    return { kind: "warning", message: "None of the items in this link are available.", details };
  }
  return {
    kind: details.length > 0 ? "warning" : "success",
    message: `${applied} ${applied === 1 ? "item" : "items"} added from a link`,
    details,
  };
}

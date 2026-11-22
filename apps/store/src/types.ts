export interface StoreConfig {
  business: {
    name: string;
    tagline?: string;
    accentColor?: string;
    minOrderAmount?: string;
    deliveryNote?: string;
    whatsappNumber?: string;
    /** True when customers must verify their phone by SMS code before ordering. */
    otpRequired?: boolean;
    currency: string;
    phone?: string;
    email?: string;
    city?: string;
    state?: string;
    address?: string;
    // Versioned path to the storefront logo, or null when the business has
    // no logo uploaded. Carries a `?v=<timestamp>` cache-buster so the
    // browser refreshes automatically when the owner changes the logo.
    logoUrl?: string | null;
  };
  items: StoreItem[];
  categories: string[];
}

/** One page of `/<slug>/catalog.json`; `total` counts all items matching the filters. */
export interface CatalogPage extends StoreConfig {
  total: number;
  page: number;
  limit: number;
}

/** One photo in an item's gallery, served from the API. */
export interface StoreImage {
  id: string;
  // Variant this photo is tagged to, or null when shared across all variants.
  variantId: string | null;
  isPrimary: boolean;
  sortOrder: number;
  alt: string | null;
  // API-relative path (prefix with assetUrl() before using as an <img> src).
  url: string;
}

export interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  unit: string;
  category?: string;
  inStock: boolean;
  /**
   * NOT "running low". The API sets this for items whose stock is zero or less
   * in a store that accepts orders anyway ("allow negative stock"): they are
   * `inStock` and `lowStock` together, so a store that holds no inventory
   * reports it on every item. See stock.ts.
   */
  lowStock?: boolean;
  /**
   * True only when the item tracks stock and its quantity is above zero but at
   * or below the owner's low-stock alert level. Optional and additive: an API
   * that predates it omits it, and the "Low stock" badge then stays hidden. For
   * an item sold in variants it is true when everything still buyable is low
   * (the variants carry their own flag). See stock.ts.
   */
  runningLow?: boolean;
  sortOrder: number;
  taxPercent?: string;
  taxInclusive?: boolean;
  // Full gallery (with variant tags) + a convenience thumbnail for the grid.
  images?: StoreImage[];
  primaryImageUrl?: string | null;
  itemMode: "simple" | "alt_units" | "variants";
  unitVariants?: Array<{
    unit: string;
    conversionFactor: number;
    price: string;
  }>;
  variantAttributes?: string[];
  variants?: Array<{
    id: string;
    attributes: Record<string, string>;
    price: string;
    inStock: boolean;
    /** This variant tracks stock, has some, and is at or below its alert level. */
    runningLow?: boolean;
  }>;
}

export interface CartItem {
  item: StoreItem;
  quantity: number;
  selectedUnit?: string;
  conversionFactor?: number;
  selectedVariantId?: string;
  effectivePrice: string;
}

/** Unique key for a cart entry — same item with different variant/unit = different entry */
export function cartItemKey(entry: CartItem): string {
  if (entry.selectedVariantId) return `${entry.item.id}::v::${entry.selectedVariantId}`;
  if (entry.selectedUnit) return `${entry.item.id}::u::${entry.selectedUnit}`;
  return entry.item.id;
}

export interface OrderResult {
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  message?: string;
}

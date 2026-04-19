export interface StoreConfig {
  business: {
    name: string;
    tagline?: string;
    accentColor?: string;
    minOrderAmount?: string;
    deliveryNote?: string;
    whatsappNumber?: string;
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

export interface StoreItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  unit: string;
  category?: string;
  inStock: boolean;
  lowStock?: boolean;
  sortOrder: number;
  taxPercent?: string;
  taxInclusive?: boolean;
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

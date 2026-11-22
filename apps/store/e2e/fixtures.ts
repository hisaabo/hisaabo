import type { CatalogPage, StoreImage, StoreItem } from "../src/types";

/**
 * A fixture catalog shaped like `GET /store/<slug>/catalog.json` for a farm
 * store that holds no inventory: every item has a zero stock quantity and the
 * business allows orders anyway, so the API reports `inStock: true` together
 * with `lowStock: true` on every item. Mostly image-less, one item with a photo.
 */
export const SLUG = "jaisa-organics";

const BASE = {
  inStock: true,
  lowStock: true,
  sortOrder: 0,
  itemMode: "simple" as const,
};

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function image(itemId: string, n: number): StoreImage {
  return {
    id: id(900 + n),
    variantId: null,
    isPrimary: true,
    sortOrder: 0,
    alt: null,
    url: `/store/${SLUG}/items/${itemId}/images/${id(900 + n)}?v=1`,
  };
}

export interface FixtureOptions {
  /** Give most items a photo (a photo-led store) instead of one. */
  photoLed?: boolean;
  /** Report real stock: items track inventory and none is low. */
  trackStock?: boolean;
  /** The business's accent colour (default: a green). */
  accent?: string;
}

export function buildItems(opts: FixtureOptions = {}): StoreItem[] {
  const stock = opts.trackStock ? { inStock: true, lowStock: false } : {};
  const items: StoreItem[] = [
    {
      ...BASE, ...stock, id: id(1), name: "Lakadong Turmeric Powder", category: "Spices",
      description: "Meghalaya turmeric, 7% curcumin. Stone-ground in small batches.",
      price: "1500.00", unit: "kg", itemMode: "alt_units",
      unitVariants: [{ unit: "pouch", conversionFactor: 0.5, price: "750.00" }],
    },
    {
      ...BASE, ...stock, id: id(2), name: "Raw Forest Honey", category: "Honey",
      description: "Unprocessed, from wild hives in the Western Ghats.",
      price: "320.00", unit: "jar", itemMode: "variants", variantAttributes: ["Size"],
      variants: [
        { id: id(21), attributes: { Size: "250 g" }, price: "320.00", inStock: true },
        { id: id(22), attributes: { Size: "500 g" }, price: "600.00", inStock: true },
        { id: id(23), attributes: { Size: "1 kg" }, price: "1150.00", inStock: true },
      ],
    },
    {
      ...BASE, ...stock, id: id(3), name: "A2 Desi Cow Ghee", category: "Dairy",
      description: "Bilona-churned from curd of desi cows.",
      price: "1800.00", unit: "litre", itemMode: "alt_units",
      unitVariants: [{ unit: "500 ml", conversionFactor: 0.5, price: "950.00" }],
    },
    {
      ...BASE, ...stock, id: id(4), name: "Cold-pressed Groundnut Oil", category: "Oils",
      price: "420.00", unit: "litre", itemMode: "alt_units",
      unitVariants: [{ unit: "5 litre", conversionFactor: 5, price: "2000.00" }],
    },
    { ...BASE, ...stock, id: id(5), name: "Jaggery Powder", category: "Staples", price: "120.00", unit: "kg", description: "Chemical-free, no bleaching." },
    { ...BASE, ...stock, id: id(6), name: "Black Rice", category: "Staples", price: "260.00", unit: "kg" },
    { ...BASE, ...stock, id: id(7), name: "Kashmiri Red Chilli Powder", category: "Spices", price: "640.50", unit: "kg", description: "Mild heat, deep colour." },
    { ...BASE, ...stock, id: id(8), name: "Moringa Leaf Powder", category: "Wellness", price: "499.00", unit: "250 g" },
    { ...BASE, ...stock, id: id(9), name: "Mixed Fruit Jam", category: "Wellness", price: "180.00", unit: "jar", description: "Sun-cooked, lightly sweetened." },
    { ...BASE, ...stock, id: id(10), name: "Stone-ground Whole Wheat Atta", category: "Staples", price: "70.00", unit: "kg" },
    { ...BASE, ...stock, id: id(11), name: "Rock Salt", category: "Spices", price: "45.00", unit: "kg" },
    { ...BASE, ...stock, id: id(12), name: "Hand-pounded Red Rice", category: "Staples", price: "95.00", unit: "kg" },
  ];

  // Photo positions (1-based): the jam only, or most of the catalog.
  const withImage = new Set(opts.photoLed ? [1, 2, 3, 4, 5, 6, 7, 9] : [9]);
  return items.map((item, i) => {
    const next: StoreItem = { ...item, sortOrder: i };
    if (withImage.has(i + 1)) {
      const img = image(item.id, i + 1);
      next.images = [img];
      next.primaryImageUrl = img.url;
    }
    return next;
  });
}

export function buildCatalog(opts: FixtureOptions = {}): CatalogPage {
  const items = buildItems(opts);
  return {
    business: {
      name: "Jaisa Organics",
      tagline: "Farm-fresh spices, honey and staples from our family farm",
      accentColor: opts.accent ?? "#2f7d4f",
      minOrderAmount: "1000.00",
      deliveryNote:
        "We hold no inventory: everything is packed fresh after you order. Delivery in 3 to 5 days across India.",
      whatsappNumber: "9876543210",
      otpRequired: false,
      currency: "INR",
      phone: "+91 98765 43210",
      email: "hello@jaisaorganics.example",
      city: "Pune",
      state: "Maharashtra",
      address: "Survey 41, Mulshi Road",
      logoUrl: null,
    },
    items,
    categories: ["Spices", "Honey", "Dairy", "Oils", "Staples", "Wellness"],
    total: items.length,
    page: 1,
    limit: 24,
  };
}

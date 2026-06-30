/** A product chosen to appear on the OG card. */
export interface OgSeller {
  itemId: string;
  name: string;
  /** Store-safe price as a numeric string (already COALESCEd store→sale). */
  price: string | null;
  /** Storage key for the primary image, or null when the item has no photo. */
  imageStorageKey: string | null;
  imageMimeType: string | null;
  /** Epoch ms of the image row's updatedAt — feeds the cache version hash. */
  imageVersion: number;
}

/** Everything the renderer needs to draw a store's OG card. */
export interface OgModel {
  storeName: string;
  tagline: string | null;
  /** Hex accent color, validated upstream (defaults applied). */
  accentColor: string;
  currency: string;
  /** data: URI for the logo, or null. */
  logoDataUri: string | null;
  /** Sellers with their image bytes resolved to data: URIs. */
  sellers: Array<{ name: string; price: string | null; imageDataUri: string | null }>;
  /** Public store URL shown in the footer (e.g. store.hisaabo.in/my-bakery). */
  storeUrl: string;
}

/** Per-store metadata used for <meta> injection and the image URL. */
export interface StoreMetaSummary {
  title: string;
  description: string;
  ogImageUrl: string;
  storeUrl: string;
  accentColor: string;
}

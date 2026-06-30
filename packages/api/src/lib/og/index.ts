import { createHash } from "node:crypto";
import { getStorage } from "../storage/index.js";
import { normalizeAccent } from "./meta.js";
import { renderOgPng } from "./render.js";
import { selectTopSellers, OG_SELLER_LIMIT } from "./top-sellers.js";
import type { OgModel, OgSeller } from "./types.js";

export { storeMetaSummary, injectStoreMeta, normalizeAccent, jsonLdScriptSafe, DEFAULT_ACCENT } from "./meta.js";
export type { StoreMetaSummary } from "./types.js";
export { OG_WIDTH, OG_HEIGHT } from "./render.js";

type Db = any;

export interface OgBusiness {
  name: string;
  storeTagline: string | null;
  storeAccentColor: string | null;
  currency: string | null;
  logoData: Buffer | null;
  logoMimeType: string | null;
  logoUpdatedAt: Date | null;
}

export interface OgRequest {
  db: Db;
  businessId: string;
  slug: string;
  business: OgBusiness;
  /** Public storefront base (no trailing slash) for the footer/URL. */
  storeBaseUrl: string;
}

export interface OgResult {
  png: Buffer;
  /** Content version — used as the ETag and cache key. */
  version: string;
  cached: boolean;
}

/** Format a store-safe price string for display on the card. */
function formatPrice(price: string | null, currency: string | null): string | null {
  if (price == null) return null;
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  const symbol = (currency ?? "INR") === "INR" ? "₹" : "";
  try {
    return `${symbol}${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  } catch {
    return `${symbol}${n}`;
  }
}

function toDataUri(bytes: Buffer | null, mime: string | null): string | null {
  if (!bytes || !mime) return null;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Content hash that changes whenever anything visible on the card changes:
 * store identity fields, logo version, and the chosen sellers (id + price +
 * image version). Lets us cache the PNG immutably and bust it precisely.
 */
function computeVersion(business: OgBusiness, sellers: OgSeller[]): string {
  const parts = [
    business.name,
    business.storeTagline ?? "",
    normalizeAccent(business.storeAccentColor),
    String(business.logoUpdatedAt?.getTime() ?? 0),
    business.currency ?? "",
    ...sellers.map((s) => `${s.itemId}:${s.price ?? ""}:${s.imageVersion}`),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * Produce a store's OG PNG, caching the rendered bytes in object storage keyed
 * by the content version. Cheap on a hit (one storage GET); on a miss it
 * resolves image bytes, renders via satori+resvg, and writes the PNG back.
 */
export async function getOrRenderStoreOg(req: OgRequest): Promise<OgResult> {
  const sellers = await selectTopSellers(req.db, req.businessId, OG_SELLER_LIMIT);
  const version = computeVersion(req.business, sellers);
  const cacheKey = `og/${req.businessId}/${version}.png`;
  const storage = getStorage();

  const hit = await storage.get(cacheKey).catch(() => null);
  if (hit) return { png: hit, version, cached: true };

  // Resolve image bytes → data URIs (logo from the businesses row; seller
  // photos from object storage).
  const logoDataUri = toDataUri(req.business.logoData, req.business.logoMimeType);
  const sellerModels: OgModel["sellers"] = await Promise.all(
    sellers.map(async (s) => {
      let imageDataUri: string | null = null;
      if (s.imageStorageKey) {
        const bytes = await storage.get(s.imageStorageKey).catch(() => null);
        imageDataUri = toDataUri(bytes, s.imageMimeType);
      }
      return { name: s.name, price: formatPrice(s.price, req.business.currency), imageDataUri };
    }),
  );

  const model: OgModel = {
    storeName: req.business.name?.trim() || "Online Store",
    tagline: req.business.storeTagline?.trim() || null,
    accentColor: normalizeAccent(req.business.storeAccentColor),
    currency: req.business.currency ?? "INR",
    logoDataUri,
    sellers: sellerModels,
    storeUrl: `${req.storeBaseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/${req.slug}`,
  };

  const png = await renderOgPng(model);
  await storage.put(cacheKey, png, { contentType: "image/png" }).catch(() => {
    // Caching is best-effort — a storage write failure shouldn't fail the image.
  });
  return { png, version, cached: false };
}

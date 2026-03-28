import type { StoreConfig, OrderResult } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "";

// In production: VITE_API_URL = "https://api.hisaabo.in" → calls /store/<slug>/...
// In dev: VITE_API_URL is empty → calls /<slug>/... → Vite proxy rewrites to /store/<slug>/...
const STORE_PREFIX = API_URL ? `${API_URL}/store` : "";

export async function fetchCatalog(slug: string): Promise<StoreConfig> {
  const res = await fetch(`${STORE_PREFIX}/${slug}/catalog.json`);
  if (!res.ok) throw new Error("Store not found");
  return res.json();
}

export async function placeOrder(
  slug: string,
  order: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    deliveryAddress?: string;
    deliveryCity?: string;
    deliveryPincode?: string;
    deliveryNotes?: string;
    items: Array<{
      itemId: string;
      quantity: number;
      selectedUnit?: string;
      conversionFactor?: number;
      variantId?: string;
    }>;
    turnstileToken?: string;
  }
): Promise<OrderResult> {
  const res = await fetch(`${STORE_PREFIX}/${slug}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Order failed" }));
    throw new Error(err.error || "Order failed");
  }
  return res.json();
}

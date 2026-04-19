import type { StoreConfig, OrderResult } from "./types";

const API_URL = import.meta.env.VITE_API_URL || "";

// In production: VITE_API_URL = "https://api.hisaabo.in" → calls /store/<slug>/...
// In dev: VITE_API_URL is empty → calls /<slug>/... → Vite proxy rewrites to /store/<slug>/...
const STORE_PREFIX = API_URL ? `${API_URL}/store` : "";

export async function fetchCatalog(slug: string): Promise<StoreConfig> {
  // `credentials: "omit"` — the store is fully public. Never attach the
  // admin session_id cookie from a same-origin self-hosted deploy. If we
  // ever did, the (now removed) global CSRF gate would trip and the
  // storefront would break on checkout.
  const res = await fetch(`${STORE_PREFIX}/${slug}/catalog.json`, {
    credentials: "omit",
  });
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
  // `credentials: "omit"` — never attach cookies. `X-Requested-With` is
  // defence in depth so the client keeps working if someone later
  // narrows the server's `/store/*` CSRF exemption.
  const res = await fetch(`${STORE_PREFIX}/${slug}/order`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "hisaabo",
    },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Order failed" }));
    throw new Error(err.error || "Order failed");
  }
  return res.json();
}

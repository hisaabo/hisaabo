import type { StoreConfig, OrderResult } from "./types";

const BASE = import.meta.env.VITE_API_URL || "";

export async function fetchCatalog(slug: string): Promise<StoreConfig> {
  const res = await fetch(`${BASE}/store/${slug}/api/catalog`);
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
    items: Array<{ itemId: string; quantity: number }>;
  }
): Promise<OrderResult> {
  const res = await fetch(`${BASE}/store/${slug}/api/orders`, {
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

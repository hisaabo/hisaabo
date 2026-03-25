import { useState, useEffect, useCallback } from "react";
import type { StoreConfig, CartItem, StoreItem, OrderResult } from "./types";
import { fetchCatalog } from "./api";
import { Header } from "./components/Header";
import { ItemGrid } from "./components/ItemGrid";
import { Cart } from "./components/Cart";
import { Checkout } from "./components/Checkout";
import { OrderConfirmation } from "./components/OrderConfirmation";

// Cart persistence key
const CART_KEY = "hisaabo-store-cart";

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

function saveCart(cart: CartItem[]) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    // ignore storage errors
  }
}

function applyAccentColor(hex?: string) {
  if (!hex) return;
  const root = document.documentElement;
  root.style.setProperty("--store-accent", hex);
  // Generate a darker hover shade (simple approach: overlay black at 10%)
  root.style.setProperty("--store-accent-hover", darkenHex(hex, 0.12));
  root.style.setProperty("--store-accent-light", lightenHex(hex, 0.88));

  // Update the browser theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", hex);
}

function darkenHex(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (v: number) => Math.max(0, Math.round(v * (1 - amount)));
  return `#${d(r).toString(16).padStart(2, "0")}${d(g).toString(16).padStart(2, "0")}${d(b).toString(16).padStart(2, "0")}`;
}

function lightenHex(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const l = (v: number) => Math.min(255, Math.round(v + (255 - v) * amount));
  return `#${l(r).toString(16).padStart(2, "0")}${l(g).toString(16).padStart(2, "0")}${l(b).toString(16).padStart(2, "0")}`;
}

type View = "browse" | "cart" | "checkout" | "confirmed";

export function App() {
  // Extract slug from URL: /store/<slug>/... or just /<slug>
  const [slug] = useState<string>(() => {
    // Support both /store/<slug> (production) and dev via /<slug>
    const path = window.location.pathname;
    const storeMatch = path.match(/^\/store\/([^/]+)/);
    if (storeMatch) return storeMatch[1];
    // Fallback: first path segment
    const parts = path.split("/").filter(Boolean);
    return parts[0] || "";
  });

  const [catalog, setCatalog] = useState<StoreConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [view, setView] = useState<View>("browse");
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");

  // Persist cart
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  // Fetch catalog
  useEffect(() => {
    if (!slug) {
      setError("No store found at this URL");
      setLoading(false);
      return;
    }

    fetchCatalog(slug)
      .then((data) => {
        setCatalog(data);
        applyAccentColor(data.business.accentColor);
        // Update page title
        document.title = `${data.business.name} — Online Store`;
      })
      .catch(() => setError("Store not found or unavailable"))
      .finally(() => setLoading(false));
  }, [slug]);

  const addToCart = useCallback((item: StoreItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === itemId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter((c) => c.item.id !== itemId);
      }
      return prev.map((c) =>
        c.item.id === itemId ? { ...c, quantity: c.quantity - 1 } : c
      );
    });
  }, []);

  const clearItem = useCallback((itemId: string) => {
    setCart((prev) => prev.filter((c) => c.item.id !== itemId));
  }, []);

  const handleOrderSuccess = useCallback((result: OrderResult) => {
    setOrderResult(result);
    setView("confirmed");
    setCart([]);
    saveCart([]);
  }, []);

  const handleContinueShopping = useCallback(() => {
    setOrderResult(null);
    setView("browse");
    setSearch("");
    setActiveCategory("");
  }, []);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh gap-4">
        <div
          className="w-12 h-12 rounded-2xl animate-pulse"
          style={{ background: "var(--store-accent)" }}
        />
        <p className="text-sm" style={{ color: "var(--store-muted)" }}>
          Loading store...
        </p>
      </div>
    );
  }

  // ── Error state ──
  if (error || !catalog) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh px-4 text-center">
        <span className="text-6xl mb-4">🏪</span>
        <h1
          className="text-xl font-bold mb-2"
          style={{ color: "var(--store-text)" }}
        >
          Store not found
        </h1>
        <p className="text-sm" style={{ color: "var(--store-muted)" }}>
          {error || "This store is not available."}
        </p>
      </div>
    );
  }

  // ── Order Confirmation ──
  if (view === "confirmed" && orderResult) {
    return (
      <OrderConfirmation
        result={orderResult}
        config={catalog}
        onContinueShopping={handleContinueShopping}
      />
    );
  }

  // ── Checkout ──
  if (view === "checkout") {
    return (
      <div className="max-w-2xl mx-auto">
        <div
          className="sticky top-0 z-10 px-4 py-3 border-b"
          style={{
            background: "var(--store-bg)",
            borderColor: "var(--store-border)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-2 h-6 rounded-full"
              style={{ background: "var(--store-accent)" }}
            />
            <h1
              className="font-bold text-base"
              style={{ color: "var(--store-text)" }}
            >
              {catalog.business.name}
            </h1>
          </div>
        </div>
        <Checkout
          cart={cart}
          config={catalog}
          slug={slug}
          onBack={() => setView("cart")}
          onSuccess={handleOrderSuccess}
        />
      </div>
    );
  }

  // ── Browse + Cart ──
  return (
    <div className="relative">
      {/* Main browse layout — on large screens, side-by-side with cart */}
      <div className="lg:flex lg:min-h-dvh">
        {/* Catalog column */}
        <div className="lg:flex-1 lg:min-w-0">
          <Header
            config={catalog}
            cart={cart}
            search={search}
            onSearchChange={setSearch}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            onCartClick={() => setView("cart")}
          />

          <main>
            <ItemGrid
              items={catalog.items}
              cart={cart}
              onAdd={addToCart}
              onRemove={removeFromCart}
              currency={catalog.business.currency}
              accentColor={catalog.business.accentColor}
              search={search}
              activeCategory={activeCategory}
            />
          </main>

          {/* Empty state for empty catalog */}
          {catalog.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
              <span className="text-5xl mb-4">📦</span>
              <p
                className="font-semibold"
                style={{ color: "var(--store-text)" }}
              >
                No items available yet
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--store-muted)" }}>
                Check back soon!
              </p>
            </div>
          )}

          {/* Bottom padding on mobile so floating cart bar doesn't cover content */}
          <div className="h-20 sm:h-0" />
        </div>

        {/* Cart sidebar — desktop only, always visible when items in cart */}
        {cart.length > 0 && (
          <div
            className="hidden lg:flex flex-col w-96 border-l sticky top-0 h-dvh"
            style={{ borderColor: "var(--store-border)" }}
          >
            <Cart
              cart={cart}
              config={catalog}
              onAdd={addToCart}
              onRemove={removeFromCart}
              onClearItem={clearItem}
              onClose={() => {}}
              onCheckout={() => setView("checkout")}
              inline
            />
          </div>
        )}
      </div>

      {/* Cart drawer — mobile + tablet (when view=cart) */}
      {view === "cart" && (
        <div className="lg:hidden">
          <Cart
            cart={cart}
            config={catalog}
            onAdd={addToCart}
            onRemove={removeFromCart}
            onClearItem={clearItem}
            onClose={() => setView("browse")}
            onCheckout={() => setView("checkout")}
          />
        </div>
      )}

      {/* Mobile floating cart bar — shown in browse view, below header */}
      {view === "browse" && cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-10 animate-slide-up">
          <button
            onClick={() => setView("cart")}
            className="w-full flex items-center justify-between px-5 py-4 text-white font-semibold"
            style={{ background: catalog.business.accentColor || "var(--store-accent)" }}
          >
            <span className="flex items-center gap-2.5">
              <span
                className="bg-white/20 rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold"
              >
                {cart.reduce((s, c) => s + c.quantity, 0)}
              </span>
              <span>
                {cart.reduce((s, c) => s + c.quantity, 0) === 1
                  ? "1 item in cart"
                  : `${cart.reduce((s, c) => s + c.quantity, 0)} items in cart`}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span>
                {catalog.business.currency === "INR" ? "₹" : catalog.business.currency}
                {cart
                  .reduce((s, c) => s + parseFloat(c.item.price) * c.quantity, 0)
                  .toFixed(0)}
              </span>
              <span>→</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

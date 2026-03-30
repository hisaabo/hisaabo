import { useState, useEffect, useCallback } from "react";
import type { StoreConfig, CartItem, OrderResult } from "./types";
import { cartItemKey } from "./types";
import { fetchCatalog } from "./api";
import { Header } from "./components/Header";
import { ItemGrid } from "./components/ItemGrid";
import { Cart } from "./components/Cart";
import { Checkout } from "./components/Checkout";
import { PhoneVerify } from "./components/PhoneVerify";
import { OrderConfirmation } from "./components/OrderConfirmation";
import { Footer } from "./components/Footer";

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
  // Generate a darker hover shade (simple approach: overlay black at 12%)
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

type View = "browse" | "cart" | "phone-verify" | "checkout" | "confirmed";

export function App() {
  // Extract slug from URL: /<slug> (store runs on its own subdomain)
  const [slug] = useState<string>(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] || "";
  });

  const [catalog, setCatalog] = useState<StoreConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [view, setView] = useState<View>("browse");
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  // Customer identity — set by PhoneVerify before Checkout
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

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
        document.title = `${data.business.name} \u2014 Online Store`;
      })
      .catch(() => setError("Store not found or unavailable"))
      .finally(() => setLoading(false));
  }, [slug]);

  const addToCart = useCallback((entry: Omit<CartItem, "quantity">) => {
    setCart((prev) => {
      const key = cartItemKey({ ...entry, quantity: 1 });
      const existingIdx = prev.findIndex((c) => cartItemKey(c) === key);
      if (existingIdx >= 0) {
        return prev.map((c, i) =>
          i === existingIdx ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...entry, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((key: string) => {
    setCart((prev) => {
      const existing = prev.find((c) => cartItemKey(c) === key);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter((c) => cartItemKey(c) !== key);
      }
      return prev.map((c) =>
        cartItemKey(c) === key ? { ...c, quantity: c.quantity - 1 } : c
      );
    });
  }, []);

  const clearItem = useCallback((key: string) => {
    setCart((prev) => prev.filter((c) => cartItemKey(c) !== key));
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
      <div
        className="flex flex-col items-center justify-center min-h-dvh gap-4"
        style={{ background: "var(--store-bg-secondary)" }}
      >
        <div className="relative">
          <div
            className="w-14 h-14 rounded-2xl animate-pulse"
            style={{ background: "var(--store-accent)", opacity: 0.2 }}
          />
          <div
            className="absolute inset-0 w-14 h-14 rounded-2xl animate-pulse"
            style={{
              background: "var(--store-accent)",
              animationDelay: "0.15s",
              opacity: 0.6,
            }}
          />
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--store-muted)" }}>
          Loading store...
        </p>
      </div>
    );
  }

  // ── Error state ──
  if (error || !catalog) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-dvh px-4 text-center"
        style={{ background: "var(--store-bg-secondary)" }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
          style={{ background: "var(--store-bg-alt)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="36"
            height="36"
            style={{ color: "var(--store-muted)" }}
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <h1
          className="text-xl font-bold mb-2"
          style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
        >
          Store not found
        </h1>
        <p
          className="text-sm max-w-xs"
          style={{ color: "var(--store-muted)" }}
        >
          {error || "This store is not available. Please check the URL and try again."}
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

  // ── Shared checkout header ──────────────────────────────────
  function CheckoutHeader() {
    return (
      <div
        className="sticky top-0 z-10 border-b"
        style={{
          background: "var(--store-bg)",
          borderColor: "var(--store-border)",
        }}
      >
        <div
          className="h-1"
          style={{ background: catalog!.business.accentColor || "var(--store-accent)" }}
        />
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div
            className="w-2 h-6 rounded-full flex-shrink-0"
            style={{ background: catalog!.business.accentColor || "var(--store-accent)" }}
          />
          <h1
            className="font-bold text-base truncate"
            style={{ color: "var(--store-text)" }}
          >
            {catalog!.business.name}
          </h1>
        </div>
      </div>
    );
  }

  // ── Phone Verify ──
  if (view === "phone-verify") {
    return (
      <div className="min-h-dvh" style={{ background: "var(--store-bg-secondary)" }}>
        <CheckoutHeader />
        <PhoneVerify
          slug={slug}
          accentColor={catalog.business.accentColor || "var(--store-accent)"}
          onBack={() => setView("cart")}
          onVerified={(phone, name, isNew, token) => {
            setCustomerPhone(phone);
            setCustomerName(name);
            setIsNewCustomer(isNew);
            setTurnstileToken(token);
            setView("checkout");
          }}
        />
      </div>
    );
  }

  // ── Checkout ──
  if (view === "checkout") {
    return (
      <div className="min-h-dvh" style={{ background: "var(--store-bg-secondary)" }}>
        <CheckoutHeader />
        <Checkout
          cart={cart}
          config={catalog}
          slug={slug}
          customerPhone={customerPhone}
          customerName={customerName}
          isNewCustomer={isNewCustomer}
          turnstileToken={turnstileToken}
          onBack={() => setView("phone-verify")}
          onSuccess={handleOrderSuccess}
        />
      </div>
    );
  }

  // ── Browse + Cart ──
  return (
    <div
      className="relative min-h-dvh"
      style={{ background: "var(--store-bg-secondary)" }}
    >
      {/* Main browse layout -- on large screens, side-by-side with cart */}
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
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              currency={catalog.business.currency}
              accentColor={catalog.business.accentColor}
              search={search}
              activeCategory={activeCategory}
            />
          </main>

          {/* Empty state for empty catalog */}
          {catalog.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mb-4"
                style={{ background: "var(--store-bg-alt)" }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="32"
                  height="32"
                  style={{ color: "var(--store-muted)" }}
                >
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <p
                className="font-semibold text-base"
                style={{ color: "var(--store-text)" }}
              >
                No items available yet
              </p>
              <p
                className="text-sm mt-1"
                style={{ color: "var(--store-muted)" }}
              >
                Check back soon!
              </p>
            </div>
          )}

          {/* Footer */}
          <Footer config={catalog} />

          {/* Bottom padding on mobile so floating cart bar does not cover content */}
          {cart.length > 0 && <div className="h-20 lg:h-0" />}
        </div>

        {/* Cart sidebar -- desktop only, always visible when items in cart */}
        {cart.length > 0 && (
          <div
            className="hidden lg:flex flex-col w-[380px] border-l sticky top-0 h-dvh flex-shrink-0"
            style={{
              borderColor: "var(--store-border)",
              background: "var(--store-bg)",
            }}
          >
            <Cart
              cart={cart}
              config={catalog}
              onAddToCart={addToCart}
              onRemoveFromCart={removeFromCart}
              onClearItem={clearItem}
              onClose={() => {}}
              onCheckout={() => setView("phone-verify")}
              inline
            />
          </div>
        )}
      </div>

      {/* Cart drawer -- mobile + tablet (when view=cart) */}
      {view === "cart" && (
        <div className="lg:hidden">
          <Cart
            cart={cart}
            config={catalog}
            onAddToCart={addToCart}
            onRemoveFromCart={removeFromCart}
            onClearItem={clearItem}
            onClose={() => setView("browse")}
            onCheckout={() => setView("phone-verify")}
          />
        </div>
      )}

      {/* Mobile floating cart bar -- shown in browse view when there are items */}
      {view === "browse" && cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-10 px-3 pb-3 animate-slide-up">
          <button
            onClick={() => setView("cart")}
            className="w-full flex items-center justify-between px-5 py-3.5 text-white font-semibold rounded-2xl active:scale-[0.98] transition-transform"
            style={{
              background: catalog.business.accentColor || "var(--store-accent)",
              boxShadow: "var(--store-shadow-lg)",
            }}
          >
            <span className="flex items-center gap-3">
              <span className="bg-white/20 rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">
                {cart.reduce((s, c) => s + c.quantity, 0)}
              </span>
              <span className="text-sm">
                {cart.reduce((s, c) => s + c.quantity, 0) === 1
                  ? "1 item"
                  : `${cart.reduce((s, c) => s + c.quantity, 0)} items`}
                {" "}in cart
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm">
              <span className="font-bold">
                {catalog.business.currency === "INR"
                  ? "\u20B9"
                  : catalog.business.currency}
                {cart
                  .reduce(
                    (s, c) => s + parseFloat(c.effectivePrice) * c.quantity,
                    0
                  )
                  .toFixed(0)}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                width="16"
                height="16"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

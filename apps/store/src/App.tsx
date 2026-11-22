import { useState, useEffect, useCallback, useRef } from "react";
import type { StoreConfig, CartItem, OrderResult, StoreItem } from "./types";
import { cartItemKey } from "./types";
import { fetchCatalog, fetchItemsByIds, assetUrl } from "./api";
import { loadCart, saveCart, migrateLegacyCart, mergeLegacyLines } from "./cartStorage";
import {
  parseCartLink,
  parseItemParam,
  resolveCartLink,
  mergeCartLink,
  describeCartLinkResult,
  countExistingLines,
  cartLinkAppliesInView,
  INVALID_LINK_NOTICE,
  UNREACHABLE_LINK_NOTICE,
  type CartLinkNotice as CartLinkNoticeData,
} from "./cartLink";
import { Header, Masthead } from "./components/Header";
import { ItemGrid } from "./components/ItemGrid";
import { ItemDetail } from "./components/ItemDetail";
import { Cart } from "./components/Cart";
import { Checkout } from "./components/Checkout";
import { PhoneVerify } from "./components/PhoneVerify";
import { OrderConfirmation } from "./components/OrderConfirmation";
import { Footer } from "./components/Footer";
import { CartLinkNotice } from "./components/CartLinkNotice";
import { ArrowRightIcon, BagIcon, SearchIcon } from "./components/Icons";
import { accentTokens } from "./color";
import { cartPaise, formatPaise } from "./money";

// Drop the `#cart=...` fragment so a reload does not apply the link again.
function stripCartFragment() {
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    // Sandboxed frames can refuse history changes; the merge is idempotent anyway.
  }
}

// Remove the `?item=` deep-link param once the item view is closed.
function stripItemParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("item")) return;
    url.searchParams.delete("item");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    // Ignore: the param only affects what a reload opens.
  }
}

// Keep categories seen so far: a filtered response only lists its own categories.
function mergeCategories(prev: string[] = [], next: string[]): string[] {
  return [...prev, ...next.filter((c) => !prev.includes(c))];
}

function applyAccentColor(hex?: string) {
  const tokens = accentTokens(hex);
  if (!tokens) return;
  const root = document.documentElement.style;
  root.setProperty("--store-accent", tokens.accent);
  root.setProperty("--store-accent-hover", tokens.hover);
  root.setProperty("--store-accent-light", tokens.light);
  // Text on the accent, and the accent as text on white: both kept at AA for any colour.
  root.setProperty("--store-accent-text", tokens.text);
  root.setProperty("--store-accent-ink", tokens.ink);

  // Update the browser theme-color meta tag
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", tokens.accent);
}

/**
 * Swap the browser-tab favicon (and apple-touch-icon) to the store's own logo.
 *
 * A small touch that makes every storefront feel like its own brand instead of
 * the generic Hisaabo default. Browsers run JS, so updating the <link rel=icon>
 * at runtime is enough for the tab/bookmark icon — no SSR needed. (Social-share
 * crawlers are a separate concern handled by per-store OG meta.)
 *
 * Falls back silently to the static default when the business has no logo.
 */
function applyFavicon(logoUrl?: string | null) {
  const href = assetUrl(logoUrl);
  if (!href) return;

  const ensureLink = (rel: string): HTMLLinkElement => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    return link;
  };

  // The logo endpoint serves PNG or JPEG; let the browser sniff the type.
  ensureLink("icon").href = href;
  ensureLink("apple-touch-icon").href = href;
}

type View = "browse" | "cart" | "phone-verify" | "checkout" | "confirmed";

export function App() {
  // Extract slug from URL: /<slug> (store runs on its own subdomain)
  const [slug] = useState<string>(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] || "";
  });

  // `catalog.items` holds every page loaded so far for the current filters.
  const [catalog, setCatalog] = useState<StoreConfig | null>(null);
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 0, limit: 24 });
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped per filter fetch so stale responses (older filters) are dropped.
  const requestSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<CartItem[]>(() => loadCart(slug));
  const [view, setView] = useState<View>("browse");
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  // Customer identity — set by PhoneVerify before Checkout
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [otpToken, setOtpToken] = useState<string | undefined>(undefined);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");

  // Item the customer is viewing in the detail modal (null = grid only).
  const [detailItem, setDetailItem] = useState<StoreItem | null>(null);

  // Latest cart and view for handlers that outlive a render (hash changes and
  // the fetches they start).
  const cartRef = useRef(cart);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
    // Checkout and the confirmation are screens of their own: start at the top.
    if (view === "checkout" || view === "confirmed") window.scrollTo(0, 0);
  }, [view]);

  // Persist cart (per store: every store shares one origin and so one localStorage)
  useEffect(() => {
    cartRef.current = cart;
    saveCart(slug, cart);
  }, [slug, cart]);

  // Carts used to live in one list shared by every store. Claim the lines of
  // that list that belong to this store (a failed lookup leaves it untouched).
  const legacyCartChecked = useRef(false);
  useEffect(() => {
    if (!slug || legacyCartChecked.current) return;
    legacyCartChecked.current = true;
    migrateLegacyCart(slug, (ids) => fetchItemsByIds(slug, ids)).then((moved) => {
      if (moved.length > 0) setCart((prev) => mergeLegacyLines(prev, moved));
    });
  }, [slug]);

  // A website can send shoppers here with a prefilled cart in the URL fragment
  // (`#cart=...`) and/or open one item (`?item=<id>`); see cartLink.ts.
  const [cartLinkNotice, setCartLinkNotice] = useState<CartLinkNoticeData | null>(null);
  const cartLinkStarted = useRef(false);
  const [deepLinkItemId] = useState(() => parseItemParam(window.location.search));

  useEffect(() => {
    if (!slug) return;

    const applyHash = () => {
      const parsed = parseCartLink(window.location.hash);
      if (parsed.status === "none") return;
      // Mid-checkout the cart is not on screen: ignore the link rather than
      // silently changing what is about to be ordered.
      if (!cartLinkAppliesInView(viewRef.current)) {
        stripCartFragment();
        return;
      }
      if (parsed.status === "invalid") {
        stripCartFragment();
        setCartLinkNotice(INVALID_LINK_NOTICE);
        return;
      }

      // Resolve against the live catalog: only ids, quantities, units and
      // variants come from the link; names, prices and stock come from the store.
      const ids = [...new Set(parsed.lines.map((l) => l.id))];
      fetchItemsByIds(slug, ids)
        .then((items) => {
          stripCartFragment();
          // The shopper may have started checkout while the lookup ran.
          if (!cartLinkAppliesInView(viewRef.current)) return;
          const { entries, dropped } = resolveCartLink(parsed.lines, items);
          const updated = countExistingLines(cartRef.current, entries);
          if (entries.length > 0) {
            setCart((prev) => mergeCartLink(prev, entries));
            setView("cart");
          }
          setCartLinkNotice(describeCartLinkResult(entries.length, dropped, updated));
        })
        .catch(() => {
          // Keep the fragment so reloading retries the link.
          if (cartLinkAppliesInView(viewRef.current)) setCartLinkNotice(UNREACHABLE_LINK_NOTICE);
        });
    };

    // The link in the address bar when the page loads. Once only: StrictMode
    // runs effects twice in dev, and the fragment is stripped when handled.
    if (!cartLinkStarted.current) {
      cartLinkStarted.current = true;
      applyHash();
    }
    // A link pasted into a tab already on the store changes only the fragment.
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [slug]);

  useEffect(() => {
    if (!slug || !deepLinkItemId) return;
    let cancelled = false;
    fetchItemsByIds(slug, [deepLinkItemId])
      .then((items) => {
        const item = items.find((i) => i.id.toLowerCase() === deepLinkItemId);
        if (!cancelled && item) setDetailItem(item);
      })
      .catch(() => {
        // Unknown or unreachable: just show the store normally.
      });
    return () => {
      cancelled = true;
    };
  }, [slug, deepLinkItemId]);

  // The notice belongs to the browsing screens; drop it once checkout starts.
  useEffect(() => {
    if (!cartLinkAppliesInView(view)) setCartLinkNotice(null);
  }, [view]);

  // Debounce search so the server is queried once typing pauses
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch first page of the catalog (search/category are filtered server-side)
  useEffect(() => {
    if (!slug) {
      setError("No store found at this URL");
      setLoading(false);
      return;
    }

    const seq = ++requestSeq.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setFetching(true);
    fetchCatalog(slug, { search: debouncedSearch, category: activeCategory })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setCatalog((prev) => ({
          ...data,
          categories: mergeCategories(prev?.categories, data.categories),
        }));
        setPageInfo({ page: data.page, total: data.total, limit: data.limit });
        applyAccentColor(data.business.accentColor);
        applyFavicon(data.business.logoUrl);
        // Update page title
        document.title = `${data.business.name} \u2014 Online Store`;
      })
      .catch(() => {
        if (seq === requestSeq.current) setError("Store not found or unavailable");
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setFetching(false);
        setLoading(false);
      });
  }, [slug, debouncedSearch, activeCategory]);

  const hasMore = pageInfo.page * pageInfo.limit < pageInfo.total;

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = requestSeq.current;
    fetchCatalog(slug, {
      page: pageInfo.page + 1,
      search: debouncedSearch,
      category: activeCategory,
    })
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setCatalog((prev) => {
          if (!prev) return prev;
          const known = new Set(prev.items.map((i) => i.id));
          return {
            ...prev,
            items: [...prev.items, ...data.items.filter((i) => !known.has(i.id))],
            categories: mergeCategories(prev.categories, data.categories),
          };
        });
        setPageInfo({ page: data.page, total: data.total, limit: data.limit });
      })
      .catch(() => {
        // Leave the "Load more" button in place so the customer can retry.
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [slug, pageInfo.page, debouncedSearch, activeCategory]);

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
    saveCart(slug, []);
  }, [slug]);

  const handleContinueShopping = useCallback(() => {
    setOrderResult(null);
    setView("browse");
    setSearch("");
    setActiveCategory("");
  }, []);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4" role="status">
        <div className="relative">
          <div className="h-14 w-14 animate-pulse rounded-2xl" style={{ background: "var(--store-accent)", opacity: 0.2 }} />
          <div
            className="absolute inset-0 h-14 w-14 animate-pulse rounded-2xl"
            style={{ background: "var(--store-accent)", animationDelay: "0.15s", opacity: 0.6 }}
          />
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--store-muted)" }}>
          Loading store...
        </p>
      </div>
    );
  }

  // ── Error state ──
  if (!catalog) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
        <div className="empty-icon" style={{ width: 72, height: 72 }}>
          <BagIcon size={32} />
        </div>
        <h1 className="mb-2 text-xl font-bold" style={{ letterSpacing: "-0.02em" }}>
          Store not found
        </h1>
        <p className="max-w-xs text-sm" style={{ color: "var(--store-muted)" }}>
          {error || "This store is not available. Please check the URL and try again."}
        </p>
      </div>
    );
  }

  // ── Order Confirmation ──
  if (view === "confirmed" && orderResult) {
    return <OrderConfirmation result={orderResult} config={catalog} onContinueShopping={handleContinueShopping} />;
  }

  // ── Checkout: the store's own masthead and container, then two columns ──
  if (view === "checkout") {
    return (
      <>
        <div className="accent-rule" />
        <div className="wrap">
          <Masthead business={catalog.business} heading={false} />
        </div>
        <main className="wrap">
          <Checkout
            cart={cart}
            config={catalog}
            slug={slug}
            customerPhone={customerPhone}
            customerName={customerName}
            otpToken={otpToken}
            isNewCustomer={isNewCustomer}
            onBack={() => setView("cart")}
            onSuccess={handleOrderSuccess}
          />
        </main>
      </>
    );
  }

  // ── Browse, with the cart and phone step as dialogs over it ──
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);
  const cartOpen = view === "cart" || view === "phone-verify";

  return (
    <>
      <a href="#items" className="skip-link">
        Skip to items
      </a>

      <Header
        config={catalog}
        cartCount={cartCount}
        search={search}
        onSearchChange={setSearch}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCartClick={() => setView("cart")}
      />

      <main id="items" className="wrap" tabIndex={-1} style={{ outline: "none" }}>
        <ItemGrid
          items={catalog.items}
          cart={cart}
          onAddToCart={addToCart}
          onRemoveFromCart={removeFromCart}
          currency={catalog.business.currency}
          search={search}
          activeCategory={activeCategory}
          onOpenDetail={setDetailItem}
          loading={fetching}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
        />

        {catalog.items.length === 0 && !fetching && !search && !activeCategory && (
          <div className="empty">
            <div className="empty-icon">
              <SearchIcon size={24} />
            </div>
            <p className="font-semibold">No items available yet</p>
            <p className="mt-1 text-sm" style={{ color: "var(--store-muted)" }}>
              Check back soon.
            </p>
          </div>
        )}
      </main>

      <Footer config={catalog} />

      {/* Phone shoppers: the cart is one tap away at the foot of the screen. */}
      {cartCount > 0 && (
        <button type="button" className="cart-bar" onClick={() => setView("cart")}>
          <span className="flex items-center gap-3">
            <span className="cart-count" style={{ background: "rgba(255,255,255,0.22)", color: "inherit" }}>
              {cartCount}
            </span>
            <span>View cart</span>
          </span>
          <span className="num flex items-center gap-2 font-bold">
            {formatPaise(cartPaise(cart), catalog.business.currency)}
            <ArrowRightIcon size={16} />
          </span>
        </button>
      )}

      {cartOpen && (
        <Cart
          cart={cart}
          config={catalog}
          onAddToCart={addToCart}
          onRemoveFromCart={removeFromCart}
          onClearItem={clearItem}
          onClose={() => setView("browse")}
          onCheckout={() => setView("phone-verify")}
        />
      )}

      {/* Opens above the cart drawer: closing it returns to the cart. */}
      {view === "phone-verify" && (
        <PhoneVerify
          slug={slug}
          onBack={() => setView("cart")}
          otpRequired={catalog.business.otpRequired === true}
          onVerified={(phone, name, isNew, _turnstile, token) => {
            setOtpToken(token);
            setCustomerPhone(phone);
            setCustomerName(name);
            setIsNewCustomer(isNew);
            setView("checkout");
          }}
        />
      )}

      {/* Item detail — full gallery + variant-aware images */}
      {detailItem && (
        <ItemDetail
          item={detailItem}
          cart={cart}
          onAddToCart={addToCart}
          onRemoveFromCart={removeFromCart}
          currency={catalog.business.currency}
          onClose={() => {
            setDetailItem(null);
            stripItemParam();
          }}
        />
      )}

      {cartLinkNotice && <CartLinkNotice notice={cartLinkNotice} onDismiss={() => setCartLinkNotice(null)} />}
    </>
  );
}

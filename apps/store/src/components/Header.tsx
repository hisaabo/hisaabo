import { useState } from "react";
import type { StoreConfig } from "../types";
import { assetUrl } from "../api";
import { formatMoney, toPaise } from "../money";
import { BagIcon, CloseIcon, SearchIcon } from "./Icons";

type Business = StoreConfig["business"];

/**
 * The store's name, tagline and mark. Used at the top of every screen, the
 * browse page and checkout alike, so the store looks like one place.
 * `heading` makes the name the page's h1; checkout has its own.
 */
export function Masthead({ business, heading = true }: { business: Business; heading?: boolean }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = assetUrl(business.logoUrl);
  const Name = heading ? "h1" : "p";
  const minOrder = toPaise(business.minOrderAmount);

  return (
    <div className="masthead">
      {/* Always a 56-64px square, so the page does not shift when the logo arrives. */}
      {logo && !logoFailed ? (
        <img src={logo} alt="" width={64} height={64} className="brand-mark" onError={() => setLogoFailed(true)} />
      ) : (
        <span className="brand-mark brand-mark-initial" aria-hidden="true">
          {Array.from(business.name.trim())[0]?.toUpperCase() ?? ""}
        </span>
      )}
      <div className="min-w-0">
        <Name className="brand-name">{business.name}</Name>
        {business.tagline && <p className="brand-tag">{business.tagline}</p>}
        {heading && minOrder > 0 && (
          <p className="brand-meta">Minimum order {formatMoney(business.minOrderAmount, business.currency)}</p>
        )}
      </div>
    </div>
  );
}

interface HeaderProps {
  config: StoreConfig;
  cartCount: number;
  search: string;
  onSearchChange: (v: string) => void;
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  onCartClick: () => void;
}

export function Header({
  config,
  cartCount,
  search,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  onCartClick,
}: HeaderProps) {
  const { business, categories } = config;

  return (
    <>
      <div className="accent-rule" />
      <header className="wrap">
        <Masthead business={business} />
      </header>

      {/* Sticks to the top while the grid scrolls. */}
      <div className="toolbar">
        <div className="wrap">
          <div className="toolbar-row">
            <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
              <span className="search-icon">
                <SearchIcon size={18} />
              </span>
              <input
                type="search"
                className="search-input"
                placeholder="Search items"
                aria-label={`Search in ${business.name}`}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                enterKeyHint="search"
                autoComplete="off"
              />
              {search && (
                <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onSearchChange("")}>
                  <CloseIcon size={18} />
                </button>
              )}
            </form>

            <button
              type="button"
              className="cart-btn"
              onClick={onCartClick}
              aria-label={cartCount === 0 ? "Open cart, empty" : `Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
            >
              <BagIcon size={20} />
              <span className="cart-btn-label">Cart</span>
              <span className="cart-count" data-empty={cartCount === 0} aria-hidden="true">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            </button>
          </div>

          {categories.length > 0 && (
            <div className="chips scrollbar-hide" role="group" aria-label="Categories">
              <button type="button" className="chip" aria-pressed={activeCategory === ""} onClick={() => onCategoryChange("")}>
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className="chip"
                  aria-pressed={activeCategory === cat}
                  onClick={() => onCategoryChange(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

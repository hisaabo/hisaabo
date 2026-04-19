/**
 * POS state store — one tab = one store = up to 5 parked carts.
 *
 * Pattern: minimal subscribe/getSnapshot external store consumed via React
 * 19's `useSyncExternalStore` hook. No external dep (keeps the app bundle
 * small) but gives us fine-grained selector subscriptions the same way
 * Zustand does — components only rerender when the slice they read changes.
 *
 * Persistence: writes to localStorage under a key that is namespaced by
 * businessId + per-tab `tabId`. Two POS tabs in the same browser share
 * nothing. A fresh tab generates its own tabId on first load so the same
 * tab across reloads still sees its own carts.
 *
 * What we DON'T persist: computed totals (tax/grand total). Those are
 * recomputed from line items because tax rates can change between sessions.
 */

import { useSyncExternalStore } from "react";

// ── Types ────────────────────────────────────────────────────────

export interface POSLineItem {
  /** Client-generated ID for keyed rendering + cart ops. */
  lineId: string;
  /** Null = custom ad-hoc line (no catalog row). */
  itemId: string | null;
  /** Set when billing a specific variant row — server decrements variant stock. */
  variantId?: string | null;
  itemName: string;
  quantity: string; // decimal string, server-compatible
  /**
   * The unit the cashier picked on the tile. Carried to the invoice as
   * `selectedUnit` so the server-side stock math uses the right factor.
   */
  unit: string;
  unitPrice: string;
  taxPercent: string;      // "0", "5", "12", "18", "28"
  discountPercent: string; // "0" default
  /**
   * Conversion factor to the item's base unit. "1" for simple items and for
   * variants (variants have their own stock, no conversion needed); may be
   * a decimal for alt_units entries.
   */
  conversionFactor: string;
}

export interface POSCart {
  id: string;
  label: string;            // "Hold #1", or customer name, user-editable
  partyId: string;          // Walk-in party id by default
  partyName: string;        // cached for chip display
  lineItems: POSLineItem[];
  notes?: string;
  createdAt: number;        // epoch ms
  updatedAt: number;
}

interface StoreState {
  /** Stable per-tab identity, set on first load. */
  tabId: string;
  /** Which business this state belongs to. */
  businessId: string;
  /** Parked + active carts. The "active" cart is whichever is currently
   *  selected; it's not a separate slot. */
  carts: POSCart[];
  /** ID of the currently active cart (always exists — blank cart auto-created). */
  activeCartId: string;
}

// ── Store implementation ────────────────────────────────────────

type Listener = () => void;

function randomId(): string {
  // crypto.randomUUID is available in all modern browsers (and in Node 19+)
  // which covers every target of this app.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function storageKey(businessId: string, tabId: string): string {
  return `pos:${businessId}:${tabId}:state`;
}

function tabIdKey(businessId: string): string {
  // sessionStorage — survives reload, but a new tab gets its own namespace
  return `pos:${businessId}:tabId`;
}

function getOrCreateTabId(businessId: string): string {
  if (typeof sessionStorage === "undefined") return randomId();
  const existing = sessionStorage.getItem(tabIdKey(businessId));
  if (existing) return existing;
  const fresh = randomId();
  sessionStorage.setItem(tabIdKey(businessId), fresh);
  return fresh;
}

function blankCart(partyId: string, partyName: string): POSCart {
  return {
    id: randomId(),
    label: "New Sale",
    partyId,
    partyName,
    lineItems: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export class POSStore {
  private state: StoreState;
  private listeners = new Set<Listener>();

  constructor(businessId: string, walkInPartyId: string) {
    const tabId = getOrCreateTabId(businessId);
    this.state = this.hydrate(businessId, tabId, walkInPartyId);
  }

  // Subscribe / snapshot API consumed by useSyncExternalStore.
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): StoreState => this.state;

  private hydrate(businessId: string, tabId: string, walkInPartyId: string): StoreState {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey(businessId, tabId));
        if (raw) {
          const parsed = JSON.parse(raw) as StoreState;
          // Validate essentials — a corrupt payload falls back to a fresh state.
          if (
            parsed.businessId === businessId &&
            Array.isArray(parsed.carts) &&
            parsed.carts.length > 0 &&
            parsed.carts.some((c) => c.id === parsed.activeCartId)
          ) {
            return { ...parsed, tabId };
          }
        }
      } catch {
        // fallthrough — start fresh
      }
    }
    const cart = blankCart(walkInPartyId, "Walk-in Customer");
    return { tabId, businessId, carts: [cart], activeCartId: cart.id };
  }

  private persist(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        storageKey(this.state.businessId, this.state.tabId),
        JSON.stringify(this.state),
      );
    } catch {
      // Quota exceeded or storage disabled — POS still works in-memory.
    }
  }

  private emit(): void {
    this.persist();
    for (const l of this.listeners) l();
  }

  private updateActive(patch: (c: POSCart) => POSCart): void {
    this.state = {
      ...this.state,
      carts: this.state.carts.map((c) =>
        c.id === this.state.activeCartId ? { ...patch(c), updatedAt: Date.now() } : c,
      ),
    };
    this.emit();
  }

  // ── Public mutations ──

  addLine(line: Omit<POSLineItem, "lineId">): void {
    this.updateActive((c) => ({ ...c, lineItems: [...c.lineItems, { ...line, lineId: randomId() }] }));
  }

  /**
   * Increment an existing matching line rather than pushing a duplicate row.
   * Identity is (itemId, variantId, unit) — two alt-unit tiles of the same
   * item (e.g. Rice kg vs Rice g) must stay on separate cart lines because
   * the server needs each one's own conversion factor to decrement stock
   * correctly.
   */
  addOrBumpLine(
    match: { itemId: string | null; variantId?: string | null; unit?: string },
    line: Omit<POSLineItem, "lineId">,
  ): void {
    this.updateActive((c) => {
      const idx = c.lineItems.findIndex(
        (li) =>
          li.itemId === match.itemId &&
          (li.variantId ?? null) === (match.variantId ?? null) &&
          (match.unit === undefined || li.unit === match.unit),
      );
      if (idx === -1) {
        return { ...c, lineItems: [...c.lineItems, { ...line, lineId: randomId() }] };
      }
      const existing = c.lineItems[idx]!;
      const nextQty = (parseFloat(existing.quantity) + parseFloat(line.quantity)).toString();
      const updated = { ...existing, quantity: nextQty };
      const lineItems = [...c.lineItems];
      lineItems[idx] = updated;
      return { ...c, lineItems };
    });
  }

  updateLine(lineId: string, patch: Partial<POSLineItem>): void {
    this.updateActive((c) => ({
      ...c,
      lineItems: c.lineItems.map((li) => (li.lineId === lineId ? { ...li, ...patch } : li)),
    }));
  }

  removeLine(lineId: string): void {
    this.updateActive((c) => ({ ...c, lineItems: c.lineItems.filter((li) => li.lineId !== lineId) }));
  }

  removeLastLine(): void {
    this.updateActive((c) => ({ ...c, lineItems: c.lineItems.slice(0, -1) }));
  }

  setCustomer(partyId: string, partyName: string): void {
    this.updateActive((c) => ({ ...c, partyId, partyName }));
  }

  setLabel(label: string): void {
    this.updateActive((c) => ({ ...c, label }));
  }

  parkActive(walkInPartyId: string, walkInName: string): void {
    // Simply stamp the current cart as parked (already persisted) and swap
    // to a fresh blank cart. Enforce the ≤5 cap — oldest gets pushed out.
    const fresh = blankCart(walkInPartyId, walkInName);
    let carts = [...this.state.carts, fresh];
    if (carts.length > 5) {
      // Keep the active (just parked) plus the 4 most recently touched others.
      carts = carts
        .sort((a, b) => (a.id === fresh.id ? 1 : b.id === fresh.id ? -1 : b.updatedAt - a.updatedAt))
        .slice(0, 5);
    }
    this.state = { ...this.state, carts, activeCartId: fresh.id };
    this.emit();
  }

  resumeCart(cartId: string): void {
    if (!this.state.carts.some((c) => c.id === cartId)) return;
    this.state = { ...this.state, activeCartId: cartId };
    this.emit();
  }

  clearActive(): void {
    this.updateActive((c) => ({ ...c, lineItems: [], notes: undefined }));
  }

  /** Remove a cart entirely (e.g. after finalize). Auto-create a blank if empty. */
  removeCart(cartId: string, walkInPartyId: string, walkInName: string): void {
    let carts = this.state.carts.filter((c) => c.id !== cartId);
    let activeCartId = this.state.activeCartId;
    if (activeCartId === cartId) {
      if (carts.length === 0) {
        const fresh = blankCart(walkInPartyId, walkInName);
        carts = [fresh];
        activeCartId = fresh.id;
      } else {
        activeCartId = carts[0]!.id;
      }
    }
    this.state = { ...this.state, carts, activeCartId };
    this.emit();
  }
}

// ── React binding ───────────────────────────────────────────────

/** Subscribe to a selector of the POS store. */
export function usePOSSelector<T>(store: POSStore, selector: (s: StoreState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getSnapshot()),
    () => selector(store.getSnapshot()),
  );
}

// ── Totals (derived, never stored) ──────────────────────────────

export interface CartTotals {
  subtotal: number;    // sum of (price * qty) before tax/discount
  discount: number;    // sum of line-level discount rupees
  tax: number;         // sum of line-level tax rupees
  total: number;       // subtotal - discount + tax
}

export function computeCartTotals(lineItems: POSLineItem[]): CartTotals {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const li of lineItems) {
    const qty = parseFloat(li.quantity) || 0;
    const price = parseFloat(li.unitPrice) || 0;
    const gross = qty * price;
    const disc = gross * ((parseFloat(li.discountPercent) || 0) / 100);
    const net = gross - disc;
    const lineTax = net * ((parseFloat(li.taxPercent) || 0) / 100);
    subtotal += gross;
    discount += disc;
    tax += lineTax;
  }
  const total = subtotal - discount + tax;
  return { subtotal, discount, tax, total };
}

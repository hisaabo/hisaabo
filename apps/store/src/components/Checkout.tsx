import { useId, useRef, useEffect, useState, useSyncExternalStore } from "react";
import type { CartItem, StoreConfig, OrderResult } from "../types";
import { cartItemKey } from "../types";
import { placeOrder } from "../api";
import { cartPaise, formatPaise, linePaise } from "../money";
import { AlertIcon, ArrowLeftIcon, ChevronDownIcon, InfoIcon, Spinner } from "./Icons";

interface CheckoutProps {
  cart: CartItem[];
  config: StoreConfig;
  slug: string;
  /** Pre-verified phone number (e.g. "+919876543210") from the phone step */
  customerPhone: string;
  /** Pre-filled customer name from the phone step */
  customerName: string;
  /** Token from the SMS OTP step, when the store requires phone verification */
  otpToken?: string;
  /** Whether this is a new customer (name field editable) or returning (read-only) */
  isNewCustomer: boolean;
  onBack: () => void;
  onSuccess: (result: OrderResult) => void;
}

interface FormValues {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPincode: string;
  deliveryNotes: string;
}

/** Where the summary stops being a collapsible row and sits beside the form. */
const WIDE = "(min-width: 960px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      theme: string;
      size: string;
    },
  ) => string;
  reset: (id: string) => void;
};

/**
 * Checkout, laid out like the store: the same container, and two columns on a
 * desktop. Your details on the left; on the right a sticky column with the
 * order (lines, total, the store's note) and the place-order button. On a phone
 * it is one column: the order first, collapsed to a single line, then the form,
 * then the button.
 */
export function Checkout({
  cart,
  config,
  slug,
  customerPhone,
  customerName: initialName,
  otpToken,
  isNewCustomer,
  onBack,
  onSuccess,
}: CheckoutProps) {
  const { business } = config;
  const currency = business.currency;
  const wide = useMediaQuery(WIDE);
  const formId = useId();
  const summaryId = useId();

  // Pre-fill name and phone from the phone step; phone is always read-only
  const [form, setForm] = useState<FormValues>({
    customerName: initialName,
    customerPhone: customerPhone.replace(/^\+91/, ""),
    customerEmail: "",
    deliveryAddress: "",
    deliveryCity: "",
    deliveryPincode: "",
    deliveryNotes: "",
  });
  const [errors, setErrors] = useState<Partial<FormValues>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Fresh Turnstile token for order submission — Cloudflare tokens are single-use
  const orderTokenRef = useRef<string>("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Render Turnstile widget on mount
  useEffect(() => {
    if (!turnstileRef.current) return;

    // The always-pass test key is dev-only; production builds must configure a real key.
    const configuredKey =
      (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ||
      (import.meta.env.PROD ? undefined : "1x00000000000000000000AA");
    if (!configuredKey) {
      setApiError("Verification is not configured. Please contact the store.");
      return;
    }
    const siteKey: string = configuredKey;
    const win = window as unknown as { turnstile?: TurnstileApi };

    function mount() {
      if (!turnstileRef.current || !win.turnstile) return;
      // Guard against double-render (React StrictMode in dev)
      if (widgetIdRef.current !== null) return;
      widgetIdRef.current = win.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          orderTokenRef.current = token;
          setApiError((prev) => (prev === "Please complete the security check" ? "" : prev));
        },
        "error-callback": () => {
          setApiError("Verification widget error. Please refresh the page.");
        },
        "expired-callback": () => {
          orderTokenRef.current = "";
        },
        theme: "light",
        size: "flexible",
      });
    }

    // Turnstile may not be loaded yet (async script)
    if (win.turnstile) {
      mount();
    } else {
      // Poll briefly until the script loads
      const interval = setInterval(() => {
        if (win.turnstile) {
          clearInterval(interval);
          mount();
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, []);

  const total = cartPaise(cart);
  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
  const itemsLabel = `${totalItems} ${totalItems === 1 ? "item" : "items"}`;
  const totalLabel = formatPaise(total, currency);

  function set(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const next: Partial<FormValues> = {};
    if (!form.customerName.trim()) next.customerName = "Enter your name";
    // Phone is pre-verified — no re-validation needed
    setErrors(next);
    if (next.customerName) nameRef.current?.focus();
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (!orderTokenRef.current) {
      setApiError("Please complete the security check");
      return;
    }

    setSubmitting(true);
    setApiError("");

    try {
      const result = await placeOrder(slug, {
        customerName: form.customerName.trim(),
        // Send the pre-verified phone (strip +91 prefix — API expects 10 digits)
        customerPhone: customerPhone.replace(/^\+91/, "").replace(/\D/g, ""),
        customerEmail: form.customerEmail.trim() || undefined,
        deliveryAddress: form.deliveryAddress.trim() || undefined,
        deliveryCity: form.deliveryCity.trim() || undefined,
        deliveryPincode: form.deliveryPincode.trim() || undefined,
        deliveryNotes: form.deliveryNotes.trim() || undefined,
        items: cart.map((c) => ({
          itemId: c.item.id,
          quantity: c.quantity,
          ...(c.selectedUnit ? { selectedUnit: c.selectedUnit, conversionFactor: c.conversionFactor } : {}),
          ...(c.selectedVariantId ? { variantId: c.selectedVariantId } : {}),
        })),
        turnstileToken: orderTokenRef.current,
        ...(otpToken ? { otpToken } : {}),
      });
      onSuccess(result);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in">
      <button type="button" onClick={onBack} className="back-btn">
        <ArrowLeftIcon size={16} />
        Back to cart
      </button>

      <h1 className="co-title" style={{ fontSize: "var(--fs-xl)", margin: "4px 0 20px" }}>
        Checkout
      </h1>

      <div className="co-grid">
        <form id={formId} className="co-form co-card space-y-5" onSubmit={handleSubmit} noValidate>
          <h2 className="co-h">Your details</h2>

          <Field label="Full name" required error={errors.customerName}>
            {(id, describedBy) => (
              <input
                ref={nameRef}
                id={id}
                className="input"
                type="text"
                placeholder="Rahul Sharma"
                value={form.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                autoComplete="name"
                readOnly={!isNewCustomer}
                aria-required="true"
                aria-invalid={errors.customerName ? true : undefined}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field
            label="Phone number"
            hint={
              business.otpRequired
                ? "Verified with an SMS code"
                : "We will use this number to confirm your order"
            }
          >
            {(id, describedBy) => (
              <div className="input-group">
                <span className="input-addon" aria-hidden="true">
                  +91
                </span>
                <input
                  id={id}
                  className="input"
                  type="tel"
                  value={form.customerPhone}
                  readOnly
                  aria-describedby={describedBy}
                />
              </div>
            )}
          </Field>

          <Field label="Email" hint="Optional">
            {(id, describedBy) => (
              <input
                id={id}
                className="input"
                type="email"
                placeholder="rahul@example.com"
                value={form.customerEmail}
                onChange={(e) => set("customerEmail", e.target.value)}
                autoComplete="email"
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <Field label="Delivery address" hint="Optional">
            {(id, describedBy) => (
              <textarea
                id={id}
                className="input"
                rows={3}
                placeholder="House no, street, locality"
                value={form.deliveryAddress}
                onChange={(e) => set("deliveryAddress", e.target.value)}
                autoComplete="street-address"
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="City">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="text"
                  placeholder="Mumbai"
                  value={form.deliveryCity}
                  onChange={(e) => set("deliveryCity", e.target.value)}
                  autoComplete="address-level2"
                />
              )}
            </Field>
            <Field label="Pincode">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="text"
                  placeholder="400001"
                  value={form.deliveryPincode}
                  onChange={(e) => set("deliveryPincode", e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="postal-code"
                />
              )}
            </Field>
          </div>

          <Field label="Order notes" hint="Optional">
            {(id, describedBy) => (
              <textarea
                id={id}
                className="input"
                rows={2}
                placeholder="Any special instructions"
                value={form.deliveryNotes}
                onChange={(e) => set("deliveryNotes", e.target.value)}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </form>

        <div className="co-aside">
          <section className="co-card co-summary" aria-labelledby={summaryId}>
            <h2 id={summaryId} className="co-h">
              {wide ? (
                <span className="flex items-baseline justify-between gap-3">
                  Order summary
                  <span className="text-sm font-normal" style={{ color: "var(--store-muted)" }}>
                    {itemsLabel}
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  className="co-summary-toggle"
                  aria-expanded={summaryOpen}
                  aria-controls={`${summaryId}-body`}
                  onClick={() => setSummaryOpen((o) => !o)}
                >
                  <span>
                    Order summary
                    <span className="block text-sm font-normal" style={{ color: "var(--store-muted)" }}>
                      {itemsLabel}, {totalLabel}
                    </span>
                  </span>
                  <ChevronDownIcon size={20} className="co-summary-chevron" />
                </button>
              )}
            </h2>

            <div id={`${summaryId}-body`} className="co-summary-body" data-open={wide || summaryOpen} style={{ marginTop: 16 }}>
              <ul className="space-y-3">
                {cart.map((entry) => (
                  <SummaryLine key={cartItemKey(entry)} entry={entry} currency={currency} />
                ))}
              </ul>

              <div className="bill-row bill-total">
                <span>Total</span>
                <span className="bill-leader" />
                <span className="bill-amount">{totalLabel}</span>
              </div>

              {business.deliveryNote && (
                <p className="note mt-4">
                  <InfoIcon size={16} />
                  <span>{business.deliveryNote}</span>
                </p>
              )}
            </div>
          </section>

          <section className="co-card co-place space-y-4" aria-label="Place order">
            {/* Turnstile widget — renders a fresh token for order submission */}
            <div ref={turnstileRef} />

            {apiError && (
              <p role="alert" className="note note-error">
                <AlertIcon size={16} />
                <span>{apiError}</span>
              </p>
            )}

            <button
              type="submit"
              form={formId}
              className="btn btn-primary btn-block justify-between"
              disabled={submitting}
              style={{ minHeight: 52 }}
            >
              {submitting ? (
                <span className="mx-auto flex items-center gap-2.5">
                  <Spinner /> Placing order...
                </span>
              ) : (
                <>
                  <span>Place order</span>
                  <span className="num">{totalLabel}</span>
                </>
              )}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryLine({ entry, currency }: { entry: CartItem; currency: string }) {
  let choice = "";
  if (entry.selectedVariantId && entry.item.variants) {
    const variant = entry.item.variants.find((v) => v.id === entry.selectedVariantId);
    if (variant) choice = Object.values(variant.attributes).join(" / ");
  } else if (entry.selectedUnit) {
    choice = entry.selectedUnit;
  }
  return (
    <li className="bill-row text-sm">
      <span className="bill-name">
        {entry.item.name}
        {choice && <span style={{ color: "var(--store-text-secondary)" }}> ({choice})</span>}{" "}
        <span className="num" style={{ color: "var(--store-muted)" }}>
          &times; {entry.quantity}
        </span>
      </span>
      <span className="bill-leader" />
      <span className="bill-amount">{formatPaise(linePaise(entry.effectivePrice, entry.quantity), currency)}</span>
    </li>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children(id, note ? noteId : undefined)}
      {note && (
        <p id={noteId} className={error ? "field-error" : "field-hint"} role={error ? "alert" : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}

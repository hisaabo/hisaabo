import { useState, useRef } from "react";
import type { CartItem, StoreConfig, OrderResult } from "../types";
import { cartItemKey } from "../types";
import { placeOrder } from "../api";

interface CheckoutProps {
  cart: CartItem[];
  config: StoreConfig;
  slug: string;
  /** Pre-verified phone number (e.g. "+919876543210") from PhoneVerify step */
  customerPhone: string;
  /** Pre-filled customer name from PhoneVerify step */
  customerName: string;
  /** Whether this is a new customer (name field editable) or returning (read-only) */
  isNewCustomer: boolean;
  /** Turnstile token from PhoneVerify step — reused for order submission */
  turnstileToken: string;
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

export function Checkout({
  cart,
  config,
  slug,
  customerPhone,
  customerName: initialName,
  isNewCustomer,
  turnstileToken: initialToken,
  onBack,
  onSuccess,
}: CheckoutProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "\u20B9" : business.currency;
  const accent = business.accentColor || "var(--store-accent)";

  // Pre-fill name and phone from PhoneVerify; phone is always read-only
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

  // Reuse the turnstile token from the PhoneVerify step — no need for a second challenge
  const orderTokenRef = useRef<string>(initialToken);

  const subtotal = cart.reduce(
    (s, c) => s + parseFloat(c.effectivePrice) * c.quantity,
    0
  );
  const totalItems = cart.reduce((s, c) => s + c.quantity, 0);

  function set(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const next: Partial<FormValues> = {};
    if (!form.customerName.trim()) next.customerName = "Name is required";
    // Phone is pre-verified — no re-validation needed
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

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
      });
      onSuccess(result);
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Failed to place order"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="animate-fade-in" style={{ background: "var(--store-bg-secondary)" }}>
      <div className="max-w-lg mx-auto px-4 sm:px-6 py-5 pb-28 sm:pb-8">
        {/* Back */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium mb-5"
          style={{ color: accent }}
        >
          <BackIcon color={accent} />
          Back
        </button>

        <h2
          className="text-2xl font-bold mb-5"
          style={{ color: "var(--store-text)", letterSpacing: "-0.025em" }}
        >
          Checkout
        </h2>

        {/* Order summary - collapsible on mobile, always shown on desktop */}
        <div
          className="rounded-xl mb-5 overflow-hidden"
          style={{
            background: "var(--store-bg)",
            boxShadow: "var(--store-shadow-sm)",
          }}
        >
          {/* Summary toggle (mobile) / header (desktop) */}
          <button
            className="w-full flex items-center justify-between p-4 text-left sm:cursor-default"
            onClick={() => setSummaryOpen(!summaryOpen)}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: "var(--store-accent-light)" }}
              >
                <CartBagIcon color={accent} />
              </div>
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--store-muted)" }}
                >
                  Order Summary
                </p>
                <p
                  className="text-sm font-bold mt-0.5"
                  style={{ color: "var(--store-text)" }}
                >
                  {totalItems} {totalItems === 1 ? "item" : "items"} &middot;{" "}
                  {symbol}
                  {subtotal.toFixed(2)}
                </p>
              </div>
            </div>
            <span className="sm:hidden" style={{ color: "var(--store-muted)" }}>
              <ChevronIcon open={summaryOpen} />
            </span>
          </button>

          {/* Item list */}
          <div
            className={`overflow-hidden transition-all duration-200 ${
              summaryOpen ? "max-h-[500px]" : "max-h-0 sm:max-h-[500px]"
            }`}
          >
            <div
              className="px-4 pb-4 space-y-2.5 border-t"
              style={{ borderColor: "var(--store-border-light)" }}
            >
              <div className="pt-3 space-y-2">
                {cart.map((entry) => {
                  let label = entry.item.name;
                  if (entry.selectedVariantId && entry.item.variants) {
                    const variant = entry.item.variants.find((v) => v.id === entry.selectedVariantId);
                    if (variant) {
                      label += ` (${Object.values(variant.attributes).join(" / ")})`;
                    }
                  } else if (entry.selectedUnit) {
                    label += ` (${entry.selectedUnit})`;
                  }
                  return (
                  <div
                    key={cartItemKey(entry)}
                    className="flex justify-between items-center text-sm"
                  >
                    <span
                      className="line-clamp-1 flex-1 mr-3"
                      style={{ color: "var(--store-text-secondary)" }}
                    >
                      {label}{" "}
                      <span style={{ color: "var(--store-muted)" }}>
                        x{entry.quantity}
                      </span>
                    </span>
                    <span
                      className="font-semibold tabular-nums flex-shrink-0"
                      style={{ color: "var(--store-text)" }}
                    >
                      {symbol}
                      {(
                        parseFloat(entry.effectivePrice) * entry.quantity
                      ).toFixed(0)}
                    </span>
                  </div>
                  );
                })}
              </div>
              <div
                className="flex justify-between items-center text-sm font-bold pt-2.5 border-t"
                style={{ borderColor: "var(--store-border-light)" }}
              >
                <span style={{ color: "var(--store-text)" }}>Total</span>
                <span style={{ color: accent }}>
                  {symbol}
                  {subtotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div
          className="rounded-xl p-5 sm:p-6"
          style={{
            background: "var(--store-bg)",
            boxShadow: "var(--store-shadow-sm)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-4"
            style={{ color: "var(--store-muted)" }}
          >
            Your Details
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Full Name" required error={errors.customerName}>
              <input
                className="store-input"
                type="text"
                placeholder="Rahul Sharma"
                value={form.customerName}
                onChange={(e) => set("customerName", e.target.value)}
                autoComplete="name"
                readOnly={!isNewCustomer}
              />
            </Field>

            <Field
              label="Phone Number"
              required
              error={errors.customerPhone}
            >
              <div className="flex">
                <span
                  className="inline-flex items-center px-3.5 border border-r-0 rounded-l-lg text-sm font-medium flex-shrink-0"
                  style={{
                    background: "var(--store-bg-secondary)",
                    borderColor: "var(--store-border)",
                    color: "var(--store-text-secondary)",
                  }}
                >
                  +91
                </span>
                <input
                  className="store-input rounded-l-none flex-1"
                  type="tel"
                  value={form.customerPhone}
                  readOnly
                  style={{ color: "var(--store-text-secondary)", cursor: "not-allowed" }}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: "var(--store-muted)" }}>
                Verified
              </p>
            </Field>

            <Field label="Email" error={errors.customerEmail}>
              <input
                className="store-input"
                type="email"
                placeholder="rahul@example.com (optional)"
                value={form.customerEmail}
                onChange={(e) => set("customerEmail", e.target.value)}
                autoComplete="email"
              />
            </Field>

            <Field label="Delivery Address" error={errors.deliveryAddress}>
              <textarea
                className="store-input resize-none"
                rows={3}
                placeholder="House no, street, locality (optional)"
                value={form.deliveryAddress}
                onChange={(e) => set("deliveryAddress", e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="City" error={errors.deliveryCity}>
                <input
                  className="store-input"
                  type="text"
                  placeholder="Mumbai"
                  value={form.deliveryCity}
                  onChange={(e) => set("deliveryCity", e.target.value)}
                />
              </Field>
              <Field label="Pincode" error={errors.deliveryPincode}>
                <input
                  className="store-input"
                  type="text"
                  placeholder="400001"
                  value={form.deliveryPincode}
                  onChange={(e) => set("deliveryPincode", e.target.value)}
                  maxLength={6}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <Field label="Order Notes" error={errors.deliveryNotes}>
              <textarea
                className="store-input resize-none"
                rows={2}
                placeholder="Any special instructions (optional)"
                value={form.deliveryNotes}
                onChange={(e) => set("deliveryNotes", e.target.value)}
              />
            </Field>

            {business.deliveryNote && (
              <div
                className="flex items-start gap-2 text-xs p-3 rounded-lg"
                style={{
                  background: "var(--store-bg-secondary)",
                  color: "var(--store-text-secondary)",
                }}
              >
                <InfoIcon />
                <span>{business.deliveryNote}</span>
              </div>
            )}

            {apiError && (
              <div
                className="text-sm p-3.5 rounded-lg flex items-start gap-2"
                style={{
                  background: "var(--store-danger-bg)",
                  color: "var(--store-danger)",
                }}
              >
                <ErrorIcon />
                <span>{apiError}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full text-[15px] py-3.5"
              disabled={submitting}
              style={{ background: accent }}
            >
              {submitting ? (
                <span className="flex items-center gap-2.5">
                  <Spinner /> Placing order...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Place Order &middot; {symbol}
                  {subtotal.toFixed(2)}
                </span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        className="block text-sm font-medium"
        style={{ color: "var(--store-text)" }}
      >
        {label}
        {required && (
          <span className="ml-0.5" style={{ color: "var(--store-danger)" }}>
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-xs font-medium" style={{ color: "var(--store-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width="18"
      height="18"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

function BackIcon({ color }: { color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CartBagIcon({ color }: { color: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      style={{
        transition: "transform 0.2s",
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
      className="flex-shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ErrorIcon() {
  return (
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
      className="flex-shrink-0 mt-0.5"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

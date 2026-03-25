import { useState } from "react";
import type { CartItem, StoreConfig, OrderResult } from "../types";
import { placeOrder } from "../api";

interface CheckoutProps {
  cart: CartItem[];
  config: StoreConfig;
  slug: string;
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

const EMPTY_FORM: FormValues = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  deliveryAddress: "",
  deliveryCity: "",
  deliveryPincode: "",
  deliveryNotes: "",
};

export function Checkout({ cart, config, slug, onBack, onSuccess }: CheckoutProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "₹" : business.currency;

  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<FormValues>>({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");

  const subtotal = cart.reduce(
    (s, c) => s + parseFloat(c.item.price) * c.quantity,
    0
  );

  function set(field: keyof FormValues, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  function validate(): boolean {
    const next: Partial<FormValues> = {};
    if (!form.customerName.trim()) next.customerName = "Name is required";
    const phone = form.customerPhone.replace(/\D/g, "");
    if (!phone || phone.length < 10)
      next.customerPhone = "Enter a valid 10-digit phone number";
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
        customerPhone: form.customerPhone.replace(/\D/g, ""),
        customerEmail: form.customerEmail.trim() || undefined,
        deliveryAddress: form.deliveryAddress.trim() || undefined,
        deliveryCity: form.deliveryCity.trim() || undefined,
        deliveryPincode: form.deliveryPincode.trim() || undefined,
        deliveryNotes: form.deliveryNotes.trim() || undefined,
        items: cart.map((c) => ({ itemId: c.item.id, quantity: c.quantity })),
      });
      onSuccess(result);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-4 pb-24 animate-fade-in">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-4"
        style={{ color: "var(--store-accent)" }}
      >
        ← Back to cart
      </button>

      <h2
        className="text-xl font-bold mb-4"
        style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
      >
        Complete your order
      </h2>

      {/* Order summary */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{
          background: "var(--store-bg-alt)",
          border: "1px solid var(--store-border)",
        }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-wider mb-3"
          style={{ color: "var(--store-muted)" }}
        >
          Order Summary
        </p>
        <div className="space-y-2">
          {cart.map((entry) => (
            <div key={entry.item.id} className="flex justify-between text-sm">
              <span style={{ color: "var(--store-text-secondary)" }}>
                {entry.item.name} × {entry.quantity}
              </span>
              <span
                className="font-semibold tabular-nums"
                style={{ color: "var(--store-text)" }}
              >
                {symbol}
                {(parseFloat(entry.item.price) * entry.quantity).toFixed(0)}
              </span>
            </div>
          ))}
          <div
            className="flex justify-between text-sm font-bold pt-2 border-t"
            style={{
              borderColor: "var(--store-border)",
              color: business.accentColor || "var(--store-accent)",
            }}
          >
            <span>Total</span>
            <span>
              {symbol}
              {subtotal.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <p
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--store-muted)" }}
        >
          Your Details
        </p>

        <Field
          label="Full Name"
          required
          error={errors.customerName}
        >
          <input
            className="store-input"
            type="text"
            placeholder="Rahul Sharma"
            value={form.customerName}
            onChange={(e) => set("customerName", e.target.value)}
            autoComplete="name"
          />
        </Field>

        <Field
          label="Phone Number"
          required
          error={errors.customerPhone}
        >
          <div className="flex">
            <span
              className="inline-flex items-center px-3 border border-r-0 rounded-l-lg text-sm font-medium flex-shrink-0"
              style={{
                background: "var(--store-bg-alt)",
                borderColor: "var(--store-border)",
                color: "var(--store-text-secondary)",
              }}
            >
              +91
            </span>
            <input
              className="store-input rounded-l-none flex-1"
              type="tel"
              placeholder="98765 43210"
              value={form.customerPhone}
              onChange={(e) => set("customerPhone", e.target.value)}
              maxLength={14}
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
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
          <p
            className="text-xs p-3 rounded-lg"
            style={{
              background: "var(--store-bg-alt)",
              color: "var(--store-text-secondary)",
            }}
          >
            ℹ️ {business.deliveryNote}
          </p>
        )}

        {apiError && (
          <p
            className="text-sm p-3 rounded-lg"
            style={{
              background: "#fef2f2",
              color: "var(--store-danger)",
              border: "1px solid #fecaca",
            }}
          >
            {apiError}
          </p>
        )}

        <button
          type="submit"
          className="btn-accent w-full text-base py-3.5"
          disabled={submitting}
          style={
            business.accentColor
              ? { background: business.accentColor }
              : undefined
          }
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <Spinner /> Placing order...
            </span>
          ) : (
            `Place Order · ${symbol}${subtotal.toFixed(2)}`
          )}
        </button>
      </form>
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
      <label className="block text-sm font-medium" style={{ color: "var(--store-text)" }}>
        {label}
        {required && (
          <span className="ml-0.5" style={{ color: "var(--store-danger)" }}>
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-xs" style={{ color: "var(--store-danger)" }}>
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
      width="16"
      height="16"
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

import { useEffect, useState } from "react";
import type { OrderResult, StoreConfig } from "../types";

interface OrderConfirmationProps {
  result: OrderResult;
  config: StoreConfig;
  onContinueShopping: () => void;
}

export function OrderConfirmation({
  result,
  config,
  onContinueShopping,
}: OrderConfirmationProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "\u20B9" : business.currency;
  const accent = business.accentColor || "var(--store-accent)";

  const whatsappUrl = business.whatsappNumber
    ? buildWhatsAppUrl(
        business.whatsappNumber,
        result.orderNumber,
        business.name
      )
    : null;

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-4 py-8"
      style={{ background: "var(--store-bg-secondary)" }}
    >
      <ConfettiEffect accent={accent} />

      <div
        className="w-full max-w-sm rounded-2xl p-8 text-center animate-scale-in relative z-10"
        style={{
          background: "var(--store-bg)",
          boxShadow: "var(--store-shadow-lg)",
        }}
      >
        {/* Success animation */}
        <div className="relative mx-auto mb-6 w-24 h-24">
          {/* Pulse ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "var(--store-success-bg)",
              animation: "pulse-ring 1.5s ease-out",
            }}
          />
          {/* Circle */}
          <div
            className="relative w-24 h-24 rounded-full flex items-center justify-center animate-bounce-in"
            style={{ background: "var(--store-success-bg)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="44"
              height="44"
              style={{
                color: "var(--store-success)",
                strokeDasharray: 40,
                animation: "check-draw 0.5s ease-out 0.3s both",
              }}
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <h2
          className="text-2xl font-bold mb-1"
          style={{ color: "var(--store-text)", letterSpacing: "-0.03em" }}
        >
          Order Placed!
        </h2>
        <p
          className="text-sm mb-6"
          style={{ color: "var(--store-muted)" }}
        >
          Your order has been received successfully
        </p>

        {/* Order details */}
        <div
          className="rounded-xl p-4 mb-6 text-left space-y-3"
          style={{
            background: "var(--store-bg-secondary)",
          }}
        >
          <div className="flex justify-between items-center">
            <span
              className="text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--store-muted)" }}
            >
              Order No.
            </span>
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: accent }}
            >
              {result.orderNumber}
            </span>
          </div>
          <div
            className="h-px"
            style={{ background: "var(--store-border-light)" }}
          />
          <div className="flex justify-between items-center">
            <span
              className="text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--store-muted)" }}
            >
              Total Amount
            </span>
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: "var(--store-text)" }}
            >
              {symbol}
              {parseFloat(result.totalAmount).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Message */}
        <p
          className="text-sm leading-relaxed mb-6"
          style={{ color: "var(--store-text-secondary)" }}
        >
          <span className="font-semibold" style={{ color: "var(--store-text)" }}>
            {business.name}
          </span>{" "}
          will confirm your order shortly.{" "}
          {business.whatsappNumber
            ? "You can reach out on WhatsApp for updates."
            : "They will be in touch soon."}
        </p>

        {/* Actions */}
        <div className="space-y-3">
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full py-3 rounded-xl font-semibold text-sm text-white transition-transform active:scale-98"
              style={{ background: "#25D366" }}
            >
              <WhatsAppIcon />
              Chat on WhatsApp
            </a>
          )}
          <button
            onClick={onContinueShopping}
            className="btn-ghost w-full py-3"
            style={
              business.accentColor
                ? {
                    color: business.accentColor,
                    borderColor: business.accentColor,
                  }
                : undefined
            }
          >
            Continue Shopping
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lightweight confetti effect using CSS-only particles */
function ConfettiEffect({ accent }: { accent: string }) {
  const [particles, setParticles] = useState<
    Array<{ id: number; left: string; color: string; delay: string; size: number }>
  >([]);

  useEffect(() => {
    const colors = [accent, "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#f97316"];
    const items = Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      color: colors[Math.floor(Math.random() * colors.length)],
      delay: `${Math.random() * 0.8}s`,
      size: 6 + Math.random() * 6,
    }));
    setParticles(items);
  }, [accent]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute top-0"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animation: `confetti-fall ${1.5 + Math.random() * 1.5}s ease-in ${p.delay} forwards`,
          }}
        />
      ))}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="18"
      height="18"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function buildWhatsAppUrl(
  phone: string,
  orderNumber: string,
  businessName: string
): string {
  const cleaned = phone.replace(/\D/g, "");
  const number = cleaned.startsWith("91") ? cleaned : `91${cleaned}`;
  const msg = encodeURIComponent(
    `Hi, I just placed order ${orderNumber} at ${businessName}. Looking forward to confirmation!`
  );
  return `https://wa.me/${number}?text=${msg}`;
}

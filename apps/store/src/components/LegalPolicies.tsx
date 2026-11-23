import type { ReactNode } from "react";
import type { StoreConfig } from "../types";
import { formatMoney, toPaise } from "../money";

type Business = StoreConfig["business"];

/**
 * The text of the three policies every store shows, built from the store's own
 * settings. A line that depends on a setting appears only when the store has
 * that setting (an SMS code, a minimum order, a delivery note, a city); a line
 * that would be false for some store is not in here at all. The store takes no
 * online payment today, so no policy talks about payment processors.
 *
 * `POLICY_UPDATED` is NOT the day the page is viewed. It is the day the text
 * below last changed, so a customer who read a policy on one date can tell that
 * it is the same policy later. Change the date in the same commit as the text.
 */
export const POLICY_UPDATED = {
  privacy: "2026-11-22",
  terms: "2026-11-22",
  refund: "2026-11-22",
} as const;

/** "2026-11-22" -> "22 November 2026", whatever the reader's time zone. */
export function formatPolicyDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function LastUpdated({ iso }: { iso: string }) {
  return (
    <p className="mt-5 text-xs" style={{ color: "var(--store-muted)" }}>
      Last updated: <time dateTime={iso}>{formatPolicyDate(iso)}</time>
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

/** Who to contact: the store's phone, else its email, else a plain fallback. */
function contactOf(business: Business): string {
  return business.phone || business.email || "the store owner";
}

function HisaaboLink() {
  return (
    <a href="https://hisaabo.in" target="_blank" rel="noopener noreferrer">
      Hisaabo
    </a>
  );
}

export function PrivacyPolicy({ business }: { business: Business }) {
  const name = business.name;
  return (
    <div className="legal">
      <p>
        This store is powered by <HisaaboLink />. <strong>{name}</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;)
        operates this online store.
      </p>

      <Section title="Information We Collect">
        <ul>
          <li>Your name and mobile number, when you place an order</li>
          <li>Your email address, delivery address and order notes, only if you enter them</li>
          <li>
            Your cart, which is kept in your browser on this device so it is there when you come back. It reaches us
            only when you place an order.
          </li>
        </ul>
      </Section>

      <Section title="How We Use Your Information">
        <ul>
          <li>To process and fulfil your orders</li>
          <li>To contact you about your orders</li>
          {business.otpRequired && <li>To verify your mobile number with a one-time code sent by SMS</li>}
        </ul>
      </Section>

      <Section title="Data Sharing">
        <ul>
          <li>We do not sell your personal information</li>
          <li>
            Your order details are stored with <HisaaboLink />, the platform that runs this store
          </li>
          <li>
            A bot check from{" "}
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">
              Cloudflare
            </a>{" "}
            runs when you confirm your number and place an order
          </li>
          {business.otpRequired && <li>One-time codes are sent through an SMS provider</li>}
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          For any privacy concerns, contact <strong>{name}</strong> at {contactOf(business)}.
        </p>
      </Section>

      <LastUpdated iso={POLICY_UPDATED.privacy} />
    </div>
  );
}

function currencyName(currency: string): string {
  return currency === "INR" ? "Indian Rupees (₹)" : currency;
}

export function TermsOfService({ business }: { business: Business }) {
  const name = business.name;
  const hasMinimum = toPaise(business.minOrderAmount) > 0;
  const place = business.city
    ? `${business.city}${business.state ? `, ${business.state}` : ""}`
    : business.state || "";

  return (
    <div className="legal">
      <p>By placing an order on this store, you agree to these terms.</p>

      <Section title="Orders">
        <ul>
          <li>
            All orders are subject to confirmation by <strong>{name}</strong>
          </li>
          <li>Prices are in {currencyName(business.currency)} and may change without notice</li>
          {hasMinimum && (
            <li>The minimum order is {formatMoney(business.minOrderAmount, business.currency)}</li>
          )}
          <li>
            <strong>{name}</strong> reserves the right to cancel any order
          </li>
        </ul>
      </Section>

      <Section title="Payments">
        <p>
          This store does not take payments online. <strong>{name}</strong> will tell you how to pay when your order
          is confirmed.
        </p>
      </Section>

      <Section title="Delivery">
        <p>
          Delivery details and charges will be confirmed by <strong>{name}</strong>.
        </p>
        {business.deliveryNote && <p>Note from the store: {business.deliveryNote}</p>}
      </Section>

      {place && (
        <Section title="Disputes">
          <p>All disputes are subject to {place} jurisdiction.</p>
        </Section>
      )}

      <p className="mt-5 text-xs" style={{ color: "var(--store-muted)" }}>
        Powered by <HisaaboLink />
      </p>
      <LastUpdated iso={POLICY_UPDATED.terms} />
    </div>
  );
}

export function RefundPolicy({ business }: { business: Business }) {
  const name = business.name;
  return (
    <div className="legal">
      <p>
        Returns and refunds are handled directly by <strong>{name}</strong>.
      </p>

      <p>Please contact them for any return or refund requests.</p>

      <Section title="Contact">
        <p>
          Reach <strong>{name}</strong> at {contactOf(business)}.
        </p>
      </Section>

      <LastUpdated iso={POLICY_UPDATED.refund} />
    </div>
  );
}

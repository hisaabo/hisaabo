import { useState } from "react";
import type { StoreConfig } from "../types";

interface FooterProps {
  config: StoreConfig;
}

type LegalModal = "privacy" | "terms" | "refund" | null;

export function Footer({ config }: FooterProps) {
  const { business } = config;
  const [activeModal, setActiveModal] = useState<LegalModal>(null);

  const currentDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contactInfo = business.phone || business.email || "the contact information on this page";

  return (
    <>
      <footer
        className="border-t mt-8"
        style={{
          borderColor: "var(--store-border-light)",
          background: "var(--store-bg)",
        }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Business contact info */}
          {(business.phone || business.email || business.address) && (
            <div className="mb-5 pb-5 border-b" style={{ borderColor: "var(--store-border-light)" }}>
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--store-muted)" }}
              >
                Contact
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {business.phone && (
                  <a
                    href={`tel:${business.phone}`}
                    className="text-sm flex items-center gap-1.5"
                    style={{ color: "var(--store-text-secondary)" }}
                  >
                    <PhoneIcon />
                    {business.phone}
                  </a>
                )}
                {business.email && (
                  <a
                    href={`mailto:${business.email}`}
                    className="text-sm flex items-center gap-1.5"
                    style={{ color: "var(--store-text-secondary)" }}
                  >
                    <MailIcon />
                    {business.email}
                  </a>
                )}
                {business.address && (
                  <span
                    className="text-sm flex items-center gap-1.5"
                    style={{ color: "var(--store-text-secondary)" }}
                  >
                    <MapPinIcon />
                    {business.address}
                    {business.city ? `, ${business.city}` : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Legal links */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
            <button
              onClick={() => setActiveModal("privacy")}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--store-text-secondary)" }}
            >
              Privacy Policy
            </button>
            <span className="text-xs" style={{ color: "var(--store-border)" }}>
              |
            </span>
            <button
              onClick={() => setActiveModal("terms")}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--store-text-secondary)" }}
            >
              Terms of Service
            </button>
            <span className="text-xs" style={{ color: "var(--store-border)" }}>
              |
            </span>
            <button
              onClick={() => setActiveModal("refund")}
              className="text-xs font-medium hover:underline"
              style={{ color: "var(--store-text-secondary)" }}
            >
              Refund Policy
            </button>
          </div>

          {/* Ownership + Powered by */}
          <div className="space-y-1.5">
            <p className="text-xs" style={{ color: "var(--store-muted)" }}>
              All content and products on this page are owned by{" "}
              <span className="font-medium" style={{ color: "var(--store-text-secondary)" }}>
                {business.name}
              </span>
            </p>
            <p className="text-xs" style={{ color: "var(--store-muted)" }}>
              Powered by{" "}
              <a
                href="https://hisaabo.in"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold hover:underline"
                style={{ color: "var(--store-text-secondary)" }}
              >
                Hisaabo
              </a>
            </p>
          </div>
        </div>
      </footer>

      {/* Legal Modals */}
      {activeModal && (
        <LegalModalOverlay onClose={() => setActiveModal(null)}>
          {activeModal === "privacy" && (
            <PrivacyPolicy
              businessName={business.name}
              contactInfo={contactInfo}
              currentDate={currentDate}
            />
          )}
          {activeModal === "terms" && (
            <TermsOfService
              businessName={business.name}
              cityState={
                business.city
                  ? `${business.city}${business.state ? `, ${business.state}` : ""}`
                  : business.state || "applicable"
              }
            />
          )}
          {activeModal === "refund" && (
            <RefundPolicy
              businessName={business.name}
              contactInfo={contactInfo}
            />
          )}
        </LegalModalOverlay>
      )}
    </>
  );
}

function LegalModalOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-content" onClick={onClose}>
        <div
          className="w-full max-w-lg max-h-[85dvh] rounded-2xl overflow-hidden flex flex-col animate-scale-in"
          style={{
            background: "var(--store-bg)",
            boxShadow: "var(--store-shadow-xl)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <div className="flex justify-end p-3 pb-0">
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "var(--store-bg-alt)" }}
              aria-label="Close"
            >
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
                style={{ color: "var(--store-text-secondary)" }}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto px-6 pb-6">{children}</div>
        </div>
      </div>
    </>
  );
}

function PrivacyPolicy({
  businessName,
  contactInfo,
  currentDate,
}: {
  businessName: string;
  contactInfo: string;
  currentDate: string;
}) {
  return (
    <div className="legal-content">
      <h2
        className="text-xl font-bold mb-4"
        style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
      >
        Privacy Policy
      </h2>

      <p className="text-sm mb-4" style={{ color: "var(--store-text-secondary)" }}>
        This store is powered by Hisaabo.{" "}
        <strong style={{ color: "var(--store-text)" }}>{businessName}</strong> ("we", "us")
        operates this online store.
      </p>

      <Section title="Information We Collect">
        <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: "var(--store-text-secondary)" }}>
          <li>Name, phone number, email (when you place an order)</li>
          <li>Delivery address (if provided)</li>
        </ul>
      </Section>

      <Section title="How We Use Your Information">
        <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: "var(--store-text-secondary)" }}>
          <li>To process and fulfill your orders</li>
          <li>To communicate with you about your orders</li>
          <li>To improve our services</li>
        </ul>
      </Section>

      <Section title="Data Sharing">
        <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: "var(--store-text-secondary)" }}>
          <li>We do not sell your personal information</li>
          <li>Payment processing is handled by certified payment partners</li>
          <li>
            Your data is stored securely by{" "}
            <a
              href="https://hisaabo.in"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--store-accent)" }}
            >
              Hisaabo
            </a>
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
          For any privacy concerns, contact{" "}
          <strong style={{ color: "var(--store-text)" }}>{businessName}</strong> at{" "}
          {contactInfo}.
        </p>
      </Section>

      <p className="text-xs mt-5" style={{ color: "var(--store-muted)" }}>
        Last updated: {currentDate}
      </p>
    </div>
  );
}

function TermsOfService({
  businessName,
  cityState,
}: {
  businessName: string;
  cityState: string;
}) {
  return (
    <div className="legal-content">
      <h2
        className="text-xl font-bold mb-4"
        style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
      >
        Terms of Service
      </h2>

      <p className="text-sm mb-4" style={{ color: "var(--store-text-secondary)" }}>
        By placing an order on this store, you agree to these terms.
      </p>

      <Section title="Orders">
        <ul className="list-disc list-inside space-y-1 text-sm" style={{ color: "var(--store-text-secondary)" }}>
          <li>
            All orders are subject to confirmation by{" "}
            <strong style={{ color: "var(--store-text)" }}>{businessName}</strong>
          </li>
          <li>
            Prices are in Indian Rupees ({"\u20B9"}) and may change without notice
          </li>
          <li>
            <strong style={{ color: "var(--store-text)" }}>{businessName}</strong> reserves the
            right to cancel any order
          </li>
        </ul>
      </Section>

      <Section title="Payments">
        <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
          Payment terms will be communicated by{" "}
          <strong style={{ color: "var(--store-text)" }}>{businessName}</strong> upon order
          confirmation.
        </p>
      </Section>

      <Section title="Delivery">
        <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
          Delivery details and charges will be confirmed by{" "}
          <strong style={{ color: "var(--store-text)" }}>{businessName}</strong>.
        </p>
      </Section>

      <Section title="Disputes">
        <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
          All disputes are subject to {cityState} jurisdiction.
        </p>
      </Section>

      <p className="text-xs mt-5" style={{ color: "var(--store-muted)" }}>
        Powered by{" "}
        <a
          href="https://hisaabo.in"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: "var(--store-accent)" }}
        >
          Hisaabo
        </a>
      </p>
    </div>
  );
}

function RefundPolicy({
  businessName,
  contactInfo,
}: {
  businessName: string;
  contactInfo: string;
}) {
  return (
    <div className="legal-content">
      <h2
        className="text-xl font-bold mb-4"
        style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}
      >
        Refund Policy
      </h2>

      <p className="text-sm mb-4" style={{ color: "var(--store-text-secondary)" }}>
        Returns and refunds are handled directly by{" "}
        <strong style={{ color: "var(--store-text)" }}>{businessName}</strong>.
      </p>

      <p className="text-sm mb-4" style={{ color: "var(--store-text-secondary)" }}>
        Please contact them for any return or refund requests.
      </p>

      <Section title="Contact">
        <p className="text-sm" style={{ color: "var(--store-text-secondary)" }}>
          Reach <strong style={{ color: "var(--store-text)" }}>{businessName}</strong> at{" "}
          {contactInfo}.
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--store-text)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function PhoneIcon() {
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
      className="flex-shrink-0"
    >
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  );
}

function MailIcon() {
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
      className="flex-shrink-0"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function MapPinIcon() {
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
      className="flex-shrink-0"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

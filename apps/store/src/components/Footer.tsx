import { useState } from "react";
import type { StoreConfig } from "../types";
import { Dialog } from "./Dialog";
import { MailIcon, MapPinIcon, PhoneIcon } from "./Icons";

interface FooterProps {
  config: StoreConfig;
}

type LegalModal = "privacy" | "terms" | "refund";

const LEGAL_TITLES: Record<LegalModal, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  refund: "Refund Policy",
};

export function Footer({ config }: FooterProps) {
  const { business } = config;
  const [activeModal, setActiveModal] = useState<LegalModal | null>(null);

  const currentDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const contactInfo = business.phone || business.email || "the contact information on this page";
  const hasContact = Boolean(business.phone || business.email || business.address);

  return (
    <>
      {/* Same container as the grid above it, so the two line up. */}
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <p className="footer-h">{business.name}</p>
              {hasContact && (
                <div className="mt-3">
                  {business.phone && (
                    <a href={`tel:${business.phone}`} className="footer-line">
                      <PhoneIcon size={16} />
                      {business.phone}
                    </a>
                  )}
                  {business.email && (
                    <a href={`mailto:${business.email}`} className="footer-line">
                      <MailIcon size={16} />
                      {business.email}
                    </a>
                  )}
                  {business.address && (
                    <p className="footer-line">
                      <MapPinIcon size={16} />
                      <span>
                        {business.address}
                        {business.city ? `, ${business.city}` : ""}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <nav aria-label="Store policies">
              <p className="footer-h">Policies</p>
              <ul className="mt-3 flex flex-col items-start">
                {(Object.keys(LEGAL_TITLES) as LegalModal[]).map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setActiveModal(key)}
                    >
                      {LEGAL_TITLES[key]}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="footer-fine">
            <p>
              All content and products on this page are owned by{" "}
              <span className="font-medium" style={{ color: "var(--store-text-secondary)" }}>
                {business.name}
              </span>
              . Powered by{" "}
              <a
                href="https://hisaabo.in"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline"
                style={{ color: "var(--store-text-secondary)" }}
              >
                Hisaabo
              </a>
              .
            </p>
          </div>
        </div>
      </footer>

      {activeModal && (
        <Dialog title={LEGAL_TITLES[activeModal]} onClose={() => setActiveModal(null)} bodyFocusable>
          {activeModal === "privacy" && (
            <PrivacyPolicy businessName={business.name} contactInfo={contactInfo} currentDate={currentDate} />
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
          {activeModal === "refund" && <RefundPolicy businessName={business.name} contactInfo={contactInfo} />}
        </Dialog>
      )}
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
    <div className="legal">
      <p>
        This store is powered by Hisaabo.{" "}
        <strong>{businessName}</strong> ("we", "us")
        operates this online store.
      </p>

      <Section title="Information We Collect">
        <ul>
          <li>Name, phone number, email (when you place an order)</li>
          <li>Delivery address (if provided)</li>
        </ul>
      </Section>

      <Section title="How We Use Your Information">
        <ul>
          <li>To process and fulfill your orders</li>
          <li>To communicate with you about your orders</li>
          <li>To improve our services</li>
        </ul>
      </Section>

      <Section title="Data Sharing">
        <ul>
          <li>We do not sell your personal information</li>
          <li>Payment processing is handled by certified payment partners</li>
          <li>
            Your data is stored securely by{" "}
            <a
              href="https://hisaabo.in"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hisaabo
            </a>
          </li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>
          For any privacy concerns, contact{" "}
          <strong>{businessName}</strong> at{" "}
          {contactInfo}.
        </p>
      </Section>

      <p className="mt-5 text-xs" style={{ color: "var(--store-muted)" }}>
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
    <div className="legal">
      <p>
        By placing an order on this store, you agree to these terms.
      </p>

      <Section title="Orders">
        <ul>
          <li>
            All orders are subject to confirmation by{" "}
            <strong>{businessName}</strong>
          </li>
          <li>
            Prices are in Indian Rupees ({"\u20B9"}) and may change without notice
          </li>
          <li>
            <strong>{businessName}</strong> reserves the
            right to cancel any order
          </li>
        </ul>
      </Section>

      <Section title="Payments">
        <p>
          Payment terms will be communicated by{" "}
          <strong>{businessName}</strong> upon order
          confirmation.
        </p>
      </Section>

      <Section title="Delivery">
        <p>
          Delivery details and charges will be confirmed by{" "}
          <strong>{businessName}</strong>.
        </p>
      </Section>

      <Section title="Disputes">
        <p>
          All disputes are subject to {cityState} jurisdiction.
        </p>
      </Section>

      <p className="mt-5 text-xs" style={{ color: "var(--store-muted)" }}>
        Powered by{" "}
        <a
          href="https://hisaabo.in"
          target="_blank"
          rel="noopener noreferrer"
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
    <div className="legal">
      <p>
        Returns and refunds are handled directly by{" "}
        <strong>{businessName}</strong>.
      </p>

      <p>
        Please contact them for any return or refund requests.
      </p>

      <Section title="Contact">
        <p>
          Reach <strong>{businessName}</strong> at{" "}
          {contactInfo}.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h3>{title}</h3>
      {children}
    </>
  );
}

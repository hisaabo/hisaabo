import { useState } from "react";
import type { StoreConfig } from "../types";
import { Dialog } from "./Dialog";
import { PrivacyPolicy, RefundPolicy, TermsOfService } from "./LegalPolicies";
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
          {activeModal === "privacy" && <PrivacyPolicy business={business} />}
          {activeModal === "terms" && <TermsOfService business={business} />}
          {activeModal === "refund" && <RefundPolicy business={business} />}
        </Dialog>
      )}
    </>
  );
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PrivacyPolicy, RefundPolicy, TermsOfService, POLICY_UPDATED, formatPolicyDate } from "./LegalPolicies";
import type { StoreConfig } from "../types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Business = StoreConfig["business"];

const bare: Business = { name: "Jaisa Organics", currency: "INR" };
const full: Business = {
  ...bare,
  phone: "+91 98765 43210",
  email: "hello@jaisaorganics.example",
  city: "Pune",
  state: "Maharashtra",
  minOrderAmount: "1000.00",
  deliveryNote: "Delivery in 3 to 5 days.",
  otpRequired: true,
};

const text = (ui: React.ReactElement) => render(ui).container.textContent ?? "";

describe("policy dates", () => {
  it("are fixed dates of the text, not the day the page is opened", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-05-01T10:00:00Z"));
    for (const [policy, expected] of [
      [<PrivacyPolicy key="p" business={full} />, "22 November 2026"],
      [<TermsOfService key="t" business={full} />, "22 November 2026"],
      [<RefundPolicy key="r" business={full} />, "22 November 2026"],
    ] as const) {
      const rendered = text(policy);
      expect(rendered).toContain(`Last updated: ${expected}`);
      expect(rendered).not.toContain("2031");
      cleanup();
    }
  });

  it("are valid ISO dates in the past or today, one per policy", () => {
    for (const iso of Object.values(POLICY_UPDATED)) {
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(iso))).toBe(false);
    }
  });

  it("are formatted the same in every time zone", () => {
    expect(formatPolicyDate("2026-11-22")).toBe("22 November 2026");
    expect(formatPolicyDate("2027-01-01")).toBe("1 January 2027");
  });

  it("carry a machine-readable date", () => {
    const { container } = render(<PrivacyPolicy business={full} />);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(POLICY_UPDATED.privacy);
  });
});

describe("claims a store may not satisfy", () => {
  it("no policy mentions payment partners: the store takes no online payment", () => {
    for (const policy of [PrivacyPolicy, TermsOfService, RefundPolicy]) {
      for (const business of [bare, full]) {
        const rendered = text(policy({ business }));
        expect(rendered).not.toMatch(/payment (processing|partners)|certified/i);
        cleanup();
      }
    }
  });

  it("the terms say plainly that payment is not taken online", () => {
    expect(text(<TermsOfService business={bare} />)).toContain("does not take payments online");
  });

  it("mentions the SMS code only for a store that requires one", () => {
    expect(text(<PrivacyPolicy business={bare} />)).not.toMatch(/SMS|one-time/i);
    cleanup();
    const rendered = text(<PrivacyPolicy business={full} />);
    expect(rendered).toContain("one-time code sent by SMS");
    expect(rendered).toContain("SMS provider");
  });

  it("does not claim the data is used 'to improve our services', which nothing here does", () => {
    expect(text(<PrivacyPolicy business={full} />)).not.toMatch(/improve our services/i);
  });

  it("says where the data lives and what the browser keeps, without claiming it is 'securely' stored", () => {
    const rendered = text(<PrivacyPolicy business={bare} />);
    expect(rendered).toContain("stored with Hisaabo");
    expect(rendered).toContain("kept in your browser");
    expect(rendered).not.toMatch(/securely/i);
  });
});

describe("terms follow the store's settings", () => {
  it("shows the minimum order, the delivery note and the jurisdiction only when set", () => {
    const sparse = text(<TermsOfService business={bare} />);
    expect(sparse).not.toMatch(/minimum order/i);
    expect(sparse).not.toContain("Note from the store");
    expect(sparse).not.toMatch(/jurisdiction/i);
    cleanup();

    const rich = text(<TermsOfService business={full} />);
    expect(rich).toContain("The minimum order is ₹1,000");
    expect(rich).toContain("Note from the store: Delivery in 3 to 5 days.");
    expect(rich).toContain("All disputes are subject to Pune, Maharashtra jurisdiction.");
  });

  it("names the store's own currency instead of assuming rupees", () => {
    expect(text(<TermsOfService business={bare} />)).toContain("Indian Rupees (₹)");
    cleanup();
    expect(text(<TermsOfService business={{ ...bare, currency: "USD" }} />)).toContain("Prices are in USD");
  });

  it("uses the state alone when there is no city", () => {
    expect(text(<TermsOfService business={{ ...bare, state: "Goa" }} />)).toContain("subject to Goa jurisdiction");
  });
});

describe("contact lines", () => {
  it("point at the store's phone, else its email, else the owner", () => {
    expect(text(<RefundPolicy business={full} />)).toContain("at +91 98765 43210");
    cleanup();
    expect(text(<RefundPolicy business={{ ...bare, email: "a@b.example" }} />)).toContain("at a@b.example");
    cleanup();
    expect(text(<RefundPolicy business={bare} />)).toContain("at the store owner");
  });
});

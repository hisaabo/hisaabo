import { describe, it, expect } from "vitest";
import {
  renderEmailChangeConfirmation,
  renderEmailChangedNotice,
  renderSecurityNotice,
  escapeHtml,
} from "../lib/email-templates";

describe("renderEmailChangeConfirmation", () => {
  const url = "https://app.example.com/auth/confirm-email-change?token=abc123";

  it("has the required subject, body sentence and button, and never reads like a sign-in email", () => {
    const { subject, html, text } = renderEmailChangeConfirmation(url, "owner@example.com");
    expect(subject).toBe("Confirm your new Hisaabo email address");
    expect(html).toContain("Confirm email change");
    expect(html).toContain("The Hisaabo account <strong>owner@example.com</strong> asked to use this address as its sign-in email.");
    expect(html).toContain("If that was you, confirm below while signed in to that account.");
    expect(html).toContain("If you didn't ask for this, ignore this email. Nothing will change and no account will be created.");
    // "Sign in" must not appear anywhere a reader could mistake this for a sign-in email.
    expect(subject).not.toMatch(/sign in/i);
    expect(html).not.toMatch(/sign in/i);
    expect(text).not.toMatch(/sign in/i);
    expect(html).not.toMatch(/<h1[^>]*>[^<]*sign in/i);
    expect(html).toContain(escapeHtml(url));
  });

  it("escapes the current email and interpolates nothing else about the account", () => {
    const evil = `"><img src=x onerror=alert(1)>@evil.example`;
    const { html } = renderEmailChangeConfirmation(url, evil);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(escapeHtml(evil));
  });

  it("escapes the URL in attributes", () => {
    const { html } = renderEmailChangeConfirmation(`https://x.example/?a=1&b="2"`, "a@b.in");
    expect(html).toContain("a=1&amp;b=&quot;2&quot;");
    expect(html).not.toContain(`b="2"`);
  });
});

describe("renderEmailChangedNotice", () => {
  it("names the new address and tells the reader to contact support", () => {
    const { subject, html } = renderEmailChangedNotice("old@example.com", "new@example.com");
    expect(subject).toBe("Your Hisaabo sign-in email was changed");
    expect(html).toContain("Your Hisaabo sign-in email was changed to <strong>new@example.com</strong>.");
    expect(html).toContain("contact support");
  });

  it("escapes both addresses", () => {
    const { html } = renderEmailChangedNotice("o<b>@x.in", "n<i>@x.in");
    expect(html).not.toContain("<b>@x.in");
    expect(html).not.toContain("<i>@x.in");
  });
});

describe("renderSecurityNotice", () => {
  it("lists every member with role, per organisation, and tells the user where to act", () => {
    const { subject, html, text } = renderSecurityNotice([
      { orgName: "Acme Traders", members: [{ email: "a@x.in", role: "admin" }, { email: "b@x.in", role: "member" }] },
    ]);
    expect(subject).toBe("Review who has access to your Hisaabo organization");
    expect(html).toContain("You confirmed this email address for the first time.");
    expect(html).toContain("These people were given access to <strong>Acme Traders</strong> before that:");
    expect(html).toContain("a@x.in &mdash; admin");
    expect(html).toContain("b@x.in &mdash; member");
    expect(html).toContain("Settings &rarr; Team");
    expect(html).toContain("bank and UPI details, payment gateway and e-invoice settings");
    expect(text).toContain("a@x.in - admin");
  });

  it("escapes organisation names, emails and roles", () => {
    const { html } = renderSecurityNotice([
      { orgName: `<script>alert(1)</script>`, members: [{ email: `x"><svg onload=1>@e.in`, role: "<b>admin</b>" }] },
    ]);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<svg onload=1>");
    expect(html).not.toContain("<b>admin</b>");
  });
});

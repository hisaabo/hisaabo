import { describe, it, expect } from "vitest";
import {
  storeMetaSummary,
  injectStoreMeta,
  normalizeAccent,
  escapeHtml,
  DEFAULT_ACCENT,
} from "../lib/og/meta.js";

describe("normalizeAccent", () => {
  it("accepts #rgb and #rrggbb", () => {
    expect(normalizeAccent("#fff")).toBe("#fff");
    expect(normalizeAccent("#5b5bd6")).toBe("#5b5bd6");
  });
  it("falls back on invalid / missing values", () => {
    expect(normalizeAccent(null)).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent("red")).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent("#12")).toBe(DEFAULT_ACCENT);
    expect(normalizeAccent("#5b5bd6; background:url(x)")).toBe(DEFAULT_ACCENT);
  });
});

describe("escapeHtml", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });
});

describe("storeMetaSummary", () => {
  const base = {
    slug: "my-bakery",
    apiBaseUrl: "https://api.hisaabo.in/",
    storeBaseUrl: "https://store.hisaabo.in/",
  };

  it("builds title/description/og image + store url", () => {
    const m = storeMetaSummary({ ...base, name: "My Bakery", tagline: "Fresh daily", accentColor: "#abc" });
    expect(m.title).toBe("My Bakery — Online Store");
    expect(m.description).toBe("Fresh daily");
    expect(m.ogImageUrl).toBe("https://api.hisaabo.in/store/my-bakery/og.png");
    expect(m.storeUrl).toBe("https://store.hisaabo.in/my-bakery");
    expect(m.accentColor).toBe("#abc");
  });

  it("derives a description when there's no tagline", () => {
    const m = storeMetaSummary({ ...base, name: "My Bakery", tagline: null, accentColor: null });
    expect(m.description).toBe("Shop online at My Bakery");
    expect(m.accentColor).toBe(DEFAULT_ACCENT);
  });
});

describe("injectStoreMeta", () => {
  // Trimmed-down shell mirroring apps/store/index.html.
  const shell = `<!doctype html><html><head>
    <title>Online Store</title>
    <meta name="description" content="Shop online" />
    <meta name="theme-color" content="#5b5bd6" />
    <meta property="og:title" content="Online Store" />
    <meta property="og:description" content="Shop online" />
    <meta property="og:image" content="/og-image.png" />
    <meta name="twitter:title" content="Online Store" />
    <meta name="twitter:description" content="Shop online" />
    <meta name="twitter:image" content="/og-image.png" />
  </head><body></body></html>`;

  const meta = storeMetaSummary({
    slug: "my-bakery",
    name: "My Bakery",
    tagline: "Fresh daily",
    accentColor: "#abcdef",
    apiBaseUrl: "https://api.hisaabo.in",
    storeBaseUrl: "https://store.hisaabo.in",
  });

  it("rewrites title + og/twitter tags and adds og:url + JSON-LD", () => {
    const out = injectStoreMeta(shell, meta);
    expect(out).toContain("<title>My Bakery — Online Store</title>");
    expect(out).toContain('<meta property="og:title" content="My Bakery — Online Store" />');
    expect(out).toContain('<meta property="og:image" content="https://api.hisaabo.in/store/my-bakery/og.png" />');
    expect(out).toContain('<meta name="twitter:image" content="https://api.hisaabo.in/store/my-bakery/og.png" />');
    expect(out).toContain('content="https://store.hisaabo.in/my-bakery"'); // og:url added
    expect(out).toContain('<meta name="theme-color" content="#abcdef" />');
    expect(out).toContain('application/ld+json');
    expect(out).toContain('"@type":"Store"');
    // No leftover defaults.
    expect(out).not.toContain(">Online Store<");
    expect(out).not.toContain("/og-image.png");
  });

  it("escapes injected values to prevent attribute breakout", () => {
    const evil = storeMetaSummary({
      slug: "x",
      name: `Evil" /><script>alert(1)</script>`,
      tagline: null,
      accentColor: null,
      apiBaseUrl: "https://api.hisaabo.in",
      storeBaseUrl: "https://store.hisaabo.in",
    });
    const out = injectStoreMeta(shell, evil);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

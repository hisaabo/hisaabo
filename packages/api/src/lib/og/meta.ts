import type { StoreMetaSummary } from "./types.js";

/** Default accent when a business hasn't picked one (matches the SPA default). */
export const DEFAULT_ACCENT = "#5b5bd6";

/** Accept only #rgb / #rrggbb so it's safe to drop into HTML/SVG unescaped. */
export function normalizeAccent(value: string | null | undefined): string {
  if (value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return value;
  return DEFAULT_ACCENT;
}

/** Minimal HTML attribute/text escaping for values we inject into the shell. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface StoreMetaInput {
  slug: string;
  name: string;
  tagline: string | null;
  accentColor: string | null;
  /** Absolute base of the API that serves /store/:slug/og.png (no trailing slash). */
  apiBaseUrl: string;
  /** Absolute base of the public storefront (no trailing slash). */
  storeBaseUrl: string;
}

/** Build the per-store meta summary (title/description/og:image/url). */
export function storeMetaSummary(input: StoreMetaInput): StoreMetaSummary {
  const name = input.name.trim() || "Online Store";
  const description =
    (input.tagline && input.tagline.trim()) || `Shop online at ${name}`;
  const api = input.apiBaseUrl.replace(/\/$/, "");
  const store = input.storeBaseUrl.replace(/\/$/, "");
  return {
    title: `${name} — Online Store`,
    description,
    ogImageUrl: `${api}/store/${encodeURIComponent(input.slug)}/og.png`,
    storeUrl: `${store}/${encodeURIComponent(input.slug)}`,
    accentColor: normalizeAccent(input.accentColor),
  };
}

/**
 * Serialize a value for embedding inside a <script> tag. JSON.stringify alone
 * is unsafe here: a string containing `</script>` (or `<!--`) would break out
 * of the element. Escaping `<`, `>`, `&` to their \u form keeps the JSON valid
 * while making breakout impossible.
 */
export function jsonLdScriptSafe(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** Replace the `content="..."` of a <meta property="prop"> tag, if present. */
function setMetaContent(html: string, attr: "property" | "name", key: string, value: string): string {
  const esc = escapeHtml(value);
  const re = new RegExp(
    `(<meta\\s+${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*\\bcontent=["'])[^"']*(["'])`,
    "i",
  );
  return html.replace(re, `$1${esc}$2`);
}

/**
 * Inject per-store metadata into the store SPA's HTML shell. Operates on the
 * static index.html so crawlers (which don't run JS) see the right OG tags.
 * Pure string transform — safe to unit test.
 */
export function injectStoreMeta(html: string, meta: StoreMetaSummary): string {
  let out = html;

  // <title>
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);

  // Standard + Open Graph + Twitter tags.
  out = setMetaContent(out, "name", "description", meta.description);
  out = setMetaContent(out, "name", "theme-color", meta.accentColor);
  out = setMetaContent(out, "property", "og:title", meta.title);
  out = setMetaContent(out, "property", "og:description", meta.description);
  out = setMetaContent(out, "property", "og:image", meta.ogImageUrl);
  out = setMetaContent(out, "name", "twitter:title", meta.title);
  out = setMetaContent(out, "name", "twitter:description", meta.description);
  out = setMetaContent(out, "name", "twitter:image", meta.ogImageUrl);

  // og:url isn't in the default shell — add it alongside og:image.
  if (!/property=["']og:url["']/i.test(out)) {
    out = out.replace(
      /(<meta\s+property=["']og:image["'][^>]*>)/i,
      `$1\n    <meta property="og:url" content="${escapeHtml(meta.storeUrl)}" />`,
    );
  } else {
    out = setMetaContent(out, "property", "og:url", meta.storeUrl);
  }

  // Structured data for search engines.
  const jsonLd = jsonLdScriptSafe({
    "@context": "https://schema.org",
    "@type": "Store",
    name: meta.title.replace(/ — Online Store$/, ""),
    description: meta.description,
    url: meta.storeUrl,
    image: meta.ogImageUrl,
  });
  out = out.replace(
    /<\/head>/i,
    `  <script type="application/ld+json">${jsonLd}</script>\n  </head>`,
  );

  return out;
}

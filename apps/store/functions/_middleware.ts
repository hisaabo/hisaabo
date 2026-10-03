/**
 * Cloudflare Pages Function — per-store Open Graph meta injection.
 *
 * The storefront is a static SPA, so its index.html ships with generic default
 * <meta> tags. Social crawlers (WhatsApp, Twitter/X, Facebook, LinkedIn) don't
 * run JS, so client-side updates never reach them. This middleware intercepts
 * the document request for `/<slug>`, fetches the store's identity from the API,
 * and rewrites the title + og:/twitter: tags in the served HTML using the
 * runtime-native HTMLRewriter. The dynamic share image itself is generated and
 * cached by the API at `${API}/store/<slug>/og.png`.
 *
 * Non-document requests (assets, the SPA's own JSON fetches) fall straight
 * through to the static asset handler.
 */

// Minimal ambient typings so this file needs no extra dependency. The
// Cloudflare runtime provides HTMLRewriter and the Pages Functions shape.
interface Env {
  /** API base, e.g. https://api.hisaabo.in. Set in the Pages project env. */
  API_URL?: string;
}
type PagesContext = {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
};
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handler: unknown): { transform(res: Response): Response };
  };
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

function setAttr(name: string, value: string) {
  return { element(el: { setAttribute(k: string, v: string): void }) { el.setAttribute(name, value); } };
}
function setText(value: string) {
  return { element(el: { setInnerContent(v: string): void }) { el.setInnerContent(value); } };
}
function appendToHead(html: string) {
  return {
    element(el: { append(content: string, opts: { html: boolean }): void }) {
      el.append(html, { html: true });
    },
  };
}

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  const { request, env, next } = ctx;
  const url = new URL(request.url);

  // Only rewrite top-level store document requests: GET, HTML-accepting, and a
  // single path segment that looks like a slug (skip assets, /privacy, etc.).
  const segments = url.pathname.split("/").filter(Boolean);
  const slug = segments[0];
  const wantsHtml = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  if (!wantsHtml || segments.length !== 1 || !slug || !SLUG_RE.test(slug)) {
    return next();
  }

  // Serve the static index.html first.
  const res = await next();
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;

  const apiBase = (env.API_URL ?? "https://api.hisaabo.in").replace(/\/$/, "");

  // Fetch store identity. On any miss/error, leave the default tags in place.
  let name = "";
  let tagline = "";
  let accent = "";
  try {
    const metaRes = await fetch(`${apiBase}/store/${slug}/meta.json`);
    if (!metaRes.ok) return res;
    const meta = (await metaRes.json()) as { name?: string; tagline?: string; accentColor?: string };
    name = (meta.name ?? "").trim();
    tagline = (meta.tagline ?? "").trim();
    accent = (meta.accentColor ?? "").trim();
  } catch {
    return res;
  }
  if (!name) return res;

  const title = `${name} — Online Store`;
  const description = tagline || `Shop online at ${name}`;
  const ogImage = `${apiBase}/store/${slug}/og.png`;
  const storeUrl = `${url.protocol}//${url.host}/${slug}`;
  const accentOk = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accent);

  // Escape <,>,& to \u form so a name containing "</script>" can't break out
  // of the JSON-LD <script> block.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Store",
    name,
    description,
    url: storeUrl,
    image: ogImage,
  })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  let rw = new HTMLRewriter()
    .on("title", setText(title))
    .on('meta[name="description"]', setAttr("content", description))
    .on('meta[property="og:title"]', setAttr("content", title))
    .on('meta[property="og:description"]', setAttr("content", description))
    .on('meta[property="og:image"]', setAttr("content", ogImage))
    .on('meta[name="twitter:title"]', setAttr("content", title))
    .on('meta[name="twitter:description"]', setAttr("content", description))
    .on('meta[name="twitter:image"]', setAttr("content", ogImage))
    .on(
      "head",
      appendToHead(
        `<meta property="og:url" content="${storeUrl}" />` +
          `<script type="application/ld+json">${jsonLd}</script>`,
      ),
    );
  if (accentOk) {
    rw = rw.on('meta[name="theme-color"]', setAttr("content", accent));
  }

  return rw.transform(res);
};

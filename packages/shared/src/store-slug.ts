/**
 * Reserved public store slugs (store.hisaabo.in/<slug>).
 *
 * Single source of truth, used by the API (store.updateSettings / checkSlug /
 * self-import) and by the web client-side validation. Without it anyone could
 * claim `login`, `support`, `hisaabo`, ... and impersonate the platform on a
 * hisaabo.in address (including in OTP SMS that carry the store name).
 *
 * A slug is reserved when it is on the list below, OR when it carries the brand
 * name as a whole leading/trailing segment (`hisaabo-*`, `*-hisaabo`), which
 * would otherwise let `hisaabo-support` or `acme-hisaabo` pass as official.
 * `hisaab-` is deliberately NOT treated that way: "hisaab" is an ordinary word
 * and many real businesses use it in their name (only the bare slug `hisaab`
 * is on the list).
 *
 * GRANDFATHERING: only a slug that is being SET or CHANGED is checked. A business
 * that already holds a reserved slug keeps it, keeps saving other settings, and
 * its store keeps resolving: the public lookup never consults this list. Use
 * `checkStoreSlugReserved(requested, current)`, which encodes that rule.
 */

export const RESERVED_STORE_SLUGS: readonly string[] = [
  // Platform / brand
  "hisaabo",
  "hisaab",
  "official",
  "team",
  "staff",
  // Auth, account and infrastructure paths
  "admin",
  "api",
  "app",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "auth",
  "account",
  "oauth",
  "verify",
  "otp",
  "www",
  "mail",
  "email",
  "static",
  "assets",
  "cdn",
  "ops",
  "dashboard",
  "settings",
  "security",
  "secure",
  "kyc",
  "health",
  "user",
  "users",
  "profile",
  "home",
  "search",
  "pricing",
  "download",
  "test",
  "demo",
  "null",
  "undefined",
  // Commerce flow
  "pay",
  "checkout",
  "cart",
  "order",
  "orders",
  "billing",
  "invoice",
  "invoices",
  "payment",
  "payments",
  "upi",
  // Marketing / support / legal pages
  "store",
  "stores",
  "shop",
  "docs",
  "help",
  "support",
  "status",
  "blog",
  "about",
  "contact",
  "customer-care",
  "privacy",
  "terms",
  "refund",
  "refunds",
  "policy",
  "legal",
  // Paths the storefront itself serves at the top level (apps/store):
  // `/index` (index.html); `/assets` (build output) and `/store/...` (asset
  // endpoints) are listed above.
  "index",
];

const RESERVED_SET: ReadonlySet<string> = new Set(RESERVED_STORE_SLUGS);

export const STORE_SLUG_RESERVED_MESSAGE =
  "This store address is reserved. Please choose a different one.";

/** Brand name as a whole leading or trailing hyphen-separated segment. */
const BRAND_PREFIX = "hisaabo-";
const BRAND_SUFFIX = "-hisaabo";

/**
 * True when `slug` is reserved (trimmed, case-insensitive): on the list, or
 * `hisaabo-*` / `*-hisaabo`. Whole-segment only, so `hisaaboo` or `nohisaabo`
 * are fine.
 */
export function isReservedStoreSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  const s = slug.trim().toLowerCase();
  return RESERVED_SET.has(s) || s.startsWith(BRAND_PREFIX) || s.endsWith(BRAND_SUFFIX);
}

/**
 * The reserved-slug rule for a slug being saved.
 *
 * Returns the error message when `requested` is reserved AND differs from the
 * business's `current` slug; otherwise null. Resubmitting the slug a business
 * already holds (the web form sends it on every save) is never an error, which
 * is what keeps grandfathered stores working. Clearing the slug is never an error.
 */
export function checkStoreSlugReserved(
  requested: string | null | undefined,
  current: string | null | undefined,
): string | null {
  if (!requested) return null;
  if (current && requested === current) return null;
  return isReservedStoreSlug(requested) ? STORE_SLUG_RESERVED_MESSAGE : null;
}

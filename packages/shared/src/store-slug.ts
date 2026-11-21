/**
 * Reserved public store slugs (store.hisaabo.in/<slug>).
 *
 * Single source of truth, used by the API (store.updateSettings / checkSlug /
 * self-import) and by the web client-side validation. Without it anyone could
 * claim `login`, `support`, `hisaabo`, ... and impersonate the platform on a
 * hisaabo.in address (including in OTP SMS that carry the store name).
 *
 * Exact-match only: prefixes like `hisaab-` are deliberately NOT reserved, since
 * "hisaab" is an ordinary word and many real businesses use it in their name.
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
  // Commerce flow
  "pay",
  "checkout",
  "cart",
  "order",
  "orders",
  "billing",
  "invoice",
  "invoices",
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

/** True when `slug` is on the reserved list (trimmed, case-insensitive). */
export function isReservedStoreSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return RESERVED_SET.has(slug.trim().toLowerCase());
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

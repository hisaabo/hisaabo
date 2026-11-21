import { describe, it, expect } from "vitest";
import {
  RESERVED_STORE_SLUGS,
  STORE_SLUG_RESERVED_MESSAGE,
  isReservedStoreSlug,
  checkStoreSlugReserved,
} from "../index.js";

// Same shape the API validator and the storefront middleware accept.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

const MUST_RESERVE = [
  "hisaabo", "hisaab", "official", "team", "staff",
  "admin", "api", "app", "login", "logout", "signin", "signup", "register", "auth", "account",
  "oauth", "verify", "otp", "pay", "checkout", "cart", "order", "orders", "store", "stores", "shop",
  "www", "mail", "email", "static", "assets", "cdn", "docs", "help", "support", "status", "blog",
  "ops", "dashboard", "settings", "privacy", "terms", "refund", "refunds", "policy", "legal",
  "security", "about", "contact", "billing", "invoice", "invoices",
  "payment", "payments", "upi", "kyc", "secure", "health", "user", "users", "profile", "home",
  "search", "pricing", "download", "test", "demo", "null", "undefined", "customer-care",
];

describe("RESERVED_STORE_SLUGS", () => {
  it("covers every platform, auth/infra and storefront word we promised", () => {
    for (const s of MUST_RESERVE) expect(RESERVED_STORE_SLUGS, s).toContain(s);
  });

  it("only contains slugs that could otherwise be claimed (valid shape, lowercase, no duplicates)", () => {
    for (const s of RESERVED_STORE_SLUGS) {
      expect(SLUG_RE.test(s), `${s} would never be claimable, so reserving it is dead weight`).toBe(true);
    }
    expect(new Set(RESERVED_STORE_SLUGS).size).toBe(RESERVED_STORE_SLUGS.length);
  });

  it("reserves the top-level paths the storefront serves itself", () => {
    expect(isReservedStoreSlug("assets")).toBe(true);
    expect(isReservedStoreSlug("store")).toBe(true);
    expect(isReservedStoreSlug("index")).toBe(true);
  });
});

describe("isReservedStoreSlug", () => {
  it("matches exactly, ignoring case and surrounding whitespace", () => {
    expect(isReservedStoreSlug("login")).toBe(true);
    expect(isReservedStoreSlug("LOGIN")).toBe(true);
    expect(isReservedStoreSlug(" Support ")).toBe(true);
  });

  it("does not reserve ordinary business slugs or look-alikes", () => {
    for (const s of ["acme-traders", "hisaab-kitaab", "kitaab-hisaab", "hisaab-traders", "login-shop", "my-store", "supports", "teams", "tests", "homes"]) {
      expect(isReservedStoreSlug(s), s).toBe(false);
    }
  });

  it("reserves the brand name as a whole leading or trailing segment (hisaabo-*, *-hisaabo)", () => {
    for (const s of ["hisaabo-support", "hisaabo-official", "hisaabo-demo", "hisaabo-1", "acme-hisaabo", "official-hisaabo", "HISAABO-Support", " acme-hisaabo "]) {
      expect(isReservedStoreSlug(s), s).toBe(true);
    }
  });

  it("does not extend the brand rule to hisaab-*, other words, or the middle of a slug", () => {
    for (const s of ["hisaab-support", "support-hisaab", "hisaaboo", "hisaaboo-traders", "nohisaabo", "my-nohisaabo", "acme-hisaabo-traders"]) {
      expect(isReservedStoreSlug(s), s).toBe(false);
    }
  });

  it("treats empty input as not reserved", () => {
    expect(isReservedStoreSlug("")).toBe(false);
    expect(isReservedStoreSlug(null)).toBe(false);
    expect(isReservedStoreSlug(undefined)).toBe(false);
  });
});

describe("checkStoreSlugReserved", () => {
  it("rejects choosing a reserved slug for the first time", () => {
    expect(checkStoreSlugReserved("login", null)).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(checkStoreSlugReserved("login", undefined)).toBe(STORE_SLUG_RESERVED_MESSAGE);
  });

  it("rejects changing to a reserved slug", () => {
    expect(checkStoreSlugReserved("support", "acme")).toBe(STORE_SLUG_RESERVED_MESSAGE);
  });

  it("rejects the brand prefix/suffix on first choice and on change", () => {
    expect(checkStoreSlugReserved("hisaabo-support", null)).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(checkStoreSlugReserved("acme-hisaabo", "ab12-acme")).toBe(STORE_SLUG_RESERVED_MESSAGE);
  });

  it("grandfathers a business that already holds the reserved slug", () => {
    expect(checkStoreSlugReserved("shop", "shop")).toBeNull();
    expect(checkStoreSlugReserved("hisaabo-demo", "hisaabo-demo")).toBeNull();
    expect(checkStoreSlugReserved("acme-hisaabo", "acme-hisaabo")).toBeNull();
  });

  it("does not let a grandfathered brand slug move to a different brand slug", () => {
    expect(checkStoreSlugReserved("hisaabo-other", "hisaabo-demo")).toBe(STORE_SLUG_RESERVED_MESSAGE);
    expect(checkStoreSlugReserved("support", "hisaabo-demo")).toBe(STORE_SLUG_RESERVED_MESSAGE);
  });

  it("allows non-reserved slugs and clearing the slug", () => {
    expect(checkStoreSlugReserved("acme-traders", null)).toBeNull();
    expect(checkStoreSlugReserved("acme-traders", "shop")).toBeNull();
    expect(checkStoreSlugReserved(null, "shop")).toBeNull();
    expect(checkStoreSlugReserved(undefined, "shop")).toBeNull();
    expect(checkStoreSlugReserved("", "shop")).toBeNull();
  });

  it("uses the documented user-facing message", () => {
    expect(STORE_SLUG_RESERVED_MESSAGE).toContain("This store address is reserved");
  });
});

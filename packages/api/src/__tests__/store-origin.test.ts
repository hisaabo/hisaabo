/**
 * store-origin.test.ts — Unit tests for the Origin/Referer allow-list
 * helper used as the CSRF backstop on public `/store/*` POSTs.
 *
 * WHY THIS FILE EXISTS:
 * We intentionally exempt `/store/*` from the global CSRF middleware
 * because those handlers don't read cookies (auth is phone + Turnstile).
 * The compensating Origin check must still (a) accept the happy-path
 * SaaS + self-hosted origins, (b) accept missing headers — many mobile
 * browsers and in-app webviews strip them — and (c) NOT be fooled by
 * classic subdomain-match tricks like `example.com.attacker.com`
 * masquerading as `*.example.com`.
 *
 * The helper is pure — no Hono app, no DB — so these tests are cheap
 * enough to gate every push.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  isAllowedStoreOrigin,
  isOriginAllowed,
  isSubdomainOf,
  parseOriginLike,
} from "../lib/store-origin.js";

/**
 * Build a one-shot Hono context with the requested headers so we can
 * exercise `isAllowedStoreOrigin`. We route through a real Hono app to
 * avoid hand-rolling the Context shape — Hono's internals rename
 * between versions and the test would be brittle otherwise.
 */
async function withContext(
  headers: Record<string, string>,
  check: (c: Context) => boolean,
): Promise<boolean> {
  let result = false;
  const app = new Hono();
  app.all("/store/test", (c) => {
    result = check(c);
    return c.json({ ok: result });
  });
  await app.request("/store/test", {
    method: "POST",
    headers,
  });
  return result;
}

describe("parseOriginLike", () => {
  it("parseOriginLike normalizes a full URL down to scheme://host[:port] — the Referer header often includes a path and query string that must be stripped before comparison", () => {
    expect(parseOriginLike("https://store.hisaabo.in/cart?foo=1")).toBe("https://store.hisaabo.in");
  });

  it("parseOriginLike returns null for undefined, empty, or literal 'null' values — sandboxed iframes report Origin: null and must fall through to the missing-headers branch", () => {
    expect(parseOriginLike(undefined)).toBeNull();
    expect(parseOriginLike("")).toBeNull();
    expect(parseOriginLike("null")).toBeNull();
    expect(parseOriginLike("NULL")).toBeNull();
  });

  it("parseOriginLike rejects non-http(s) schemes like file:// or data: — these should never count as an allowed origin under any policy", () => {
    expect(parseOriginLike("file:///etc/passwd")).toBeNull();
    expect(parseOriginLike("data:text/html,evil")).toBeNull();
  });

  it("parseOriginLike returns null for malformed URLs instead of throwing — header values from the wild are untrusted strings", () => {
    expect(parseOriginLike("not a url")).toBeNull();
    expect(parseOriginLike("://broken")).toBeNull();
  });
});

describe("isSubdomainOf", () => {
  it("isSubdomainOf accepts the exact parent host — 'hisaabo.in' is a subdomain of 'hisaabo.in' for allow-list purposes", () => {
    expect(isSubdomainOf("hisaabo.in", "hisaabo.in")).toBe(true);
  });

  it("isSubdomainOf accepts true subdomains — 'store.hisaabo.in' matches parent 'hisaabo.in' because the label boundary is the dot", () => {
    expect(isSubdomainOf("store.hisaabo.in", "hisaabo.in")).toBe(true);
    expect(isSubdomainOf("a.b.hisaabo.in", "hisaabo.in")).toBe(true);
  });

  it("isSubdomainOf rejects the classic suffix-trick 'example.com.attacker.com' against parent 'example.com' — a naive endsWith check would accept this and leak the allow-list to attacker-controlled hosts", () => {
    expect(isSubdomainOf("example.com.attacker.com", "example.com")).toBe(false);
    expect(isSubdomainOf("hisaabo.in.evil.com", "hisaabo.in")).toBe(false);
  });

  it("isSubdomainOf rejects unrelated hosts", () => {
    expect(isSubdomainOf("attacker.com", "hisaabo.in")).toBe(false);
    expect(isSubdomainOf("", "hisaabo.in")).toBe(false);
    expect(isSubdomainOf("hisaabo.in", "")).toBe(false);
  });
});

describe("isOriginAllowed (pure predicate)", () => {
  const config = {
    allowedOrigins: ["https://store.hisaabo.in", "https://app.hisaabo.in"],
    allowedSubdomainsOf: ["hisaabo.in"],
    allowLocalhost: true,
  };

  it("isOriginAllowed accepts an exact match from allowedOrigins", () => {
    expect(isOriginAllowed("https://store.hisaabo.in", config)).toBe(true);
  });

  it("isOriginAllowed accepts subdomain-wildcard matches — 'https://shop.hisaabo.in' passes because 'hisaabo.in' is in allowedSubdomainsOf", () => {
    expect(isOriginAllowed("https://shop.hisaabo.in", config)).toBe(true);
  });

  it("isOriginAllowed rejects the subdomain suffix trick — 'https://hisaabo.in.attacker.com' must NOT match parent 'hisaabo.in'", () => {
    expect(isOriginAllowed("https://hisaabo.in.attacker.com", config)).toBe(false);
  });

  it("isOriginAllowed accepts http://localhost:<port> when allowLocalhost is true — non-production must keep dev ergonomics", () => {
    expect(isOriginAllowed("http://localhost:5173", config)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", config)).toBe(true);
  });

  it("isOriginAllowed rejects localhost when allowLocalhost is false — production must not leave the dev backdoor open", () => {
    const prod = { ...config, allowLocalhost: false };
    expect(isOriginAllowed("http://localhost:5173", prod)).toBe(false);
  });

  it("isOriginAllowed rejects origins that neither match nor fall under any subdomain parent", () => {
    expect(isOriginAllowed("https://totally-unrelated.com", config)).toBe(false);
    expect(isOriginAllowed("not a url", config)).toBe(false);
  });
});

describe("isAllowedStoreOrigin (Context-aware)", () => {
  const opts = {
    allowedOrigins: ["https://store.hisaabo.in"],
    allowedSubdomainsOf: ["hisaabo.in"],
    allowLocalhost: false,
  };

  it("isAllowedStoreOrigin returns true when Origin is present and allow-listed — the happy-path SaaS checkout", async () => {
    const ok = await withContext(
      { origin: "https://store.hisaabo.in" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    expect(ok).toBe(true);
  });

  it("isAllowedStoreOrigin returns false when Origin is present but disallowed — a hostile page at https://attacker.com must not be able to proxy an order form", async () => {
    const ok = await withContext(
      { origin: "https://attacker.com" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    expect(ok).toBe(false);
  });

  it("isAllowedStoreOrigin returns true when BOTH Origin and Referer are missing — documented residual risk; mobile browsers and in-app webviews strip both headers and Turnstile + rate limits remain the protection layer for those clients", async () => {
    const ok = await withContext({}, (c) => isAllowedStoreOrigin(c, opts));
    expect(ok).toBe(true);
  });

  it("isAllowedStoreOrigin falls back to Referer when Origin is absent — parses the Referer URL down to scheme://host before matching", async () => {
    const ok = await withContext(
      { referer: "https://shop.hisaabo.in/cart?item=1" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    // shop.hisaabo.in matches the subdomain-wildcard parent
    expect(ok).toBe(true);
  });

  it("isAllowedStoreOrigin rejects a Referer-only request whose host is not allow-listed — the suffix-trick host 'https://hisaabo.in.attacker.com' must fail even when the path component 'looks trusted'", async () => {
    const ok = await withContext(
      { referer: "https://hisaabo.in.attacker.com/?spoof=hisaabo.in" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    expect(ok).toBe(false);
  });

  it("isAllowedStoreOrigin prefers Origin over Referer when both are present — Origin is the more trustworthy header; Referer can be edited by some ad/privacy extensions", async () => {
    // Origin allow-listed, Referer disallowed → allow (Origin wins).
    const allowed = await withContext(
      { origin: "https://store.hisaabo.in", referer: "https://attacker.com/page" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    expect(allowed).toBe(true);

    // Origin disallowed, Referer allow-listed → reject (Origin wins).
    const rejected = await withContext(
      { origin: "https://attacker.com", referer: "https://store.hisaabo.in/cart" },
      (c) => isAllowedStoreOrigin(c, opts),
    );
    expect(rejected).toBe(false);
  });
});

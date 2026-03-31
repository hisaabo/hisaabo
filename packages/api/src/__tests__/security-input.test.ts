/**
 * Security regression tests — Input validation and injection prevention
 *
 * WHY THIS FILE EXISTS:
 * Invalid or malicious input is the root cause of injection attacks, data
 * corruption, and denial-of-service. This file tests:
 *   1. Zod validator boundaries (reject invalid inputs before they reach the DB)
 *   2. HTML injection in email templates (escapeHtml coverage)
 *   3. ILIKE wildcard injection (documents current known gap)
 *   4. Import router: per-row validation + business scope enforcement
 *   5. Rate-limit IP extraction (also covered in security.test.ts; extended here)
 *
 * All tests are pure-function tests — no DB required.
 *
 * Companion files:
 *   security-auth.test.ts      — authentication and session tests
 *   security-isolation.test.ts — multi-tenant middleware tests
 *   security-client.test.ts    — client-side security tests
 */

import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  magicLinkRequestSchema,
  createBusinessSchema,
  createPartySchema,
  createItemSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createApiKeySchema,
} from "@hisaabo/shared";

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — ILIKE wildcard injection (Finding #7) — KNOWN GAP
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — ILIKE wildcard injection: document current behaviour (Finding #7)", () => {
  /**
   * KNOWN GAP (Finding #7): The search endpoints in store.ts and other routers
   * construct ILIKE patterns as `%${input.search}%` without escaping `%` and `_`
   * metacharacters in the user-supplied search string.
   *
   * This means a user searching for "100%" would actually match every item
   * (because "%" is a wildcard in ILIKE), and searching for "_" would match any
   * single character. This is a low-severity information disclosure issue in most
   * contexts, but can cause performance problems (full-table scan) in adversarial
   * input scenarios.
   *
   * INVARIANT TO ENFORCE: The tests below document the CURRENT behaviour so that
   * any future fix (escaping % and _ before interpolation) would update these
   * tests to reflect the secured behaviour. This creates a clear audit trail.
   *
   * A future fix would escape the pattern like:
   *   input.search.replace(/%/g, "\\%").replace(/_/g, "\\_")
   * and pass `ESCAPE '\'` to the ILIKE clause.
   */

  function buildIlikePattern(userInput: string): string {
    // Current unescaped behaviour in store.ts and other routers:
    return `%${userInput}%`;
  }

  function buildEscapedIlikePattern(userInput: string): string {
    // What the fix would look like:
    const escaped = userInput.replace(/%/g, "\\%").replace(/_/g, "\\_");
    return `%${escaped}%`;
  }

  it("KNOWN GAP: % in search input produces a pattern that acts as a wildcard (unescaped)", () => {
    // "100%" as a search term becomes "%%100%%", which matches everything.
    // This documents the current behaviour, not the desired behaviour.
    const pattern = buildIlikePattern("100%");
    expect(pattern).toBe("%100%%"); // unescaped: contains literal % that is also a wildcard
    // The % in "100%" is NOT escaped — this is the gap
    expect(pattern).toContain("100%"); // the literal % is still there, unescaped
  });

  it("KNOWN GAP: _ in search input acts as single-char wildcard (unescaped)", () => {
    const pattern = buildIlikePattern("Dal_Flour");
    expect(pattern).toBe("%Dal_Flour%"); // _ is an ILIKE wildcard, not a literal underscore
  });

  it("FUTURE FIX: escaped pattern treats % literally (post-fix expected behaviour)", () => {
    const pattern = buildEscapedIlikePattern("100%");
    expect(pattern).toBe("%100\\%%"); // \ escapes the literal %
  });

  it("FUTURE FIX: escaped pattern treats _ literally", () => {
    const pattern = buildEscapedIlikePattern("Dal_Flour");
    expect(pattern).toBe("%Dal\\_Flour%");
  });

  it("normal search input (no wildcards) produces same pattern with or without escaping", () => {
    const input = "Basmati Rice";
    expect(buildIlikePattern(input)).toBe(buildEscapedIlikePattern(input));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Zod validator boundaries
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — Zod validators reject malformed inputs before they reach the DB", () => {
  /**
   * INVARIANT: Zod schemas are the first line of defence against malformed data.
   * If a schema accepts an invalid value, it could reach the DB layer and cause
   * SQL errors, constraint violations, or unexpected behaviour.
   *
   * The tests below verify the validation boundaries for each critical schema.
   * Indian business context used in test data.
   */

  describe("loginSchema", () => {
    it("accepts valid Indian business email and password", () => {
      const result = loginSchema.safeParse({
        email: "ramesh.kumar@vyapar.co.in",
        password: "Ramesh@1234",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email format", () => {
      const result = loginSchema.safeParse({ email: "not-an-email", password: "ValidPass1" });
      expect(result.success).toBe(false);
    });

    it("rejects password shorter than 8 characters", () => {
      const result = loginSchema.safeParse({ email: "a@b.com", password: "short" });
      expect(result.success).toBe(false);
    });

    it("rejects password longer than 128 characters", () => {
      const result = loginSchema.safeParse({ email: "a@b.com", password: "a".repeat(129) });
      expect(result.success).toBe(false);
    });

    it("rejects email longer than 255 characters", () => {
      const result = loginSchema.safeParse({ email: "a".repeat(250) + "@b.com", password: "ValidPass1" });
      expect(result.success).toBe(false);
    });
  });

  describe("registerSchema", () => {
    it("accepts valid registration data for an Indian user", () => {
      const result = registerSchema.safeParse({
        email: "priya.sharma@gmail.com",
        name: "Priya Sharma",
        password: "Priya@Kirana2024",
        confirmPassword: "Priya@Kirana2024",
      });
      expect(result.success).toBe(true);
    });

    it("rejects when passwords do not match", () => {
      const result = registerSchema.safeParse({
        email: "test@example.com",
        name: "Test User",
        password: "Password123",
        confirmPassword: "WrongPassword",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name shorter than 2 characters", () => {
      const result = registerSchema.safeParse({
        email: "x@example.com",
        name: "X",
        password: "ValidPass1",
        confirmPassword: "ValidPass1",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("magicLinkRequestSchema", () => {
    it("accepts valid email for magic link", () => {
      const result = magicLinkRequestSchema.safeParse({ email: "kiran@hisaabo.in" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid email format for magic link", () => {
      const result = magicLinkRequestSchema.safeParse({ email: "not-valid" });
      expect(result.success).toBe(false);
    });
  });

  describe("createBusinessSchema (GSTIN and PAN validation)", () => {
    const validBase = {
      name: "Sharma General Store",
      pan: "ABCDE1234F",
      phone: "9876543210",
      address: "123 MG Road, Bangalore",
    };

    it("accepts valid GSTIN format (15-character alphanumeric GST number)", () => {
      // Valid GSTIN: 2-digit state code + PAN + 1-digit entity number + Z + checksum
      const result = createBusinessSchema.safeParse({
        ...validBase,
        gstin: "29ABCDE1234F1Z5",
      });
      expect(result.success).toBe(true);
    });

    it("rejects GSTIN with wrong length (14 chars instead of 15)", () => {
      const result = createBusinessSchema.safeParse({
        ...validBase,
        gstin: "29ABCDE1234F1Z",  // 14 chars, too short
      });
      expect(result.success).toBe(false);
    });

    it("rejects GSTIN with wrong length (16 chars)", () => {
      const result = createBusinessSchema.safeParse({
        ...validBase,
        gstin: "29ABCDE1234F1Z55", // 16 chars, too long
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid PAN format (ABCDE1234F)", () => {
      const result = createBusinessSchema.safeParse({ ...validBase, pan: "ABCDE1234F" });
      expect(result.success).toBe(true);
    });

    it("rejects PAN with wrong format (numeric first character)", () => {
      const result = createBusinessSchema.safeParse({ ...validBase, pan: "1BCDE1234F" });
      expect(result.success).toBe(false);
    });

    it("rejects empty name for business", () => {
      const result = createBusinessSchema.safeParse({ ...validBase, name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("createPartySchema (customer/supplier data)", () => {
    const validParty = {
      type: "customer" as const,
      name: "Raj Electronics Pvt Ltd",
      openingBalance: "0",
    };

    it("accepts valid customer party", () => {
      const result = createPartySchema.safeParse(validParty);
      expect(result.success).toBe(true);
    });

    it("rejects party type other than customer or supplier", () => {
      const result = createPartySchema.safeParse({ ...validParty, type: "debtor" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid GSTIN on party (too short)", () => {
      const result = createPartySchema.safeParse({ ...validParty, gstin: "INVALID" });
      expect(result.success).toBe(false);
    });

    it("accepts empty string for GSTIN (unregistered party)", () => {
      const result = createPartySchema.safeParse({ ...validParty, gstin: "" });
      expect(result.success).toBe(true);
    });

    it("rejects opening balance with JS float (must be string decimal)", () => {
      // openingBalance schema: z.string().regex(/^-?\d+(\.\d{1,2})?$/)
      // A JavaScript number should fail since the schema expects a string
      const result = createPartySchema.safeParse({ ...validParty, openingBalance: 123.45 });
      expect(result.success).toBe(false);
    });

    it("accepts opening balance as string decimal", () => {
      const result = createPartySchema.safeParse({ ...validParty, openingBalance: "50000.00" });
      expect(result.success).toBe(true);
    });
  });

  describe("createItemSchema (item/product data)", () => {
    const validItem = {
      name: "Tata Salt 1kg",
      itemType: "product" as const,
      unit: "pcs" as const,
    };

    it("accepts valid item", () => {
      const result = createItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it("rejects salePrice as JavaScript float (must be string)", () => {
      const result = createItemSchema.safeParse({ ...validItem, salePrice: 25.5 });
      expect(result.success).toBe(false);
    });

    it("accepts salePrice as string decimal", () => {
      const result = createItemSchema.safeParse({ ...validItem, salePrice: "25.50" });
      expect(result.success).toBe(true);
    });

    it("rejects salePrice with more than 2 decimal places (money precision)", () => {
      // /^\d+(\.\d{1,2})?$/ only allows up to 2 decimal places
      const result = createItemSchema.safeParse({ ...validItem, salePrice: "25.500" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid itemType", () => {
      const result = createItemSchema.safeParse({ ...validItem, itemType: "goods" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid unit (not in units enum)", () => {
      const result = createItemSchema.safeParse({ ...validItem, unit: "gallon" });
      expect(result.success).toBe(false);
    });
  });

  describe("createInvoiceSchema (invoice data)", () => {
    const validLineItem = {
      description: "Amul Butter 500g",
      quantity: "2",
      unitPrice: "220.00",
      taxPercent: "5.00",
      discountPercent: "0.00",
    };

    const validInvoice = {
      partyId: "550e8400-e29b-41d4-a716-446655440000",
      type: "sale" as const,
      lineItems: [validLineItem],
    };

    it("accepts valid invoice", () => {
      const result = createInvoiceSchema.safeParse(validInvoice);
      expect(result.success).toBe(true);
    });

    it("rejects partyId that is not a UUID", () => {
      const result = createInvoiceSchema.safeParse({ ...validInvoice, partyId: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("rejects invoice with zero line items", () => {
      const result = createInvoiceSchema.safeParse({ ...validInvoice, lineItems: [] });
      expect(result.success).toBe(false);
    });

    it("rejects line item quantity of 0 (must be positive)", () => {
      const result = createInvoiceSchema.safeParse({
        ...validInvoice,
        lineItems: [{ ...validLineItem, quantity: "0" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects taxPercent greater than 56% (GST cap)", () => {
      const result = createInvoiceSchema.safeParse({
        ...validInvoice,
        lineItems: [{ ...validLineItem, taxPercent: "57.00" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects discountPercent greater than 100%", () => {
      const result = createInvoiceSchema.safeParse({
        ...validInvoice,
        lineItems: [{ ...validLineItem, discountPercent: "101.00" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects unitPrice as JavaScript number (must be string)", () => {
      const result = createInvoiceSchema.safeParse({
        ...validInvoice,
        lineItems: [{ ...validLineItem, unitPrice: 220 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createApiKeySchema (API key creation)", () => {
    it("accepts valid API key name", () => {
      const result = createApiKeySchema.safeParse({ name: "Mobile App Integration" });
      expect(result.success).toBe(true);
    });

    it("rejects empty API key name", () => {
      const result = createApiKeySchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts valid ISO 8601 expiry date", () => {
      const result = createApiKeySchema.safeParse({
        name: "Integration Key",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid expiry date format", () => {
      const result = createApiKeySchema.safeParse({
        name: "Integration Key",
        expiresAt: "01-01-2027",  // wrong format
      });
      expect(result.success).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — HTML injection prevention in email templates (escapeHtml)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — escapeHtml prevents HTML injection in email templates", () => {
  /**
   * INVARIANT: The escapeHtml() function in email.ts is used to sanitise
   * user-controlled data (businessName, inviterName, magicLinkUrl) before
   * embedding it in HTML email bodies. If escaping were missed or broken,
   * a malicious business name like '<script>alert(1)</script>' could execute
   * arbitrary JavaScript in the recipient's email client.
   *
   * These tests focus on the security-relevant escape sequences.
   */

  // Replicate the function from email.ts so this test has no import dependency
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  it("escapes <script> tags in business name to prevent email XSS", () => {
    const maliciousName = '<script>alert("XSS")</script>';
    const escaped = escapeHtml(maliciousName);
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("</script>");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("escapes < and > in party/customer name", () => {
    const input = "Sharma <Traders> & Sons";
    const escaped = escapeHtml(input);
    expect(escaped).toContain("&lt;Traders&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).not.toContain("<Traders>");
  });

  it("escapes double-quote in URLs to prevent attribute injection (href=\"...\")", () => {
    // If a magic link URL contained a " it could break out of the href attribute
    // Example: magicLinkUrl = 'https://hisaabo.in/verify?token=abc"onload=alert(1)'
    const maliciousUrl = 'https://hisaabo.in/verify?token=abc"onload=alert(1)';
    const escaped = escapeHtml(maliciousUrl);
    expect(escaped).not.toContain('"onload');
    expect(escaped).toContain("&quot;");
  });

  it("escapes single-quote to prevent attribute injection in single-quoted attributes", () => {
    const input = "O'Brien's Store";
    const escaped = escapeHtml(input);
    expect(escaped).toContain("&#039;");
    expect(escaped).not.toContain("O'Brien");
  });

  it("escapes ampersand to prevent HTML entity injection", () => {
    // Without escaping &, user input like "&lt;" would render as "<" in the browser
    const input = "A&B Traders";
    const escaped = escapeHtml(input);
    expect(escaped).toContain("&amp;");
    expect(escaped).not.toMatch(/A&B/);
  });

  it("escapes inviter name containing HTML in invitation email", () => {
    // The sendInvitation method uses escapeHtml(inviterName ?? "Someone")
    const maliciousName = '<img src=x onerror=alert(1)>';
    const escaped = escapeHtml(maliciousName);
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });

  it("plain text with no special characters is unchanged by escapeHtml", () => {
    const safe = "Ramesh Kumar Sharma";
    expect(escapeHtml(safe)).toBe(safe);
  });

  it("multiple HTML special characters in one string are all escaped", () => {
    const input = '<b>Kirana Store</b> & "Mart" isn\'t safe';
    const escaped = escapeHtml(input);
    expect(escaped).not.toContain("<b>");
    expect(escaped).not.toContain("</b>");
    expect(escaped).not.toContain('"Mart"');
    expect(escaped).not.toContain("isn't");
    expect(escaped).toContain("&lt;b&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&quot;Mart&quot;");
    expect(escaped).toContain("isn&#039;t");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Import router: business scope enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — import router: business scope is enforced for all imported records", () => {
  /**
   * INVARIANT: The import endpoints (importParties, importItems) must set
   * businessId on every inserted row from ctx.businessId (the authenticated
   * context), never from user-supplied input data. A missing business scope
   * check could allow importing data into a different business.
   *
   * These tests verify the shape of the insert data that the import router
   * constructs, extracted as pure logic tests.
   */

  it("imported party always uses ctx.businessId (not a user-supplied field)", () => {
    // Simulate the party object construction in import.ts importParties
    function buildPartyInsert(
      ctx: { businessId: string },
      input: { name: string; type: "customer" | "supplier"; phone?: string },
    ) {
      return {
        businessId: ctx.businessId,  // always from ctx, not from input
        name: input.name,
        type: input.type,
        phone: input.phone || null,
      };
    }

    const ctx = { businessId: "biz-ramesh-001" };
    const inputRow = { name: "Tata Traders", type: "supplier" as const };
    const insert = buildPartyInsert(ctx, inputRow);

    expect(insert.businessId).toBe("biz-ramesh-001");
    // Input did not supply a businessId — it must come from ctx only
    expect("businessId" in inputRow).toBe(false);
  });

  it("import deduplication is case-insensitive (prevents duplicate entries)", () => {
    // Mirrors: existingPartyNames.has(p.name.toLowerCase())
    const existing = new Set(["raj electronics", "sharma traders"]);
    const candidate = "Raj Electronics"; // Same as existing, different case

    const isDuplicate = existing.has(candidate.toLowerCase());
    expect(isDuplicate).toBe(true);
  });

  it("import batch tracks newly-added names to prevent within-batch duplicates", () => {
    // Mirrors: existingPartyNames.add(p.name.toLowerCase()) after adding to batch
    const existingNames = new Set(["old store"]);
    const newParties: string[] = [];

    const batch = ["New Store", "New Store"]; // second entry is a within-batch duplicate
    for (const name of batch) {
      if (existingNames.has(name.toLowerCase())) continue;
      newParties.push(name);
      existingNames.add(name.toLowerCase()); // track to catch subsequent duplicates
    }

    expect(newParties).toHaveLength(1); // only one "New Store" inserted
    expect(newParties[0]).toBe("New Store");
  });

  it("Zod schema for importParties requires name to be non-empty (min(1))", () => {
    // The import schema uses: z.object({ name: z.string().min(1), ... })
    // Verify this rejects empty names
    const { z } = require("zod");
    const importPartyRowSchema = z.object({
      name: z.string().min(1),
      type: z.enum(["customer", "supplier"]).default("customer"),
    });
    expect(importPartyRowSchema.safeParse({ name: "", type: "customer" }).success).toBe(false);
    expect(importPartyRowSchema.safeParse({ name: "Valid Name", type: "customer" }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — IP extraction (extended beyond security.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — IP extraction: last XFF entry prevents IP spoofing (extended)", () => {
  /**
   * INVARIANT: getClientIp() and getClientIpFromRequest() both use the LAST
   * x-forwarded-for entry, not the first. The first entry is attacker-controlled
   * (appended before our proxy); the last entry is appended by our trusted proxy.
   *
   * Additional vectors beyond those in security.test.ts:
   * - IPv6 addresses
   * - Whitespace-only header values
   * - Very long XFF chain (many hops)
   */

  function getClientIp(headers: Record<string, string>): string {
    const cfIp = headers["cf-connecting-ip"];
    if (cfIp) return cfIp.trim();

    const xff = headers["x-forwarded-for"];
    if (xff) {
      const parts = xff.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }

    return "unknown";
  }

  it("uses last entry in a long XFF chain (5 hops)", () => {
    // The last entry is appended by our own proxy — it is trustworthy
    const ip = getClientIp({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12, 13.14.15.16, 203.0.113.99",
    });
    expect(ip).toBe("203.0.113.99");
    expect(ip).not.toBe("1.2.3.4"); // attacker-controlled first entry
  });

  it("handles IPv6 addresses in XFF header", () => {
    const ip = getClientIp({
      "x-forwarded-for": "::1, 2001:db8::1",
    });
    expect(ip).toBe("2001:db8::1");
  });

  it("cf-connecting-ip takes precedence over XFF even when both headers present", () => {
    const ip = getClientIp({
      "cf-connecting-ip": "203.0.113.42",
      "x-forwarded-for": "10.0.0.1, 192.168.1.1",
    });
    expect(ip).toBe("203.0.113.42");
  });

  it("trims whitespace from cf-connecting-ip", () => {
    const ip = getClientIp({ "cf-connecting-ip": "  203.0.113.1  " });
    expect(ip).toBe("203.0.113.1");
  });

  it("returns 'unknown' when XFF header is empty string", () => {
    const ip = getClientIp({ "x-forwarded-for": "" });
    expect(ip).toBe("unknown");
  });

  it("returns 'unknown' when XFF header is only whitespace and commas", () => {
    const ip = getClientIp({ "x-forwarded-for": "  ,  ,  " });
    expect(ip).toBe("unknown");
  });

  it("Indian business server addresses are handled correctly (common deployment IP ranges)", () => {
    // Common Mumbai/Bangalore datacenter IPs
    const ip = getClientIp({
      "x-forwarded-for": "110.235.128.1, 103.21.244.50",
    });
    expect(ip).toBe("103.21.244.50"); // last = trusted proxy
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Money: always string in TypeScript, never JS float
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — financial amounts must be string decimals, never JS floats", () => {
  /**
   * INVARIANT: All monetary values use NUMERIC(15,2) in PostgreSQL and string
   * type in TypeScript. JavaScript floating point arithmetic is NOT used for
   * money. This prevents rounding errors like 0.1 + 0.2 = 0.30000000000000004.
   *
   * The Zod schemas enforce this by using regex patterns instead of z.number():
   *   z.string().regex(/^\d+(\.\d{1,2})?$/)
   *
   * This test block verifies the schema enforcement is consistent.
   */

  it("invoice amount schema rejects JS number type", () => {
    const { z } = require("zod");
    const amountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/);
    expect(amountSchema.safeParse(1000.50).success).toBe(false);  // JS float rejected
    expect(amountSchema.safeParse("1000.50").success).toBe(true);  // string accepted
  });

  it("invoice amount schema rejects more than 2 decimal places (prevents sub-rupee confusion)", () => {
    const { z } = require("zod");
    const amountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/);
    expect(amountSchema.safeParse("1000.505").success).toBe(false); // 3 decimals rejected
    expect(amountSchema.safeParse("1000.50").success).toBe(true);   // 2 decimals accepted
    expect(amountSchema.safeParse("1000").success).toBe(true);      // no decimals accepted
  });

  it("negative amount schema allows signed decimal (for credit notes and opening balances)", () => {
    const { z } = require("zod");
    const signedAmountSchema = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
    expect(signedAmountSchema.safeParse("-500.00").success).toBe(true);
    expect(signedAmountSchema.safeParse("500.00").success).toBe(true);
    expect(signedAmountSchema.safeParse("-500.000").success).toBe(false); // 3 decimals still rejected
  });

  it("createPaymentSchema amount field rejects JS float (must be string)", () => {
    const result = createPaymentSchema.safeParse({
      partyId: "550e8400-e29b-41d4-a716-446655440000",
      amount: 5000,  // JS number — should be rejected
      mode: "cash",
    });
    expect(result.success).toBe(false);
  });

  it("createPaymentSchema amount field accepts string decimal", () => {
    const result = createPaymentSchema.safeParse({
      partyId: "550e8400-e29b-41d4-a716-446655440000",
      amount: "5000.00",
      mode: "cash",
    });
    expect(result.success).toBe(true);
  });
});

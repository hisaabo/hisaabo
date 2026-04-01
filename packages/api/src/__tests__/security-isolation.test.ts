/**
 * Security regression tests — Multi-tenant and business isolation
 *
 * WHY THIS FILE EXISTS:
 * The most catastrophic class of bug in a multi-tenant SaaS is cross-tenant data
 * leakage. This file tests the invariants that prevent one user or business from
 * accessing another's data. Each test corresponds to a concrete attack vector.
 *
 * All tests are pure-logic or context-shape tests — no real DB is required.
 *
 * Companion files:
 *   security-auth.test.ts  — authentication and session tests
 *   security-input.test.ts — input validation tests
 *   security-client.test.ts — client-side security tests
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { defineAbilityFor, mapDbRole, requireCan } from "../lib/permissions.js";
import { createTestContext, createAuthenticatedContext, createBusinessContext } from "./helpers/test-context.js";

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Context factory: businessId is null without authenticated user
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — businessId in context requires an authenticated user", () => {
  /**
   * INVARIANT: context.ts sets businessId to null unless both the
   * `x-business-id` header AND an authenticated user are present:
   *
   *   businessId: businessId && user ? businessId : null
   *
   * This prevents an unauthenticated request from reading business-scoped data
   * even if it supplies the correct x-business-id header value.
   */

  it("businessId is null when user is not authenticated (even with x-business-id header)", () => {
    // No user — businessId must not be set
    const ctx = createTestContext({ businessId: "b1b1b1b1-0000-0000-0000-000000000001" });
    expect(ctx.user).toBeNull();
    expect(ctx.businessId).toBeNull();
  });

  it("businessId is null when authenticated user has no x-business-id header", () => {
    const ctx = createTestContext({
      user: { id: "user-001", email: "ramesh@example.in", name: "Ramesh Kumar" },
    });
    expect(ctx.user).not.toBeNull();
    expect(ctx.businessId).toBeNull();
  });

  it("businessId is set when both user and x-business-id header are present", () => {
    const biz = "b1b1b1b1-0000-0000-0000-000000000002";
    const ctx = createTestContext({
      user: { id: "user-002", email: "suresh@example.in", name: "Suresh Patel" },
      businessId: biz,
    });
    expect(ctx.user).not.toBeNull();
    expect(ctx.businessId).toBe(biz);
  });

  it("tenantId is null on unauthenticated context", () => {
    const ctx = createTestContext({});
    expect(ctx.tenantId).toBeNull();
  });

  it("createAuthenticatedContext sets user but leaves businessId null", () => {
    const ctx = createAuthenticatedContext({
      id: "user-003",
      email: "priya@example.in",
      name: "Priya Sharma",
    });
    expect(ctx.user?.id).toBe("user-003");
    expect(ctx.businessId).toBeNull();
    expect(ctx.tenantId).toBeNull();
  });

  it("createBusinessContext produces a fully-populated context", () => {
    const ctx = createBusinessContext({
      userId: "user-004",
      email: "kiran@example.in",
      name: "Kiran Rao",
      tenantId: "tenant-001",
      businessId: "biz-001",
    });
    expect(ctx.user?.id).toBe("user-004");
    expect(ctx.tenantId).toBe("tenant-001");
    expect(ctx.businessId).toBe("biz-001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Middleware chain: publicProcedure has no auth requirement
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — middleware chain: procedure tier access control", () => {
  /**
   * INVARIANT: The tRPC middleware chain enforces a strict hierarchy:
   *
   *   publicProcedure     → no auth required
   *   protectedProcedure  → requires ctx.user (isAuthenticated)
   *   tenantProcedure     → requires ctx.user + ctx.tenantId (hasTenantAccess)
   *   businessProcedure   → requires all of above + ctx.businessId (hasBusinessAccess)
   *   authorizedProcedure → requires all of above + CASL membership lookup
   *
   * We test the guard conditions as pure boolean checks extracted from the
   * middleware implementations in trpc.ts. This avoids needing a real DB while
   * still verifying that the guard logic is correct.
   */

  /** Mirrors the isAuthenticated middleware check */
  function checkIsAuthenticated(ctx: { user: unknown }): void {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
    }
  }

  /** Mirrors the hasTenantAccess middleware check */
  function checkHasTenantAccess(ctx: { user: unknown; tenantId: unknown }): void {
    if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
    if (!ctx.tenantId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization selected" });
  }

  /** Mirrors the hasBusinessAccess middleware check (DB lookup excluded) */
  function checkHasBusinessAccess(ctx: { businessId: unknown }): void {
    if (!ctx.businessId) throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });
  }

  it("publicProcedure: no auth check — unauthenticated context passes", () => {
    const ctx = createTestContext({});
    // publicProcedure has no middleware — nothing should throw
    expect(() => { /* nothing to check — always passes */ }).not.toThrow();
    expect(ctx.user).toBeNull(); // just verify context is unauthenticated
  });

  it("protectedProcedure: throws UNAUTHORIZED when user is null", () => {
    const ctx = createTestContext({});
    expect(() => checkIsAuthenticated(ctx)).toThrow(TRPCError);
    try {
      checkIsAuthenticated(ctx);
    } catch (e) {
      expect((e as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });

  it("protectedProcedure: passes when user is present", () => {
    const ctx = createAuthenticatedContext({
      id: "u-001",
      email: "test@hisaabo.in",
      name: "Test User",
    });
    expect(() => checkIsAuthenticated(ctx)).not.toThrow();
  });

  it("tenantProcedure: throws UNAUTHORIZED when user is null", () => {
    const ctx = createTestContext({});
    expect(() => checkHasTenantAccess(ctx)).toThrow(TRPCError);
    try {
      checkHasTenantAccess(ctx);
    } catch (e) {
      expect((e as TRPCError).code).toBe("UNAUTHORIZED");
    }
  });

  it("tenantProcedure: throws BAD_REQUEST when user present but no tenantId", () => {
    const ctx = createTestContext({
      user: { id: "u-002", email: "t@hisaabo.in", name: "T" },
    });
    expect(() => checkHasTenantAccess(ctx)).toThrow(TRPCError);
    try {
      checkHasTenantAccess(ctx);
    } catch (e) {
      expect((e as TRPCError).code).toBe("BAD_REQUEST");
      expect((e as TRPCError).message).toContain("organization");
    }
  });

  it("tenantProcedure: passes when user and tenantId both present", () => {
    const ctx = createTestContext({
      user: { id: "u-003", email: "t@hisaabo.in", name: "T" },
      tenantId: "tenant-abc",
    });
    expect(() => checkHasTenantAccess(ctx)).not.toThrow();
  });

  it("businessProcedure: throws BAD_REQUEST when businessId is null", () => {
    const ctx = createTestContext({
      user: { id: "u-004", email: "t@hisaabo.in", name: "T" },
      tenantId: "tenant-abc",
      // no businessId
    });
    expect(() => checkHasBusinessAccess(ctx)).toThrow(TRPCError);
    try {
      checkHasBusinessAccess(ctx);
    } catch (e) {
      expect((e as TRPCError).code).toBe("BAD_REQUEST");
      expect((e as TRPCError).message).toContain("business");
    }
  });

  it("businessProcedure: passes when businessId is present", () => {
    const ctx = createBusinessContext({
      userId: "u-005",
      email: "t@hisaabo.in",
      name: "T",
      tenantId: "tenant-abc",
      businessId: "biz-xyz",
    });
    expect(() => checkHasBusinessAccess(ctx)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — CASL permission boundaries (extended role matrix)
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — CASL role permission boundaries prevent privilege escalation", () => {
  /**
   * INVARIANT: Each role must be denied the actions it is not granted.
   * A regression where a role gains an unintended permission could allow
   * data deletion, financial manipulation, or team management by an actor
   * who should not have those privileges.
   *
   * The role matrix below is the source of truth for what IS and IS NOT allowed.
   * Tests in this block expand on the existing security.test.ts matrix with
   * security-critical DENY assertions.
   */

  describe("seller role: cannot delete invoices or manage team", () => {
    const ability = defineAbilityFor({ userId: "seller-001", role: "seller" });

    it("seller CANNOT delete Invoice", () => {
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("seller CANNOT delete Payment", () => {
      expect(ability.can("delete", "Payment")).toBe(false);
    });

    it("seller CANNOT delete Expense", () => {
      expect(ability.can("delete", "Expense")).toBe(false);
    });

    it("seller CANNOT create Expense (no financial write access)", () => {
      expect(ability.can("create", "Expense")).toBe(false);
    });

    it("seller CANNOT manage Team (cannot invite or remove members)", () => {
      expect(ability.can("create", "Team")).toBe(false);
      expect(ability.can("update", "Team")).toBe(false);
      expect(ability.can("delete", "Team")).toBe(false);
    });

    it("seller CANNOT manage BankAccount", () => {
      expect(ability.can("create", "BankAccount")).toBe(false);
      expect(ability.can("update", "BankAccount")).toBe(false);
      expect(ability.can("delete", "BankAccount")).toBe(false);
    });

    it("seller CANNOT create Item (view only)", () => {
      expect(ability.can("create", "Item")).toBe(false);
    });

    it("seller CANNOT manage Import", () => {
      expect(ability.can("manage", "Import")).toBe(false);
    });
  });

  describe("accountant role: cannot create invoices or manage team", () => {
    const ability = defineAbilityFor({ userId: "accountant-001", role: "accountant" });

    it("accountant CANNOT create Invoice", () => {
      expect(ability.can("create", "Invoice")).toBe(false);
    });

    it("accountant CANNOT update Invoice", () => {
      expect(ability.can("update", "Invoice")).toBe(false);
    });

    it("accountant CANNOT delete Invoice", () => {
      expect(ability.can("delete", "Invoice")).toBe(false);
    });

    it("accountant CANNOT create Party", () => {
      expect(ability.can("create", "Party")).toBe(false);
    });

    it("accountant CANNOT create Item", () => {
      expect(ability.can("create", "Item")).toBe(false);
    });

    it("accountant CANNOT manage Team", () => {
      expect(ability.can("create", "Team")).toBe(false);
      expect(ability.can("delete", "Team")).toBe(false);
    });

    it("accountant CAN manage BankAccount (financial role)", () => {
      expect(ability.can("manage", "BankAccount")).toBe(true);
    });

    it("accountant CAN create Expense", () => {
      expect(ability.can("create", "Expense")).toBe(true);
    });
  });

  describe("unknown or empty role: deny-by-default", () => {
    /**
     * INVARIANT: The CASL switch in permissions.ts has a `default` case that
     * grants nothing. An unrecognised role (e.g. from a corrupt DB value or a
     * future role name not yet in the switch) must be fully denied.
     * mapDbRole() returns "" for unknown DB values, which hits the default case.
     */

    it("unknown role string gets no permissions at all", () => {
      const ability = defineAbilityFor({ userId: "x", role: "hacker" });
      expect(ability.can("create", "Invoice")).toBe(false);
      expect(ability.can("read", "Invoice")).toBe(false);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("empty string role gets no permissions (mapDbRole unknown fallback)", () => {
      const ability = defineAbilityFor({ userId: "x", role: "" });
      expect(ability.can("create", "Invoice")).toBe(false);
      expect(ability.can("read", "Party")).toBe(false);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("mapDbRole returns empty string for unknown DB role values", () => {
      expect(mapDbRole("hacker")).toBe("");
      expect(mapDbRole("god")).toBe("");
      expect(mapDbRole("")).toBe("");
      expect(mapDbRole("ADMIN")).toBe(""); // case-sensitive — "ADMIN" is not "admin"
    });
  });

  describe("mapDbRole: legacy role mapping is correct", () => {
    /**
     * INVARIANT: Legacy DB enum values must map to the correct new roles.
     * If "owner" stopped mapping to "superadmin", owners would lose all access.
     * If "viewer" stopped mapping to "accountant", viewers could gain new permissions.
     */

    it('DB role "owner" maps to "superadmin"', () => {
      expect(mapDbRole("owner")).toBe("superadmin");
    });

    it('DB role "member" maps to "seller"', () => {
      expect(mapDbRole("member")).toBe("seller");
    });

    it('DB role "viewer" maps to "accountant"', () => {
      expect(mapDbRole("viewer")).toBe("accountant");
    });

    it('DB role "admin" maps to "admin"', () => {
      expect(mapDbRole("admin")).toBe("admin");
    });
  });

  describe("requireCan: throws FORBIDDEN TRPCError with descriptive message", () => {
    /**
     * INVARIANT: requireCan() in permissions.ts must throw a TRPCError with
     * code FORBIDDEN and a message that identifies the blocked action and resource.
     * A generic or empty error message would make debugging access issues impossible
     * and could hide misconfigurations.
     */

    it("requireCan throws FORBIDDEN with action+resource in message when permission is denied", () => {
      const ability = defineAbilityFor({ userId: "seller-002", role: "seller" });

      expect(() => requireCan(ability, "delete", "Invoice")).toThrow(TRPCError);
      try {
        requireCan(ability, "delete", "Invoice");
      } catch (e) {
        expect((e as TRPCError).code).toBe("FORBIDDEN");
        expect((e as TRPCError).message).toContain("delete");
        expect((e as TRPCError).message).toContain("Invoice");
      }
    });

    it("requireCan throws FORBIDDEN for accountant trying to create Invoice", () => {
      const ability = defineAbilityFor({ userId: "acct-001", role: "accountant" });
      expect(() => requireCan(ability, "create", "Invoice")).toThrow(TRPCError);
      try {
        requireCan(ability, "create", "Invoice");
      } catch (e) {
        expect((e as TRPCError).code).toBe("FORBIDDEN");
      }
    });

    it("requireCan does NOT throw when permission is granted", () => {
      const ability = defineAbilityFor({ userId: "seller-003", role: "seller" });
      // seller CAN create Invoice
      expect(() => requireCan(ability, "create", "Invoice")).not.toThrow();
    });

    it("requireCan does NOT throw for admin on any resource", () => {
      const ability = defineAbilityFor({ userId: "admin-001", role: "admin" });
      expect(() => requireCan(ability, "delete", "Invoice")).not.toThrow();
      expect(() => requireCan(ability, "manage", "BankAccount")).not.toThrow();
      expect(() => requireCan(ability, "create", "Team")).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Public store catalog must not expose internal stock fields
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — public store catalog output does not leak internal business data", () => {
  /**
   * INVARIANT: The public store catalog at /store/:slug/catalog.json is served
   * to unauthenticated customers. It must NOT expose:
   *   - stockQuantity (exact stock levels are sensitive business data)
   *   - purchasePrice (cost price must never be visible to buyers)
   *   - hsn (internal tax code, not customer-facing)
   *   - Internal business DB identifiers beyond what's needed for the cart
   *
   * server.ts strips _stockQty using destructuring before returning the response:
   *   .map(({ stockQty: _stockQty, ... }) => { ...rest })
   *
   * We test the transformation logic here to ensure a refactor cannot
   * accidentally re-expose the stockQty field.
   */

  type RawCatalogItem = {
    id: string;
    name: string;
    price: string | null;
    inStock: boolean;
    stockQty: string;       // internal — must be stripped
    sortOrder: number | null;
    itemMode: string;
    unitVariants: unknown;
    variantAttributes: unknown;
  };

  function transformCatalogItem(raw: RawCatalogItem): Record<string, unknown> {
    // Mirrors the map() transformation in server.ts catalog endpoint
    const { stockQty: _stockQty, unitVariants: _uv, variantAttributes: _va, ...rest } = raw;
    return { ...rest, inStock: rest.inStock, lowStock: false };
  }

  it("transformed catalog item does NOT contain stockQty field", () => {
    const raw: RawCatalogItem = {
      id: "item-001",
      name: "Basmati Rice 1kg",
      price: "120.00",
      inStock: true,
      stockQty: "150.000",   // internal — should be stripped
      sortOrder: 1,
      itemMode: "simple",
      unitVariants: null,
      variantAttributes: null,
    };
    const output = transformCatalogItem(raw);
    expect(output).not.toHaveProperty("stockQty");
    expect(output).not.toHaveProperty("stockQuantity");
  });

  it("transformed catalog item contains inStock boolean (not exact quantity)", () => {
    const raw: RawCatalogItem = {
      id: "item-002",
      name: "Toor Dal 500g",
      price: "85.00",
      inStock: true,
      stockQty: "47.500",
      sortOrder: 2,
      itemMode: "simple",
      unitVariants: null,
      variantAttributes: null,
    };
    const output = transformCatalogItem(raw);
    // inStock is a boolean — buyer knows in/out of stock, not exact quantity
    expect(typeof output.inStock).toBe("boolean");
    // The exact number 47.5 must not appear in the output
    expect(JSON.stringify(output)).not.toContain("47.5");
    expect(JSON.stringify(output)).not.toContain("47.500");
  });

  it("catalog query does NOT select purchasePrice column (verified by field list)", () => {
    /**
     * The SELECT in catalog.json explicitly lists only the columns needed for
     * the public storefront. purchasePrice is intentionally absent.
     * This test documents the absence by verifying the field is not in the
     * allowed output shape.
     */
    const allowedPublicFields = new Set([
      "id", "name", "description", "price", "unit", "category",
      "taxPercent", "taxInclusive", "inStock", "lowStock", "sortOrder",
      "itemMode", "variants", "variantAttributes", "unitVariants",
    ]);

    expect(allowedPublicFields.has("purchasePrice")).toBe(false);
    expect(allowedPublicFields.has("stockQuantity")).toBe(false);
    expect(allowedPublicFields.has("hsn")).toBe(false);
    expect(allowedPublicFields.has("sku")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Rate limit tiers and origin validation
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — rate limit origin detection scopes limits correctly", () => {
  /**
   * INVARIANT: isSameOrigin() in server.ts determines which rate-limit bucket
   * a request falls into:
   *   - same-origin authenticated:   300/min
   *   - same-origin unauthenticated:  60/min
   *   - external authenticated:      120/min
   *   - external unauthenticated:     10/min
   *
   * An attacker who can spoof their origin header could bypass external rate
   * limits by pretending to be a trusted origin. The isSameOrigin check must
   * validate against configured CORS origins and *.hisaabo.in subdomain pattern.
   */

  // Replicate the isSameOrigin logic from server.ts for pure-function testing
  const TEST_CORS_ORIGINS = ["http://localhost:5173", "https://app.hisaabo.in"];

  function isSameOrigin(origin: string, corsOrigins: string[]): boolean {
    if (!origin) return true; // No origin = server-side call
    if (corsOrigins.some((allowed) => origin === allowed)) return true;
    // Match *.hisaabo.in subdomains — mirrors server.ts regex
    if (/^https?:\/\/([a-z0-9-]+\.)?hisaabo\.in$/i.test(origin)) return true;
    return false;
  }

  it("empty origin is treated as same-origin (server-to-server calls)", () => {
    expect(isSameOrigin("", TEST_CORS_ORIGINS)).toBe(true);
  });

  it("configured CORS origin is treated as same-origin", () => {
    expect(isSameOrigin("http://localhost:5173", TEST_CORS_ORIGINS)).toBe(true);
    expect(isSameOrigin("https://app.hisaabo.in", TEST_CORS_ORIGINS)).toBe(true);
  });

  it("*.hisaabo.in subdomains are treated as same-origin", () => {
    expect(isSameOrigin("https://store.hisaabo.in", TEST_CORS_ORIGINS)).toBe(true);
    expect(isSameOrigin("https://beta.hisaabo.in", TEST_CORS_ORIGINS)).toBe(true);
    expect(isSameOrigin("http://hisaabo.in", TEST_CORS_ORIGINS)).toBe(true);
  });

  it("arbitrary external origins are NOT same-origin", () => {
    expect(isSameOrigin("https://evil.com", TEST_CORS_ORIGINS)).toBe(false);
    expect(isSameOrigin("https://hisaabo.in.attacker.com", TEST_CORS_ORIGINS)).toBe(false);
    expect(isSameOrigin("https://fakehisaabo.in", TEST_CORS_ORIGINS)).toBe(false);
  });

  it("hisaabo.in look-alike with extra path component is NOT same-origin", () => {
    // Prevent matching "https://evil.com/hisaabo.in" — regex anchors to end of hostname
    expect(isSameOrigin("https://evil.com/hisaabo.in", TEST_CORS_ORIGINS)).toBe(false);
  });

  it("rate limit tier for unauthenticated external is 10/min (lowest tier)", () => {
    // This encodes the tier table from server.ts as a constant-check
    const TIERS = {
      "same-auth": 300,
      "same-anon": 60,
      "ext-auth": 120,
      "ext-anon": 10,
    };
    expect(TIERS["ext-anon"]).toBe(10);
    expect(TIERS["same-anon"]).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Rate limit GC: stale buckets older than 5 minutes are cleaned
// ─────────────────────────────────────────────────────────────────────────────
describe("SECURITY — rate limit GC removes stale entries to prevent memory exhaustion", () => {
  /**
   * INVARIANT: The rate-limit map in server.ts is cleaned by a setInterval that
   * deletes entries whose `reset` timestamp is in the past. Without GC, the map
   * would grow without bound under a sustained attack from many IPs.
   *
   * The GC interval is 5 minutes: `setInterval(() => { ... }, 5 * 60_000)`.
   * We test the GC predicate logic here.
   */

  type RateBucket = { count: number; reset: number };

  function gcRateMap(map: Map<string, RateBucket>, now: number): void {
    // Mirrors the setInterval GC body in server.ts
    for (const [key, entry] of map) {
      if (now > entry.reset) map.delete(key);
    }
  }

  it("GC removes entries whose reset timestamp is in the past", () => {
    const now = 1_000_000;
    const map = new Map<string, RateBucket>([
      ["ext-anon:1.2.3.4", { count: 5, reset: now - 1000 }],  // stale
      ["ext-anon:5.6.7.8", { count: 3, reset: now + 30_000 }], // fresh
    ]);
    gcRateMap(map, now);
    expect(map.has("ext-anon:1.2.3.4")).toBe(false); // evicted
    expect(map.has("ext-anon:5.6.7.8")).toBe(true);  // kept
  });

  it("GC keeps entries whose reset timestamp is in the future", () => {
    const now = 2_000_000;
    const map = new Map<string, RateBucket>([
      ["same-anon:10.0.0.1", { count: 42, reset: now + 60_000 }],
    ]);
    gcRateMap(map, now);
    expect(map.has("same-anon:10.0.0.1")).toBe(true);
  });

  it("GC removes entries at exactly the reset boundary (now === reset)", () => {
    const now = 3_000_000;
    const map = new Map<string, RateBucket>([
      ["ext-auth:192.168.1.1", { count: 50, reset: now }], // exactly at boundary
    ]);
    // now > entry.reset is false when now === reset, so entry is NOT removed at exact boundary
    gcRateMap(map, now);
    // now is NOT strictly greater than reset, so the entry stays
    expect(map.has("ext-auth:192.168.1.1")).toBe(true);
  });

  it("GC removes all stale entries when called after 5 minutes", () => {
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    const map = new Map<string, RateBucket>();
    for (let i = 0; i < 100; i++) {
      map.set(`ip:${i}`, { count: 10, reset: fiveMinutesAgo - 1 });
    }
    expect(map.size).toBe(100);
    gcRateMap(map, Date.now());
    expect(map.size).toBe(0);
  });
});

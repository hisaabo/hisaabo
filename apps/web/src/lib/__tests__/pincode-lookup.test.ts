/**
 * Tests for lookupPincode() in apps/web/src/lib/pincode-lookup.ts
 *
 * WHY THIS FILE EXISTS:
 * When a business owner types a pincode on a party or business address form,
 * lookupPincode() auto-fills the district and state. Wrong autofill silently
 * corrupts addresses on invoices and could cause GST filing issues (GSTIN is
 * state-coded). This file verifies the lookup contract for India's major cities
 * and the edge-cases that callers must handle.
 *
 * The function uses only the first 3 digits of the pincode (the "postal circle"
 * prefix), so "110001" and "110999" both resolve to New Delhi, Delhi.
 */

import { describe, it, expect } from "vitest";
import { lookupPincode } from "@/lib/pincode-lookup";

// ─────────────────────────────────────────────────────────────────────────────
// Major Indian metro cities
// ─────────────────────────────────────────────────────────────────────────────
describe("lookupPincode() — major metro city lookups", () => {
  it("110001 → New Delhi, Delhi (national capital, PIN zone 110)", () => {
    const result = lookupPincode("110001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("New Delhi");
    expect(result!.state).toBe("Delhi");
  });

  it("400001 → Mumbai, Maharashtra (financial capital, PIN zone 400)", () => {
    const result = lookupPincode("400001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Mumbai");
    expect(result!.state).toBe("Maharashtra");
  });

  it("560001 → Bengaluru, Karnataka (tech hub, PIN zone 560)", () => {
    const result = lookupPincode("560001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Bengaluru");
    expect(result!.state).toBe("Karnataka");
  });

  it("302001 → Jaipur, Rajasthan (Pink City, PIN zone 302)", () => {
    const result = lookupPincode("302001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Jaipur");
    expect(result!.state).toBe("Rajasthan");
  });

  it("600001 → Chennai, Tamil Nadu (PIN zone 600)", () => {
    const result = lookupPincode("600001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Chennai");
    expect(result!.state).toBe("Tamil Nadu");
  });

  it("380001 → Ahmedabad, Gujarat (PIN zone 380)", () => {
    const result = lookupPincode("380001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Ahmedabad");
    expect(result!.state).toBe("Gujarat");
  });

  it("700001 → Kolkata, West Bengal (PIN zone 700)", () => {
    const result = lookupPincode("700001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Kolkata");
    expect(result!.state).toBe("West Bengal");
  });

  it("500001 → Hyderabad, Telangana (PIN zone 500)", () => {
    const result = lookupPincode("500001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Hyderabad");
    expect(result!.state).toBe("Telangana");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prefix-only matching — only first 3 digits matter
// ─────────────────────────────────────────────────────────────────────────────
describe("lookupPincode() — only first 3 digits are used for matching", () => {
  it("'110999' still resolves to New Delhi because the 110 prefix matches", () => {
    const result = lookupPincode("110999");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("New Delhi");
    expect(result!.state).toBe("Delhi");
  });

  it("'400999' still resolves to Mumbai because the 400 prefix matches", () => {
    const result = lookupPincode("400999");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Mumbai");
    expect(result!.state).toBe("Maharashtra");
  });

  it("'560999' still resolves to Bengaluru because the 560 prefix matches", () => {
    const result = lookupPincode("560999");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Bengaluru");
  });

  it("a 3-character pincode (exactly the prefix) resolves correctly", () => {
    // Callers may pass a partial pincode during live typing
    const result = lookupPincode("302");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Jaipur");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional state coverage — secondary cities
// ─────────────────────────────────────────────────────────────────────────────
describe("lookupPincode() — additional state coverage", () => {
  it("226001 → Lucknow, Uttar Pradesh (state capital, PIN zone 226)", () => {
    const result = lookupPincode("226001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Lucknow");
    expect(result!.state).toBe("Uttar Pradesh");
  });

  it("462001 → Bhopal, Madhya Pradesh (PIN zone 462)", () => {
    const result = lookupPincode("462001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Bhopal");
    expect(result!.state).toBe("Madhya Pradesh");
  });

  it("800001 → Patna, Bihar (PIN zone 800)", () => {
    const result = lookupPincode("800001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Patna");
    expect(result!.state).toBe("Bihar");
  });

  it("834001 → Ranchi, Jharkhand (PIN zone 834)", () => {
    const result = lookupPincode("834001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Ranchi");
    expect(result!.state).toBe("Jharkhand");
  });

  it("695001 → Thiruvananthapuram, Kerala (PIN zone 695)", () => {
    const result = lookupPincode("695001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Thiruvananthapuram");
    expect(result!.state).toBe("Kerala");
  });

  it("751001 → Bhubaneswar, Odisha (PIN zone 751)", () => {
    const result = lookupPincode("751001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Bhubaneswar");
    expect(result!.state).toBe("Odisha");
  });

  it("160001 → Chandigarh (union territory, PIN zone 160)", () => {
    const result = lookupPincode("160001");
    expect(result).not.toBeNull();
    expect(result!.district).toBe("Chandigarh");
    expect(result!.state).toBe("Chandigarh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Null / invalid input — must return null, never throw
// ─────────────────────────────────────────────────────────────────────────────
describe("lookupPincode() — returns null for short or unrecognised input", () => {
  /**
   * The form calls lookupPincode() on every keystroke. It must return null
   * (not throw) when the user has only typed 1 or 2 digits, and when the
   * entered pincode has an unrecognised prefix.
   */

  it("returns null for a 2-character input — too short to determine a prefix", () => {
    expect(lookupPincode("12")).toBeNull();
  });

  it("returns null for a 1-character input", () => {
    expect(lookupPincode("1")).toBeNull();
  });

  it("returns null for an empty string — handles the initial empty field state", () => {
    expect(lookupPincode("")).toBeNull();
  });

  it("returns null for prefix '999' — unrecognised prefix in the lookup table", () => {
    expect(lookupPincode("999001")).toBeNull();
  });

  it("returns null for prefix '000' — no Indian pincodes start with 000", () => {
    expect(lookupPincode("000001")).toBeNull();
  });

  it("does not throw for any invalid input — safe to call during live typing", () => {
    const invalidInputs = ["", "1", "12", "999001", "000000", "abc123"];
    for (const input of invalidInputs) {
      expect(() => lookupPincode(input)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return type shape
// ─────────────────────────────────────────────────────────────────────────────
describe("lookupPincode() — result object shape", () => {
  it("returns an object with exactly 'district' and 'state' string properties", () => {
    const result = lookupPincode("110001");
    expect(result).not.toBeNull();
    expect(typeof result!.district).toBe("string");
    expect(typeof result!.state).toBe("string");
    // No extra unexpected fields
    expect(Object.keys(result!).sort()).toEqual(["district", "state"]);
  });

  it("district and state are non-empty strings for a valid pincode", () => {
    const result = lookupPincode("400001");
    expect(result!.district.length).toBeGreaterThan(0);
    expect(result!.state.length).toBeGreaterThan(0);
  });
});

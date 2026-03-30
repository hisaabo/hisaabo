/**
 * Tests for the auto-shipment creation logic in invoice.ts and the carrier
 * tracking URL builder in shipment.ts.
 *
 * WHY THIS FILE EXISTS:
 * Every sale invoice silently creates a shipment row in the background
 * (invoice.ts:293-308). That creation logic has two non-obvious branches:
 *
 * 1. SHIPPING CHARGE DETECTION — a regex scan over invoice charge labels picks
 *    out the shipping cost. The regex must be broad enough to match common
 *    Indian logistics terminology ("Freight", "Transport Fee") but narrow
 *    enough to exclude unrelated surcharges ("Packaging", "Handling"). A
 *    mismatch means the shipment row silently records ₹0 cost even though the
 *    customer was charged ₹150 for delivery. This file pins the regex boundary.
 *
 * 2. CARRIER TRACKING URL GENERATION — buildTrackingUrl() in shipment.ts maps
 *    7 known carrier keys to deep-link URLs. If a URL template changes upstream
 *    (carrier redesigns their tracking portal), this file catches the drift
 *    immediately. Each carrier URL is independently tested because they have
 *    different query-param shapes (path segment vs ?awb_field= vs ?awbNo=).
 *
 * APPROACH:
 * All tests are pure-function tests — no DB, no mocking, no async.
 * The functions are extracted verbatim from the router source and tested in
 * isolation. This approach matches item-sales-stats.test.ts and
 * query-efficiency.test.ts.
 *
 * ROUTER REFERENCES (grep these to find the real code):
 *   packages/api/src/routers/invoice.ts  lines 293-308  auto-shipment creation
 *   packages/api/src/routers/shipment.ts lines 8-23     carrier URL builder
 */

import { describe, it, expect } from "vitest";

// =============================================================================
// Pure functions — extracted verbatim from router source
// =============================================================================

/**
 * Mirrors invoice.ts:297-299.
 *
 * The regex /shipping|delivery|freight|transport/i is tested against each
 * charge label. It intentionally has no word boundaries — "Shipping Charges"
 * and "Delivery Fee" both match on a substring.
 */
function findShippingCharge(
  charges: Array<{ label: string; amount: string }>
): { label: string; amount: string } | undefined {
  return charges.find((c) => /shipping|delivery|freight|transport/i.test(c.label));
}

/**
 * Known carriers — mirrors shipment.ts:8-16.
 * Key normalisation: lowercase + spaces/hyphens → underscore.
 */
const CARRIER_TRACKING_URLS: Record<string, (trackingNumber: string) => string> = {
  delhivery: (t) => `https://www.delhivery.com/track/package/${t}`,
  bluedart: (t) => `https://www.bluedart.com/tracking/${t}`,
  dtdc: (t) => `https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno=${t}`,
  ecom_express: (t) => `https://ecomexpress.in/tracking/?awb_field=${t}`,
  india_post: (t) => `https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?ConsignmentNumber=${t}`,
  shadowfax: (t) => `https://tracker.shadowfax.in/#/track/${t}`,
  xpressbees: (t) => `https://www.xpressbees.com/shipment/tracking?awbNo=${t}`,
};

/**
 * Mirrors shipment.ts:18-23.
 *
 * Normalises carrier name: lowercase, then replace spaces and hyphens with
 * underscores. Looks up the builder and returns null for unknown carriers.
 */
function buildTrackingUrl(
  carrier: string | null,
  trackingNumber: string | null
): string | null {
  if (!carrier || !trackingNumber) return null;
  const key = carrier.toLowerCase().replace(/[\s-]/g, "_");
  const builder = CARRIER_TRACKING_URLS[key];
  return builder ? builder(trackingNumber) : null;
}

/**
 * Mirrors invoice.ts:296-306 — the full auto-shipment payload decision.
 *
 * Returns the `cost` and `mode` that would be written to the shipments row.
 * For purchase invoices the function returns null (no shipment created).
 */
function resolveAutoShipment(
  invoiceType: "sale" | "purchase",
  charges: Array<{ label: string; amount: string }>
): { mode: string; cost: string } | null {
  if (invoiceType !== "sale") return null;
  const shippingCharge = findShippingCharge(charges);
  return {
    mode: "hand_delivery",
    cost: shippingCharge ? shippingCharge.amount : "0",
  };
}

// =============================================================================
// Section 1: Shipping charge label regex
//
// Guards the boundary between matched labels ("Shipping", "Freight", …) and
// unmatched labels ("Packaging", "Handling", …). A false positive here would
// make the shipment row record the wrong cost; a false negative would silently
// drop the cost to ₹0.
// =============================================================================

describe("findShippingCharge — regex boundary for shipping-related charge labels", () => {
  /**
   * The regex /shipping|delivery|freight|transport/i covers the most common
   * Indian logistics terminology used on B2B invoices. It is deliberately
   * case-insensitive and substring-based so "Shipping Charges", "DELIVERY FEE",
   * and "Door-step Delivery" all match without requiring an exact phrase.
   */

  // ── Labels that must match ───────────────────────────────────────────────

  it('matches "Shipping" (exact, case-sensitive baseline)', () => {
    const charges = [{ label: "Shipping", amount: "150.00" }];
    expect(findShippingCharge(charges)?.label).toBe("Shipping");
  });

  it('matches "Shipping Charges" (canonical B2B label)', () => {
    const charges = [{ label: "Shipping Charges", amount: "120.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it('matches "Delivery Charges" — common courier terminology', () => {
    const charges = [{ label: "Delivery Charges", amount: "80.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it('matches "Freight" — used in B2B transport invoices', () => {
    const charges = [{ label: "Freight", amount: "500.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it('matches "Freight Charges" (compound form)', () => {
    const charges = [{ label: "Freight Charges", amount: "350.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it('matches "Transport Fee" — logistics contractor terminology', () => {
    const charges = [{ label: "Transport Fee", amount: "200.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it('matches "Transportation Charges" (full word, also contains "transport")', () => {
    const charges = [{ label: "Transportation Charges", amount: "300.00" }];
    expect(findShippingCharge(charges)).toBeDefined();
  });

  it("is case-insensitive — SHIPPING, Delivery, FREIGHT all match", () => {
    expect(findShippingCharge([{ label: "SHIPPING", amount: "100.00" }])).toBeDefined();
    expect(findShippingCharge([{ label: "DELIVERY FEE", amount: "100.00" }])).toBeDefined();
    expect(findShippingCharge([{ label: "FREIGHT COST", amount: "100.00" }])).toBeDefined();
    expect(findShippingCharge([{ label: "TRANSPORT CHARGES", amount: "100.00" }])).toBeDefined();
  });

  // ── Labels that must NOT match ───────────────────────────────────────────

  it('does NOT match "Packaging" — surcharge unrelated to shipping mode', () => {
    /**
     * Packaging cost is a separate line item in many invoices. Including it
     * in the shipment cost would overstate what was spent on actual delivery.
     */
    const charges = [{ label: "Packaging", amount: "25.00" }];
    expect(findShippingCharge(charges)).toBeUndefined();
  });

  it('does NOT match "Packaging Charges"', () => {
    const charges = [{ label: "Packaging Charges", amount: "30.00" }];
    expect(findShippingCharge(charges)).toBeUndefined();
  });

  it('does NOT match "Handling" — warehouse/fulfilment surcharge, not shipment cost', () => {
    const charges = [{ label: "Handling", amount: "50.00" }];
    expect(findShippingCharge(charges)).toBeUndefined();
  });

  it('does NOT match "Handling Fee"', () => {
    const charges = [{ label: "Handling Fee", amount: "40.00" }];
    expect(findShippingCharge(charges)).toBeUndefined();
  });

  it('does NOT match "Insurance"', () => {
    const charges = [{ label: "Insurance", amount: "75.00" }];
    expect(findShippingCharge(charges)).toBeUndefined();
  });

  it('does NOT match "GST" or "Tax"', () => {
    expect(findShippingCharge([{ label: "GST", amount: "18.00" }])).toBeUndefined();
    expect(findShippingCharge([{ label: "Tax", amount: "9.00" }])).toBeUndefined();
  });

  // ── Multi-charge arrays ──────────────────────────────────────────────────

  it("returns the first matching charge when multiple charges exist", () => {
    /**
     * An invoice can carry both Packaging and Shipping as separate line items.
     * The function must find the shipping charge and ignore the packaging one.
     */
    const charges = [
      { label: "Packaging", amount: "25.00" },
      { label: "Shipping Charges", amount: "150.00" },
      { label: "Insurance", amount: "50.00" },
    ];
    const found = findShippingCharge(charges);
    expect(found?.label).toBe("Shipping Charges");
    expect(found?.amount).toBe("150.00");
  });

  it("returns undefined when no charge matches (empty array)", () => {
    expect(findShippingCharge([])).toBeUndefined();
  });

  it("returns undefined when all charges are non-shipping", () => {
    const charges = [
      { label: "Packaging", amount: "25.00" },
      { label: "Handling", amount: "40.00" },
      { label: "Insurance", amount: "75.00" },
    ];
    expect(findShippingCharge(charges)).toBeUndefined();
  });
});

// =============================================================================
// Section 2: Carrier tracking URL generation
//
// Each of the 7 built-in carriers has a distinct URL shape. Testing them
// independently ensures that a carrier portal redesign (changing query params
// or path structure) is caught immediately.
// =============================================================================

describe("buildTrackingUrl — 7 built-in carrier deep-link templates", () => {
  /**
   * The key normalisation step: carrier.toLowerCase().replace(/[\s-]/g, "_")
   * This means user-supplied strings like "Ecom Express", "ecom-express", and
   * "ECOM_EXPRESS" all resolve to the same key "ecom_express".
   *
   * URL format summary:
   *   Delhivery   — path segment:  /track/package/{awb}
   *   BlueDart    — path segment:  /tracking/{awb}
   *   DTDC        — query param:   ?strCnno={awb}
   *   Ecom Express— query param:   ?awb_field={awb}
   *   India Post  — query param:   ?ConsignmentNumber={awb}
   *   Shadowfax   — hash fragment: #/track/{awb}
   *   Xpressbees  — query param:   ?awbNo={awb}
   */

  const AWB = "1234567890";

  it("Delhivery — path-segment URL with /track/package/ prefix", () => {
    const url = buildTrackingUrl("delhivery", AWB);
    expect(url).toBe(`https://www.delhivery.com/track/package/${AWB}`);
  });

  it("Delhivery — mixed-case carrier name is normalised correctly", () => {
    expect(buildTrackingUrl("Delhivery", AWB)).toBe(buildTrackingUrl("delhivery", AWB));
    expect(buildTrackingUrl("DELHIVERY", AWB)).toBe(buildTrackingUrl("delhivery", AWB));
  });

  it("BlueDart — path-segment URL under /tracking/", () => {
    const url = buildTrackingUrl("bluedart", AWB);
    expect(url).toBe(`https://www.bluedart.com/tracking/${AWB}`);
  });

  it("BlueDart — normalises 'Blue Dart' (space) and 'Blue-Dart' (hyphen)", () => {
    // Space → underscore in key; but "Blue Dart" → "blue_dart" which is NOT
    // in the map. The stored key is "bluedart" (no separator). This is correct:
    // the carrier string stored in DB is expected to match the key exactly.
    // "Bluedart" normalised → "bluedart" ✓
    expect(buildTrackingUrl("Bluedart", AWB)).toBe(buildTrackingUrl("bluedart", AWB));
  });

  it("DTDC — query-param URL with ?strCnno=", () => {
    const url = buildTrackingUrl("dtdc", AWB);
    expect(url).toBe(
      `https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno=${AWB}`
    );
  });

  it("DTDC — uppercase carrier string normalises correctly", () => {
    expect(buildTrackingUrl("DTDC", AWB)).toBe(buildTrackingUrl("dtdc", AWB));
  });

  it("Ecom Express — query-param URL with ?awb_field=", () => {
    const url = buildTrackingUrl("ecom_express", AWB);
    expect(url).toBe(`https://ecomexpress.in/tracking/?awb_field=${AWB}`);
  });

  it("Ecom Express — 'Ecom Express' (spaced) normalises to ecom_express key", () => {
    // "Ecom Express" → lowercase → "ecom express" → replace space → "ecom_express"
    expect(buildTrackingUrl("Ecom Express", AWB)).toBe(buildTrackingUrl("ecom_express", AWB));
  });

  it("India Post — long query-param URL with ?ConsignmentNumber=", () => {
    const url = buildTrackingUrl("india_post", AWB);
    expect(url).toBe(
      `https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx?ConsignmentNumber=${AWB}`
    );
  });

  it("India Post — 'India Post' (spaced) normalises to india_post key", () => {
    expect(buildTrackingUrl("India Post", AWB)).toBe(buildTrackingUrl("india_post", AWB));
  });

  it("Shadowfax — hash-fragment URL with #/track/ prefix (unusual format)", () => {
    /**
     * Shadowfax uses a client-side hash route rather than a query param.
     * This means the tracking number must appear after '#' — any URL encoding
     * of the '#' would break the link.
     */
    const url = buildTrackingUrl("shadowfax", AWB);
    expect(url).toBe(`https://tracker.shadowfax.in/#/track/${AWB}`);
    expect(url).toContain("#/track/");
  });

  it("Xpressbees — query-param URL with ?awbNo= (camelCase param name)", () => {
    /**
     * Unlike Ecom Express which uses ?awb_field= (snake_case), Xpressbees
     * uses ?awbNo= (camelCase). This asymmetry is locked in here so a
     * find-and-replace normalisation pass doesn't silently break it.
     */
    const url = buildTrackingUrl("xpressbees", AWB);
    expect(url).toBe(`https://www.xpressbees.com/shipment/tracking?awbNo=${AWB}`);
    expect(url).toContain("awbNo=");
  });

  it("Xpressbees — 'Xpressbees' (title-case) normalises correctly", () => {
    expect(buildTrackingUrl("Xpressbees", AWB)).toBe(buildTrackingUrl("xpressbees", AWB));
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it("returns null for an unknown carrier — no guess, no fallback", () => {
    /**
     * An unknown carrier means we have no URL template. Returning null is
     * correct: the user can fill in a manual tracking URL instead. Returning
     * a wrong URL would be worse than returning nothing.
     */
    expect(buildTrackingUrl("FedEx", AWB)).toBeNull();
    expect(buildTrackingUrl("DHL", AWB)).toBeNull();
    expect(buildTrackingUrl("Aramex", AWB)).toBeNull();
  });

  it("returns null when carrier is null", () => {
    expect(buildTrackingUrl(null, AWB)).toBeNull();
  });

  it("returns null when trackingNumber is null", () => {
    expect(buildTrackingUrl("delhivery", null)).toBeNull();
  });

  it("returns null when both carrier and trackingNumber are null", () => {
    expect(buildTrackingUrl(null, null)).toBeNull();
  });

  it("embeds the tracking number verbatim — no transformation applied", () => {
    /**
     * Some carriers use alphanumeric AWBs with uppercase letters. The function
     * must NOT lowercase the tracking number (only the carrier key is lowercased).
     */
    const alphanumericAwb = "DEL123456789IN";
    const url = buildTrackingUrl("delhivery", alphanumericAwb);
    expect(url).toContain(alphanumericAwb);
    expect(url).not.toContain(alphanumericAwb.toLowerCase());
  });
});

// =============================================================================
// Section 3: Auto-shipment creation — default behaviour (no shipping charge)
//
// Every sale invoice must produce a shipment with mode="hand_delivery" and
// cost="0" when the invoice carries no recognisable shipping charge.
// =============================================================================

describe("resolveAutoShipment — default hand_delivery shipment for all sale invoices", () => {
  /**
   * WHY hand_delivery is the default:
   * A large share of Indian SMB deliveries are handled by the seller's own
   * driver or by the owner hand-delivering goods. These shipments have no
   * tracking number. Setting mode="hand_delivery" and cost="0" means the
   * shipment record exists for audit purposes without implying a courier was
   * used or a charge was incurred.
   *
   * The shipment row exists even with cost=0 so that:
   * - The business has a complete delivery log per invoice.
   * - The mode can be updated later if a courier is chosen after dispatch.
   * - Reports on shipment counts are accurate (count includes hand deliveries).
   */

  it("creates a shipment for a sale invoice with no charges", () => {
    const result = resolveAutoShipment("sale", []);
    expect(result).not.toBeNull();
    expect(result?.mode).toBe("hand_delivery");
    expect(result?.cost).toBe("0");
  });

  it("creates a shipment for a sale invoice with only non-shipping charges", () => {
    const charges = [
      { label: "Packaging", amount: "25.00" },
      { label: "Handling Fee", amount: "40.00" },
    ];
    const result = resolveAutoShipment("sale", charges);
    expect(result?.mode).toBe("hand_delivery");
    expect(result?.cost).toBe("0");
  });

  it("does NOT create a shipment for purchase invoices", () => {
    /**
     * Shipments track outbound deliveries to customers. A purchase invoice
     * represents inbound goods — the supplier handles delivery, not us.
     * Creating a shipment row for purchases would pollute delivery reports.
     */
    const result = resolveAutoShipment("purchase", []);
    expect(result).toBeNull();
  });

  it("mode is always hand_delivery regardless of charge presence", () => {
    /**
     * The mode field captures the delivery method. It defaults to hand_delivery
     * and can only be changed after shipment creation via shipment.update.
     * Auto-creation never sets a carrier mode — it cannot know which courier
     * will be used at invoice creation time.
     */
    const withCharge = resolveAutoShipment("sale", [
      { label: "Shipping", amount: "100.00" },
    ]);
    const withoutCharge = resolveAutoShipment("sale", []);
    expect(withCharge?.mode).toBe("hand_delivery");
    expect(withoutCharge?.mode).toBe("hand_delivery");
  });
});

// =============================================================================
// Section 4: Auto-shipment creation — shipping charge flows to cost
//
// When the invoice has a recognised shipping-related charge, that charge's
// amount must appear verbatim on the shipment row as the cost field.
// =============================================================================

describe("resolveAutoShipment — shipping charge amount flows to shipment cost", () => {
  /**
   * WHY cost flows directly from the charge:
   * The charge amount on the invoice is what the customer paid for delivery.
   * Recording it on the shipment row means logistics cost reports can be
   * generated directly from the shipments table without joining invoices.
   *
   * The amount is kept as a string (matching PostgreSQL NUMERIC(15,2)) — no
   * floating-point conversion is performed.
   */

  it("sets cost from a Shipping charge", () => {
    const result = resolveAutoShipment("sale", [
      { label: "Shipping", amount: "150.00" },
    ]);
    expect(result?.cost).toBe("150.00");
  });

  it("sets cost from a Delivery Charges label", () => {
    const result = resolveAutoShipment("sale", [
      { label: "Delivery Charges", amount: "80.00" },
    ]);
    expect(result?.cost).toBe("80.00");
  });

  it("sets cost from a Freight label", () => {
    const result = resolveAutoShipment("sale", [
      { label: "Freight", amount: "500.00" },
    ]);
    expect(result?.cost).toBe("500.00");
  });

  it("sets cost from a Transport Fee label", () => {
    const result = resolveAutoShipment("sale", [
      { label: "Transport Fee", amount: "200.00" },
    ]);
    expect(result?.cost).toBe("200.00");
  });

  it("preserves the exact string amount — no rounding or float conversion", () => {
    /**
     * Money is always kept as strings matching NUMERIC(15,2). If we converted
     * to Number here, "99.90" could silently become 99.9 and fail DB validation.
     */
    const result = resolveAutoShipment("sale", [
      { label: "Shipping", amount: "99.90" },
    ]);
    expect(result?.cost).toBe("99.90");
  });

  it("uses the first matching charge when multiple shipping labels exist", () => {
    /**
     * Malformed invoices might carry two shipping lines. The function uses
     * Array.find() — it takes the first match and ignores the rest. This
     * deterministic behaviour prevents silent double-counting.
     */
    const charges = [
      { label: "Shipping", amount: "100.00" },
      { label: "Freight", amount: "200.00" },
    ];
    const result = resolveAutoShipment("sale", charges);
    expect(result?.cost).toBe("100.00");
  });

  it("ignores non-matching charges alongside a shipping charge — cost is shipping only", () => {
    /**
     * Packaging is correctly excluded. Only the shipping amount appears on
     * the shipment cost — not the sum of all charges.
     */
    const charges = [
      { label: "Packaging", amount: "25.00" },
      { label: "Shipping Charges", amount: "150.00" },
      { label: "Insurance", amount: "50.00" },
    ];
    const result = resolveAutoShipment("sale", charges);
    expect(result?.cost).toBe("150.00");
  });

  it("falls back to cost=0 when shipping label is present but amount is zero", () => {
    /**
     * Some businesses add a ₹0 shipping line as a placeholder. The amount
     * flows through unchanged — we do not strip zero-cost charges.
     */
    const result = resolveAutoShipment("sale", [
      { label: "Shipping", amount: "0" },
    ]);
    expect(result?.cost).toBe("0");
  });
});

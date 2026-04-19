/**
 * Self-export row-schema tests, focused on the NEW bytea envelope that
 * transports binary columns (currently just businesses.logoData) across
 * the NDJSON self-export / self-import boundary.
 *
 * WHY THIS MATTERS:
 * The envelope is the *only* thing that makes Postgres `bytea` columns
 * round-trip through JSON. A bug here either loses bytes silently
 * (the logo disappears after an export/import cycle) or lets unexpected
 * shapes through (which then crashes the Drizzle driver with an opaque
 * "invalid input syntax for type bytea" error). Both are user-hostile;
 * the invariant below — encode → decode → exact Buffer match — is the
 * contract these tests lock in.
 */

import { describe, it, expect } from "vitest";
import { businessRowSchema } from "../selfExport/rowSchemas.js";

// A minimum valid businesses-row skeleton. Each test overrides just the
// logo fields so the rest of the schema doesn't obscure the assertion.
function withLogoFields(extra: Record<string, unknown>): unknown {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    createdByUserId: "22222222-2222-2222-2222-222222222222",
    name: "Sharma Traders",
    legalName: null,
    gstRegistrationType: "unregistered",
    gstin: null,
    pan: null,
    phone: null,
    email: null,
    address: null,
    city: null,
    state: null,
    stateCode: null,
    pincode: null,
    logoUrl: null,
    invoicePrefix: "INV",
    nextInvoiceNumber: 1,
    paymentPrefix: "PAY",
    nextPaymentNumber: 1,
    quotationPrefix: "QT",
    nextQuotationNumber: 1,
    creditNotePrefix: "CN",
    nextCreditNoteNumber: 1,
    debitNotePrefix: "DN",
    nextDebitNoteNumber: 1,
    salesReturnPrefix: "SR",
    nextSalesReturnNumber: 1,
    purchaseReturnPrefix: "PR",
    nextPurchaseReturnNumber: 1,
    deliveryChallanPrefix: "DC",
    nextDeliveryChallanNumber: 1,
    proformaPrefix: "PI",
    nextProformaNumber: 1,
    financialYearStart: 4,
    currency: "INR",
    annualTurnover: null,
    storeEnabled: false,
    storeSlug: null,
    storeTagline: null,
    storeAccentColor: null,
    storeMinOrderAmount: null,
    storeDeliveryNote: null,
    storeWhatsappNumber: null,
    storeAllowNegativeStock: false,
    customShippingMethods: null,
    carrierCredentials: null,
    nextStoreOrderNumber: 1,
    storeOrderPrefix: "SO",
    createdAt: "2026-04-19T00:00:00.000Z",
    updatedAt: "2026-04-19T00:00:00.000Z",
    ...extra,
  };
}

// Deterministic byte sequences so assertions can be exact — not just
// "some buffer came back."
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// ─────────────────────────────────────────────────────────────────────────
// Round-trip — the core contract
// ─────────────────────────────────────────────────────────────────────────
describe("businessRowSchema.logoData — bytea envelope round-trip", () => {
  it("decodes a base64 envelope into a Buffer whose bytes exactly match the original", () => {
    const original = Buffer.concat([PNG_SIGNATURE, Buffer.from("some opaque image body bytes")]);
    const row = withLogoFields({
      logoData: { __type: "bytes", base64: original.toString("base64") },
      logoMimeType: "image/png",
      logoWidth: 200,
      logoHeight: 80,
      logoUpdatedAt: "2026-04-19T00:00:00.000Z",
    });

    const parsed = businessRowSchema.parse(row);
    // The schema must produce a Buffer, not a plain Uint8Array — the pg
    // driver binds Buffers directly as bytea on insert; a Uint8Array
    // would be serialised as a JSON array of numbers and corrupt the row.
    expect(Buffer.isBuffer(parsed.logoData)).toBe(true);
    // And the bytes must match exactly — one off-by-one here silently
    // breaks PNG signature validation on re-import.
    expect(Buffer.compare(parsed.logoData as Buffer, original)).toBe(0);
  });

  it("handles JPEG byte sequences identically — the envelope is format-agnostic", () => {
    const jpegBody = Buffer.concat([JPEG_SIGNATURE, Buffer.from([0, 16, 74, 70, 73, 70])]);
    const row = withLogoFields({
      logoData: { __type: "bytes", base64: jpegBody.toString("base64") },
      logoMimeType: "image/jpeg",
    });
    const parsed = businessRowSchema.parse(row);
    expect(Buffer.compare(parsed.logoData as Buffer, jpegBody)).toBe(0);
  });

  it("round-trips an empty byte sequence as an empty Buffer — zero-length is a legal (if unusual) bytea value", () => {
    const row = withLogoFields({
      logoData: { __type: "bytes", base64: "" },
    });
    const parsed = businessRowSchema.parse(row);
    expect(Buffer.isBuffer(parsed.logoData)).toBe(true);
    expect((parsed.logoData as Buffer).length).toBe(0);
  });

  it("round-trips a 100 KB payload without corruption — realistic logo size", () => {
    const large = Buffer.alloc(100 * 1024);
    for (let i = 0; i < large.length; i++) large[i] = (i * 31) & 0xff;
    const row = withLogoFields({
      logoData: { __type: "bytes", base64: large.toString("base64") },
    });
    const parsed = businessRowSchema.parse(row);
    expect(Buffer.compare(parsed.logoData as Buffer, large)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Null / absent / backwards-compat
// ─────────────────────────────────────────────────────────────────────────
describe("businessRowSchema.logoData — null and absent paths", () => {
  it("accepts an explicit null envelope — businesses without a logo export `logoData: null`", () => {
    const row = withLogoFields({ logoData: null });
    const parsed = businessRowSchema.parse(row);
    expect(parsed.logoData).toBeNull();
  });

  it("accepts the field being entirely absent — older pre-logo exports won't carry it at all", () => {
    const row = withLogoFields({}); // logoData never set
    const parsed = businessRowSchema.parse(row);
    // `.optional()` allows missing → undefined; the import-side consumer
    // treats both null and undefined the same way (no logo).
    expect(parsed.logoData).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Envelope-shape defences — stop malformed JSON from reaching Drizzle
// ─────────────────────────────────────────────────────────────────────────
describe("businessRowSchema.logoData — rejects malformed envelopes", () => {
  it("rejects a raw base64 string (no envelope wrapper) — a bare string is ambiguous and could be mistaken for a URL column", () => {
    const row = withLogoFields({
      logoData: Buffer.from("abc").toString("base64"),
    });
    const parsed = businessRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
  });

  it("rejects a plain Buffer in the JSON — tests against a footgun where a caller forgets to base64-encode before serialising", () => {
    const row = withLogoFields({
      logoData: Buffer.from("oops"),
    });
    const parsed = businessRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
  });

  it("rejects an envelope missing the __type tag — an untagged {base64:...} could be any JSON object and must not be inferred", () => {
    const row = withLogoFields({
      logoData: { base64: "aGVsbG8=" },
    });
    const parsed = businessRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
  });

  it("rejects an envelope with a wrong __type literal (future-proofing for additional envelope types)", () => {
    const row = withLogoFields({
      logoData: { __type: "binary", base64: "aGVsbG8=" },
    });
    const parsed = businessRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
  });

  it("rejects an envelope with a non-string base64 field", () => {
    const row = withLogoFields({
      logoData: { __type: "bytes", base64: 12345 },
    });
    const parsed = businessRowSchema.safeParse(row);
    expect(parsed.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Companion logo metadata columns — optional + nullable shape
// ─────────────────────────────────────────────────────────────────────────
describe("businessRowSchema — companion logo metadata (mime/width/height/updatedAt)", () => {
  it("accepts nullable logoMimeType", () => {
    const row = withLogoFields({ logoMimeType: null });
    expect(businessRowSchema.safeParse(row).success).toBe(true);
  });

  it("accepts nullable logoWidth / logoHeight as integers", () => {
    const row = withLogoFields({ logoWidth: 512, logoHeight: 256 });
    expect(businessRowSchema.safeParse(row).success).toBe(true);
  });

  it("rejects non-integer dimensions — pixel counts are always integers in the DB", () => {
    const row = withLogoFields({ logoWidth: 512.5 });
    expect(businessRowSchema.safeParse(row).success).toBe(false);
  });

  it("accepts an ISO-8601 logoUpdatedAt and transforms it into a Date so Drizzle's timestamp driver can accept it", () => {
    const row = withLogoFields({ logoUpdatedAt: "2026-04-19T10:30:00.000Z" });
    const parsed = businessRowSchema.parse(row);
    expect(parsed.logoUpdatedAt).toBeInstanceOf(Date);
    expect((parsed.logoUpdatedAt as Date).toISOString()).toBe("2026-04-19T10:30:00.000Z");
  });

  it("rejects a non-ISO logoUpdatedAt — `2026-04-19` without time is not ISO-8601 datetime", () => {
    const row = withLogoFields({ logoUpdatedAt: "2026-04-19" });
    expect(businessRowSchema.safeParse(row).success).toBe(false);
  });
});

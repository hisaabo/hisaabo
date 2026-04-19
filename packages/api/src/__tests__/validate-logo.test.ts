/**
 * validateLogoDataUrl — magic-byte authoritative check unit tests.
 *
 * This helper is the server-side gatekeeper for business logo uploads.
 * It sits downstream of the Zod schema shape check (covered separately in
 * packages/shared/src/__tests__/validators.test.ts) and before the bytea
 * write to Postgres. A regression here is dangerous in specific ways:
 *
 *   - If the magic-byte check is ever weakened, a malicious client can
 *     upload arbitrary bytes labeled as a PNG — these land in the DB and
 *     are later served to the storefront as `Content-Type: image/png`.
 *     Even with `X-Content-Type-Options: nosniff`, shipping the wrong
 *     bytes is a browser-renderer footgun (see e.g. polyglot files).
 *
 *   - If the MIME-match check is relaxed, we'd store JPEG bytes under
 *     the `image/png` mime string (or vice versa) and the storefront
 *     response would mislabel them. Browsers that honour nosniff refuse
 *     to render, so the logo just disappears from the customer's view.
 *
 *   - If the size cap is dropped, a single upload can permanently bloat
 *     the tenant DB since the bytes ride along in pg_dump / pg_basebackup.
 *
 * Each test names the invariant it defends.
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { validateLogoDataUrl } from "../lib/validate-logo.js";

// ─────────────────────────────────────────────────────────────────────────
// Byte fixtures — real magic-byte prefixes so the positive-path tests
// actually prove the detector works, not just that "some bytes" passed.
// ─────────────────────────────────────────────────────────────────────────
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

/** Build a valid-looking PNG data URL with `extraBytes` appended after the signature. */
function pngDataUrl(extraBytes: Buffer = Buffer.alloc(0)): string {
  const buf = Buffer.concat([PNG_MAGIC, extraBytes]);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function jpegDataUrl(extraBytes: Buffer = Buffer.alloc(0)): string {
  const buf = Buffer.concat([JPEG_MAGIC, extraBytes]);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Run the validator and collect any thrown TRPCError. Helper for assertions. */
function tryValidate(dataUrl: string): { ok: true; result: ReturnType<typeof validateLogoDataUrl> } | { ok: false; code: string; message: string } {
  try {
    return { ok: true, result: validateLogoDataUrl(dataUrl) };
  } catch (err) {
    if (err instanceof TRPCError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────
describe("validateLogoDataUrl — happy path", () => {
  it("accepts a PNG data URL with correct magic bytes and returns the decoded Buffer", () => {
    const body = Buffer.from("some-opaque-png-body");
    const result = validateLogoDataUrl(pngDataUrl(body));
    expect(result.mime).toBe("image/png");
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    // The decoded bytes must equal the original payload — an off-by-one
    // here would corrupt the row we write to bytea.
    expect(Buffer.compare(result.bytes, Buffer.concat([PNG_MAGIC, body]))).toBe(0);
  });

  it("accepts a JPEG data URL with correct magic bytes", () => {
    const result = validateLogoDataUrl(jpegDataUrl(Buffer.from("body")));
    expect(result.mime).toBe("image/jpeg");
    expect(result.bytes.length).toBeGreaterThan(JPEG_MAGIC.length);
  });

  it("accepts a PNG right at the 1 MB decoded cap (boundary-inclusive check)", () => {
    // 1,048,576 bytes total: 8 magic bytes + 1,048,568 filler.
    const filler = Buffer.alloc(1_048_576 - PNG_MAGIC.length);
    const result = validateLogoDataUrl(pngDataUrl(filler));
    expect(result.bytes.length).toBe(1_048_576);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Shape failures
// ─────────────────────────────────────────────────────────────────────────
describe("validateLogoDataUrl — shape failures are rejected as BAD_REQUEST", () => {
  it("rejects a bare base64 string (no `data:` prefix) — ambiguous input, would otherwise slip into a raw Buffer.from() path", () => {
    const outcome = tryValidate("aGVsbG8gd29ybGQ=");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("BAD_REQUEST");
  });

  it("rejects a data URL for an unsupported MIME (SVG) — SVG carries script payload risk and is not supported server-side", () => {
    const svg =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIC8+";
    const outcome = tryValidate(svg);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("BAD_REQUEST");
  });

  it("rejects a data URL for GIF / WebP — even though they are valid image formats, the allowlist is strict PNG|JPEG", () => {
    for (const mime of ["image/gif", "image/webp", "image/bmp"]) {
      const outcome = tryValidate(`data:${mime};base64,${PNG_MAGIC.toString("base64")}`);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).toBe("BAD_REQUEST");
    }
  });

  it("rejects non-base64 charset (e.g. `;utf-8,`)", () => {
    const outcome = tryValidate("data:image/png;utf-8,%89PNG");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("BAD_REQUEST");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Size cap
// ─────────────────────────────────────────────────────────────────────────
describe("validateLogoDataUrl — size cap", () => {
  it("rejects a PNG exactly 1 byte over the 1 MB decoded cap as PAYLOAD_TOO_LARGE", () => {
    const filler = Buffer.alloc(1_048_576 - PNG_MAGIC.length + 1); // one over
    const outcome = tryValidate(pngDataUrl(filler));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("uses DECODED size — a huge base64 payload that decodes to bytes ≤ 1 MB must pass the size gate", () => {
    // 1 MB of zeros — base64 encodes to ~1.36 MB of chars, but the
    // decoded byte count is the ONLY thing the size cap cares about.
    const filler = Buffer.alloc(1_048_576 - PNG_MAGIC.length);
    const result = validateLogoDataUrl(pngDataUrl(filler));
    expect(result.bytes.length).toBe(1_048_576);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Magic-byte failures — the authoritative defence
// ─────────────────────────────────────────────────────────────────────────
describe("validateLogoDataUrl — magic-byte rejection", () => {
  it("rejects a payload declared as PNG whose bytes start with anything other than the PNG signature", () => {
    const notAPng = Buffer.from("this-is-definitely-not-a-png-file");
    const dataUrl = `data:image/png;base64,${notAPng.toString("base64")}`;
    const outcome = tryValidate(dataUrl);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      // Bytes don't match any known signature → "not a valid PNG or JPEG"
      expect(outcome.code).toBe("BAD_REQUEST");
      expect(outcome.message).toMatch(/valid PNG or JPEG/);
    }
  });

  it("rejects a payload that is too short to carry any signature (2 bytes total)", () => {
    const tiny = Buffer.from([0x89, 0x50]);
    const dataUrl = `data:image/png;base64,${tiny.toString("base64")}`;
    const outcome = tryValidate(dataUrl);
    expect(outcome.ok).toBe(false);
  });

  it("rejects a PNG signature with one byte wrong — off-by-one must be caught (not just any-8-bytes)", () => {
    // 0x89 50 4E 47 0D 0A 1A 0A is correct; flipping the last byte to 0xFF
    const bogus = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0xff]);
    const outcome = tryValidate(`data:image/png;base64,${bogus.toString("base64")}`);
    expect(outcome.ok).toBe(false);
  });

  it("rejects a JPEG signature with the wrong third byte — 0xFFD8 alone is not enough, must be 0xFFD8FF", () => {
    const bogus = Buffer.from([0xff, 0xd8, 0x00, 0xe0]);
    const outcome = tryValidate(`data:image/jpeg;base64,${bogus.toString("base64")}`);
    expect(outcome.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Declared vs actual MIME mismatch — the attack the schema alone cannot catch
// ─────────────────────────────────────────────────────────────────────────
describe("validateLogoDataUrl — declared vs actual MIME mismatch", () => {
  it("rejects JPEG bytes that are labeled `data:image/png;base64,` — this is the specific attack the magic-byte check exists to stop", () => {
    // JPEG magic bytes, declared as PNG
    const smuggled = `data:image/png;base64,${JPEG_MAGIC.toString("base64")}`;
    const outcome = tryValidate(smuggled);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("BAD_REQUEST");
      expect(outcome.message).toMatch(/Declared MIME does not match/);
    }
  });

  it("rejects PNG bytes labeled `data:image/jpeg;base64,` — the symmetric attack", () => {
    const smuggled = `data:image/jpeg;base64,${PNG_MAGIC.toString("base64")}`;
    const outcome = tryValidate(smuggled);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/Declared MIME does not match/);
  });

  it("surfaces the mismatch even when both sides would otherwise pass individually — defence against refactors that drop the final mismatch check", () => {
    // Both declared MIME and actual bytes are valid image formats on their
    // own — only the mismatch makes this input illegitimate. A refactor
    // that removes the final equality check would silently accept this.
    const smuggled = `data:image/png;base64,${JPEG_MAGIC.toString("base64")}`;
    expect(() => validateLogoDataUrl(smuggled)).toThrow(TRPCError);
  });
});

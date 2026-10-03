/**
 * validateItemImageDataUrl — magic-byte authoritative check for item images.
 *
 * Same threat model as validateLogoDataUrl (see validate-logo.test.ts) with two
 * differences: WebP is allowed, and the decoded-size cap is 3 MB. These tests
 * pin the format allowlist, the magic-byte detector (including the WebP
 * RIFF/WEBP container check), the declared-vs-actual MIME guard, and the cap.
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { validateItemImageDataUrl, MAX_ITEM_IMAGE_BYTES } from "../lib/validate-image.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
// "RIFF" + 4-byte size (arbitrary) + "WEBP"
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function tryValidate(url: string) {
  try {
    return { ok: true as const, result: validateItemImageDataUrl(url) };
  } catch (err) {
    if (err instanceof TRPCError) return { ok: false as const, code: err.code, message: err.message };
    throw err;
  }
}

describe("validateItemImageDataUrl — happy path", () => {
  it("accepts a PNG and returns the decoded bytes verbatim", () => {
    const body = Buffer.from("png-body");
    const res = validateItemImageDataUrl(dataUrl("image/png", Buffer.concat([PNG_MAGIC, body])));
    expect(res.mime).toBe("image/png");
    expect(Buffer.compare(res.bytes, Buffer.concat([PNG_MAGIC, body]))).toBe(0);
  });

  it("accepts a JPEG", () => {
    const res = validateItemImageDataUrl(dataUrl("image/jpeg", Buffer.concat([JPEG_MAGIC, Buffer.from("x")])));
    expect(res.mime).toBe("image/jpeg");
  });

  it("accepts a WebP via the RIFF/WEBP container check", () => {
    const res = validateItemImageDataUrl(dataUrl("image/webp", WEBP_MAGIC));
    expect(res.mime).toBe("image/webp");
  });

  it("accepts an image right at the 3 MB decoded cap", () => {
    const filler = Buffer.alloc(MAX_ITEM_IMAGE_BYTES - PNG_MAGIC.length);
    const res = validateItemImageDataUrl(dataUrl("image/png", Buffer.concat([PNG_MAGIC, filler])));
    expect(res.bytes.length).toBe(MAX_ITEM_IMAGE_BYTES);
  });
});

describe("validateItemImageDataUrl — rejections", () => {
  it("rejects SVG and GIF (not on the allowlist)", () => {
    for (const mime of ["image/svg+xml", "image/gif", "image/bmp"]) {
      const outcome = tryValidate(dataUrl(mime, PNG_MAGIC));
      expect(outcome.ok).toBe(false);
    }
  });

  it("rejects an empty payload", () => {
    const outcome = tryValidate("data:image/png;base64,");
    expect(outcome.ok).toBe(false);
  });

  it("rejects one byte over the 3 MB cap as PAYLOAD_TOO_LARGE", () => {
    const filler = Buffer.alloc(MAX_ITEM_IMAGE_BYTES - PNG_MAGIC.length + 1);
    const outcome = tryValidate(dataUrl("image/png", Buffer.concat([PNG_MAGIC, filler])));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects WebP magic smuggled under a PNG label (declared vs actual mismatch)", () => {
    const outcome = tryValidate(dataUrl("image/png", WEBP_MAGIC));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/Declared MIME does not match/);
  });

  it("rejects a truncated WebP (RIFF without the WEBP fourcc)", () => {
    const truncated = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const outcome = tryValidate(dataUrl("image/webp", truncated));
    expect(outcome.ok).toBe(false);
  });
});

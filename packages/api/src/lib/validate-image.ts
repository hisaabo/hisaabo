import { TRPCError } from "@trpc/server";

/** Largest decoded item image we accept, in bytes (~3 MB). */
export const MAX_ITEM_IMAGE_BYTES = 3 * 1024 * 1024;

export type ItemImageMime = "image/png" | "image/jpeg" | "image/webp";

/**
 * Validate a user-uploaded item-image data URL and decode it to raw bytes.
 *
 * Same threat model as `validateLogoDataUrl`, extended to allow WebP (common
 * for product photos and much smaller than PNG/JPEG). The declared MIME is
 * never trusted — file type is proven from magic bytes, and the decoded size
 * is re-checked here because the schema's cap is on the encoded string length.
 *
 * Returns the authoritative MIME that callers must persist and later serve as
 * `Content-Type`, so a mismatched/polyglot upload can't trick a browser into
 * sniffing the bytes as something executable.
 */
export function validateItemImageDataUrl(dataUrl: string): {
  bytes: Buffer;
  mime: ItemImageMime;
} {
  const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image data URL" });
  }
  const declaredMime = match[1] as ItemImageMime;
  const bytes = Buffer.from(match[2]!, "base64");

  if (bytes.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Image is empty" });
  }
  if (bytes.length > MAX_ITEM_IMAGE_BYTES) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Image must be ≤ 3MB after decoding",
    });
  }

  const actualMime = sniffMime(bytes);
  if (!actualMime) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "File is not a valid PNG, JPEG, or WebP",
    });
  }
  if (actualMime !== declaredMime) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Declared MIME does not match file contents",
    });
  }

  return { bytes, mime: actualMime };
}

/** Identify image type from magic bytes, or null if unrecognized. */
function sniffMime(b: Buffer): ItemImageMime | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

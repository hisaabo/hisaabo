import { TRPCError } from "@trpc/server";

/**
 * Validate a user-uploaded image data URL and decode it into raw bytes.
 *
 * This is the server-side, authoritative defence against malicious logo
 * uploads. The tRPC schema (`uploadBusinessLogoSchema`) already rejects
 * obviously-wrong shapes at the boundary, but this function is what
 * actually proves the payload IS a PNG or JPEG — by inspecting the magic
 * bytes after base64 decode. We deliberately NEVER trust the declared
 * MIME string: a caller can write `data:image/png;base64,<JPEG bytes>`
 * and the schema wouldn't catch it. The rationale:
 *
 *   1. The bytes are what land in the `businesses.logo_data` bytea column
 *      and later get served to the storefront as `Content-Type: image/png`.
 *      A mismatch would make browsers refuse to render the logo — or, for
 *      polyglot files, execute surprising content.
 *   2. The decoded-size cap (1 MB) is re-applied here because the
 *      schema's cap is on the encoded data URL length; base64 expansion
 *      (~4:3) means the encoded-URL cap isn't a tight bound on decoded
 *      bytes.
 *   3. We throw `TRPCError`s with explicit codes so the callers don't
 *      collapse distinct failure modes ("too large", "wrong format",
 *      "declared/actual mismatch") into a single vague error.
 *
 * Exported separately from the router so the defence can be unit-tested
 * without bringing up the tRPC context or the database.
 */
export function validateLogoDataUrl(dataUrl: string): {
  bytes: Buffer;
  mime: "image/png" | "image/jpeg";
} {
  const match = /^data:(image\/png|image\/jpeg);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid image data URL" });
  }
  const declaredMime = match[1]!;
  const base64 = match[2]!;
  const bytes = Buffer.from(base64, "base64");

  // Re-assert size AFTER decoding — the schema caps encoded length but
  // encoded length ≠ decoded length (base64 expands ~4:3).
  if (bytes.length > 1_048_576) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Logo must be ≤ 1MB after decoding",
    });
  }

  // Magic-byte check — the only real proof of file type.
  //   PNG:  89 50 4E 47 0D 0A 1A 0A
  //   JPEG: FF D8 FF
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  let actualMime: "image/png" | "image/jpeg";
  if (isPng) {
    actualMime = "image/png";
  } else if (isJpeg) {
    actualMime = "image/jpeg";
  } else {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "File is not a valid PNG or JPEG",
    });
  }

  // Declared and actual MIME must agree — catches a client smuggling
  // JPEG bytes under a `data:image/png;base64,` prefix (or vice versa).
  // The declared header ends up as `Content-Type` on the storefront
  // response, so a mismatch is a browser-renderer footgun.
  if (actualMime !== declaredMime) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Declared MIME does not match file contents",
    });
  }

  return { bytes, mime: actualMime };
}

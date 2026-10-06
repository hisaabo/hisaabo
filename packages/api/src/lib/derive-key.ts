import { hkdfSync } from "node:crypto";

const DEV_FALLBACK = "hisaabo-dev-only-secret-not-for-production";
const SALT = "hisaabo-token-keys-v1";

/**
 * Derives an independent 32-byte key for `purpose` (e.g. "export-token") from
 * the server's root secret via HKDF, so the raw ENCRYPTION_KEY is never used
 * directly as an HMAC key and tokens of one purpose can't be replayed as another.
 *
 * Throws in production when no root secret is configured; outside production a
 * fixed dev secret is used so hot reloads keep tokens valid.
 */
export function deriveKey(purpose: string): Buffer {
  const root =
    process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.EXPORT_SECRET;
  if (!root) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "No signing secret configured: set ENCRYPTION_KEY (or SESSION_SECRET / EXPORT_SECRET)",
      );
    }
    return Buffer.from(hkdfSync("sha256", DEV_FALLBACK, SALT, purpose, 32));
  }
  return Buffer.from(hkdfSync("sha256", root, SALT, purpose, 32));
}

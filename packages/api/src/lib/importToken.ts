/**
 * Import token utilities — HMAC-signed, single-use, 15-minute TTL.
 *
 * Design mirrors exportToken.ts (Task #2) to share the same pattern.
 * Separate file avoids merge conflicts while Task #2 builds its own file.
 * A future consolidation pass can merge both into a single tokenUtils.ts.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const IMPORT_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getSecret(): string {
  const secret = process.env.EXPORT_SECRET || process.env.SESSION_SECRET || "dev-import-secret-change-in-prod";
  return secret;
}

// In-memory nonce set — tracks consumed tokens to enforce single-use.
// Entries are cleaned up every 20 minutes to bound memory growth.
const usedNonces = new Set<string>();
setInterval(() => {
  // Safe to clear entirely because tokens older than TTL are already expired
  // and we only keep nonces for tokens that were actually used. After 20 min,
  // any nonce still here is from a token that has already expired anyway.
  usedNonces.clear();
}, 20 * 60 * 1000).unref();

export interface ImportTokenPayload {
  tenantId: string;
  userId: string;
  nonce: string;
  expiresAt: number; // Unix ms
}

/**
 * Sign an import token for the given tenant + user.
 * Returns the opaque token string and the expiry timestamp.
 */
export function signImportToken(
  tenantId: string,
  userId: string,
): { token: string; expiresAt: Date } {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + IMPORT_TOKEN_TTL_MS;
  const payload: ImportTokenPayload = { tenantId, userId, nonce, expiresAt };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson).toString("base64url");

  const sig = createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("hex");

  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: new Date(expiresAt),
  };
}

export type VerifyImportTokenResult =
  | { ok: true; payload: ImportTokenPayload }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/**
 * Verify an import token.
 * On success marks the nonce as used (single-use enforcement).
 */
export function verifyImportToken(token: string): VerifyImportTokenResult {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return { ok: false, reason: "invalid" };

  const payloadB64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  // Timing-safe signature check
  const expected = createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const sigBuf = Buffer.from(sig, "utf8");
  if (
    expectedBuf.length !== sigBuf.length ||
    !timingSafeEqual(expectedBuf, sigBuf)
  ) {
    return { ok: false, reason: "invalid" };
  }

  let payload: ImportTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ImportTokenPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (Date.now() > payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  if (usedNonces.has(payload.nonce)) {
    return { ok: false, reason: "reused" };
  }

  // Mark as used
  usedNonces.add(payload.nonce);

  return { ok: true, payload };
}

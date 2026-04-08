/**
 * Field-level AES-256-GCM encryption with key versioning and rotation support.
 *
 * Key management:
 *   ENCRYPTION_KEY          — current key used for all new encrypts (64-char hex = 32 bytes)
 *   ENCRYPTION_KEY_PREVIOUS — old key used only for decryption during rotation
 *
 * Backward compatibility:
 *   - DB_ENCRYPTION_KEY is accepted as a fallback alias for ENCRYPTION_KEY
 *   - Legacy format (iv:tag:cipher without version prefix) is treated as version 1
 *   - Plaintext values are detected and returned as-is during decryption
 *   - encryptDbPassword / decryptDbPassword kept as aliases for existing callers
 *
 * Versioned format: v{version}:{iv_hex}:{authTag_hex}:{ciphertext_hex}
 * Legacy format:    {iv_hex}:{authTag_hex}:{ciphertext_hex}  (implicitly version 1)
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const CURRENT_KEY_VERSION = 2; // Version stamped on all new encryptions

// ── Key loading ─────────────────────────────────────────────────────────────

function parseKey(hex: string | undefined, envName: string): Buffer | null {
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error(`${envName} must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, "hex");
}

function getCurrentKey(): Buffer | null {
  return parseKey(
    process.env.ENCRYPTION_KEY || process.env.DB_ENCRYPTION_KEY,
    "ENCRYPTION_KEY",
  );
}

function getPreviousKey(): Buffer | null {
  return parseKey(process.env.ENCRYPTION_KEY_PREVIOUS, "ENCRYPTION_KEY_PREVIOUS");
}

// ── Format detection ────────────────────────────────────────────────────────

const VERSIONED_RE = /^v(\d+):([0-9a-f]+):([0-9a-f]+):([0-9a-f]*)$/i;
const LEGACY_RE = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+)$/i;

interface ParsedCiphertext {
  version: number;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

function parseCiphertext(stored: string): ParsedCiphertext | null {
  const vMatch = stored.match(VERSIONED_RE);
  if (vMatch) {
    return {
      version: Number(vMatch[1]),
      iv: Buffer.from(vMatch[2], "hex"),
      authTag: Buffer.from(vMatch[3], "hex"),
      ciphertext: Buffer.from(vMatch[4], "hex"),
    };
  }

  const lMatch = stored.match(LEGACY_RE);
  if (lMatch) {
    return {
      version: 1,
      iv: Buffer.from(lMatch[1], "hex"),
      authTag: Buffer.from(lMatch[2], "hex"),
      ciphertext: Buffer.from(lMatch[3], "hex"),
    };
  }

  return null; // Not encrypted — plaintext
}

// ── Core encrypt / decrypt ──────────────────────────────────────────────────

function rawEncrypt(plaintext: string, key: Buffer, version: number): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v${version}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function rawDecrypt(parsed: ParsedCiphertext, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, parsed.iv);
  decipher.setAuthTag(parsed.authTag);
  const decrypted = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether a stored value looks encrypted (versioned or legacy format).
 */
export function isEncrypted(value: string): boolean {
  return VERSIONED_RE.test(value) || LEGACY_RE.test(value);
}

/**
 * Get the key version stamped on an encrypted value, or 0 for plaintext.
 */
export function getKeyVersion(stored: string): number {
  const parsed = parseCiphertext(stored);
  return parsed ? parsed.version : 0;
}

/**
 * Encrypt a plaintext string using the current key.
 * Returns plaintext if no key is configured (development/self-hosted fallback).
 */
export function encryptField(plaintext: string): string {
  const key = getCurrentKey();
  if (!key) return plaintext;
  return rawEncrypt(plaintext, key, CURRENT_KEY_VERSION);
}

/**
 * Decrypt an encrypted string. Tries current key first, falls back to previous key.
 * Handles legacy (unversioned) format and plaintext gracefully.
 */
export function decryptField(stored: string): string {
  const key = getCurrentKey();
  if (!key) return stored;

  const parsed = parseCiphertext(stored);
  if (!parsed) return stored; // Plaintext passthrough

  // Try current key first
  try {
    return rawDecrypt(parsed, key);
  } catch {
    // Fall through to previous key
  }

  // Try previous key (rotation window)
  const prevKey = getPreviousKey();
  if (prevKey) {
    try {
      return rawDecrypt(parsed, prevKey);
    } catch {
      // Both keys failed
    }
  }

  // If both keys fail and this looks like legacy format, treat as plaintext.
  // This handles the edge case where a hex:hex:hex value was actually plaintext
  // that coincidentally matched the pattern (extremely unlikely but safe).
  return stored;
}

/**
 * Re-encrypt a stored value with the current key.
 * If already on the current key version, returns unchanged.
 * Useful for key rotation: decrypt with any key, re-encrypt with current.
 */
export function reEncryptField(stored: string): string {
  const key = getCurrentKey();
  if (!key) return stored;

  const parsed = parseCiphertext(stored);
  if (!parsed) {
    // Plaintext — encrypt it
    return rawEncrypt(stored, key, CURRENT_KEY_VERSION);
  }

  if (parsed.version === CURRENT_KEY_VERSION) {
    // Try to decrypt with current key to verify it actually uses the current key
    try {
      rawDecrypt(parsed, key);
      return stored; // Already on current key
    } catch {
      // Same version number but different key — need to re-encrypt
    }
  }

  // Decrypt with whatever key works, then re-encrypt with current
  const plaintext = decryptField(stored);
  return rawEncrypt(plaintext, key, CURRENT_KEY_VERSION);
}

// ── Backward-compatible aliases ─────────────────────────────────────────────

/** @deprecated Use encryptField() instead */
export function encryptDbPassword(plaintext: string): string {
  return encryptField(plaintext);
}

/** @deprecated Use decryptField() instead */
export function decryptDbPassword(stored: string): string {
  return decryptField(stored);
}

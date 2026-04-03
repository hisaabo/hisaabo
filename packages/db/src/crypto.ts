/**
 * AES-256-GCM encryption for tenant database passwords.
 * Enabled when DB_ENCRYPTION_KEY env var is set (64-char hex string = 32 bytes).
 * Without the key, passwords pass through unencrypted (backward compatible).
 */

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getKey(): Buffer | null {
  const keyHex = process.env.DB_ENCRYPTION_KEY;
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    throw new Error("DB_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(keyHex, "hex");
}

/** Encrypt a plaintext password. Returns plaintext if no key is configured. */
export function encryptDbPassword(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt an encrypted password. Handles legacy plaintext gracefully. */
export function decryptDbPassword(stored: string): string {
  const key = getKey();
  if (!key) return stored;

  // Check if value looks encrypted (hex:hex:hex format)
  const parts = stored.split(":");
  if (parts.length !== 3 || parts.some((p) => !/^[0-9a-f]+$/i.test(p))) {
    // Legacy plaintext password
    return stored;
  }

  try {
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    // Decryption failed — treat as legacy plaintext
    return stored;
  }
}

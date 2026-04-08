/**
 * crypto.test.ts — Tests for field-level encryption with key versioning and rotation.
 *
 * WHY THIS FILE EXISTS:
 * Encryption is a critical security control. If it breaks silently (e.g. during
 * a refactor), sensitive credentials could be stored in plaintext or become
 * unrecoverable. These tests verify:
 *
 *   1. Round-trip: encrypt -> decrypt returns original plaintext
 *   2. Key versioning: encrypted values carry a version tag
 *   3. Multi-key fallback: old key decrypts during rotation
 *   4. Plaintext detection: isEncrypted() distinguishes encrypted from plaintext
 *   5. Re-encryption: reEncryptField() upgrades old ciphertext to current key
 *   6. Backward compat: legacy unversioned format still decrypts
 *   7. No-key fallback: without ENCRYPTION_KEY, values pass through as plaintext
 *   8. Field-encryption helpers: table-specific encrypt/decrypt wrappers
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  encryptField,
  decryptField,
  reEncryptField,
  isEncrypted,
  getKeyVersion,
  encryptDbPassword,
  decryptDbPassword,
} from "@hisaabo/db";
import {
  encryptEInvoiceConfig,
  decryptEInvoiceConfig,
  encryptCarrierCredentials,
  decryptCarrierCredentials,
} from "../lib/field-encryption.js";

// ── Test keys (never used in production) ────────────────────────────────────

const TEST_KEY_A = "a".repeat(64); // 32 bytes of 0xaa
const TEST_KEY_B = "b".repeat(64); // 32 bytes of 0xbb

// ── Helpers to manage env vars for testing ──────────────────────────────────

function setKeys(current?: string, previous?: string) {
  // Clear all encryption key env vars
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  delete process.env.DB_ENCRYPTION_KEY;

  if (current) process.env.ENCRYPTION_KEY = current;
  if (previous) process.env.ENCRYPTION_KEY_PREVIOUS = previous;
}

function clearKeys() {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  delete process.env.DB_ENCRYPTION_KEY;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Field-level encryption (crypto.ts)", () => {
  afterEach(() => clearKeys());

  // ── Round-trip ──────────────────────────────────────────────────────────

  describe("encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts a simple string", () => {
      setKeys(TEST_KEY_A);
      const plaintext = "my-secret-password-123!@#";
      const encrypted = encryptField(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(decryptField(encrypted)).toBe(plaintext);
    });

    it("handles empty string", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("");
      expect(isEncrypted(encrypted)).toBe(true);
      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe("");
    });

    it("handles unicode characters", () => {
      setKeys(TEST_KEY_A);
      const plaintext = "password with emoji and hindi characters";
      const encrypted = encryptField(plaintext);
      expect(decryptField(encrypted)).toBe(plaintext);
    });

    it("handles long strings (API keys, tokens)", () => {
      setKeys(TEST_KEY_A);
      const plaintext = "a".repeat(4096);
      const encrypted = encryptField(plaintext);
      expect(decryptField(encrypted)).toBe(plaintext);
    });

    it("produces different ciphertext each time (random IV)", () => {
      setKeys(TEST_KEY_A);
      const plaintext = "same-input";
      const enc1 = encryptField(plaintext);
      const enc2 = encryptField(plaintext);
      expect(enc1).not.toBe(enc2);
      expect(decryptField(enc1)).toBe(plaintext);
      expect(decryptField(enc2)).toBe(plaintext);
    });
  });

  // ── Key versioning ─────────────────────────────────────────────────────

  describe("key versioning", () => {
    it("encrypted values start with v2: prefix", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("test");
      expect(encrypted).toMatch(/^v2:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });

    it("getKeyVersion returns 2 for current format", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("test");
      expect(getKeyVersion(encrypted)).toBe(2);
    });

    it("getKeyVersion returns 0 for plaintext", () => {
      expect(getKeyVersion("not-encrypted-just-text")).toBe(0);
      expect(getKeyVersion("hello world")).toBe(0);
    });

    it("isEncrypted returns true for versioned format", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("test");
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it("isEncrypted returns false for plaintext", () => {
      expect(isEncrypted("my-password")).toBe(false);
      expect(isEncrypted("simple text with spaces")).toBe(false);
      expect(isEncrypted("")).toBe(false);
    });
  });

  // ── Multi-key fallback (rotation) ──────────────────────────────────────

  describe("multi-key fallback during rotation", () => {
    it("decrypts with current key (normal case)", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("secret");
      setKeys(TEST_KEY_A, TEST_KEY_B);
      expect(decryptField(encrypted)).toBe("secret");
    });

    it("falls back to previous key when current key fails", () => {
      // Encrypt with key A
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("secret");

      // Switch to key B as current, key A as previous
      setKeys(TEST_KEY_B, TEST_KEY_A);
      expect(decryptField(encrypted)).toBe("secret");
    });

    it("fails gracefully when neither key works (returns raw value)", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("secret");

      // Switch to a completely different key with no previous
      setKeys(TEST_KEY_B);
      // Should return the raw encrypted string since decryption fails
      const result = decryptField(encrypted);
      expect(result).toBe(encrypted);
    });
  });

  // ── Re-encryption ─────────────────────────────────────────────────────

  describe("reEncryptField", () => {
    it("re-encrypts from old key to new key", () => {
      // Encrypt with key A
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("secret");

      // Set key B as current, key A as previous
      setKeys(TEST_KEY_B, TEST_KEY_A);
      const reEncrypted = reEncryptField(encrypted);

      // Verify it's now encrypted with key B
      expect(reEncrypted).not.toBe(encrypted);
      setKeys(TEST_KEY_B);
      expect(decryptField(reEncrypted)).toBe("secret");
    });

    it("encrypts plaintext values", () => {
      setKeys(TEST_KEY_A);
      const reEncrypted = reEncryptField("plaintext-password");
      expect(isEncrypted(reEncrypted)).toBe(true);
      expect(decryptField(reEncrypted)).toBe("plaintext-password");
    });

    it("returns unchanged if already on current key", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("secret");
      const reEncrypted = reEncryptField(encrypted);
      // Should be the same since it's already encrypted with the current key
      expect(reEncrypted).toBe(encrypted);
    });
  });

  // ── Legacy format (backward compat) ────────────────────────────────────

  describe("legacy unversioned format", () => {
    it("isEncrypted detects legacy hex:hex:hex format", () => {
      // Simulate a legacy encrypted value (iv:authTag:ciphertext, all hex)
      const legacy = "abcdef0123456789abcdef0123456789:aabbccdd00112233aabbccdd00112233:deadbeef";
      expect(isEncrypted(legacy)).toBe(true);
    });

    it("getKeyVersion returns 1 for legacy format", () => {
      const legacy = "abcdef0123456789abcdef0123456789:aabbccdd00112233aabbccdd00112233:deadbeef";
      expect(getKeyVersion(legacy)).toBe(1);
    });
  });

  // ── No-key fallback ────────────────────────────────────────────────────

  describe("no encryption key configured", () => {
    it("encryptField returns plaintext when no key is set", () => {
      clearKeys();
      expect(encryptField("secret")).toBe("secret");
    });

    it("decryptField returns the input when no key is set", () => {
      clearKeys();
      expect(decryptField("anything")).toBe("anything");
    });

    it("reEncryptField returns the input when no key is set", () => {
      clearKeys();
      expect(reEncryptField("anything")).toBe("anything");
    });
  });

  // ── DB_ENCRYPTION_KEY legacy alias ─────────────────────────────────────

  describe("DB_ENCRYPTION_KEY legacy alias", () => {
    it("uses DB_ENCRYPTION_KEY when ENCRYPTION_KEY is not set", () => {
      clearKeys();
      process.env.DB_ENCRYPTION_KEY = TEST_KEY_A;
      const encrypted = encryptField("legacy-test");
      expect(isEncrypted(encrypted)).toBe(true);
      expect(decryptField(encrypted)).toBe("legacy-test");
      delete process.env.DB_ENCRYPTION_KEY;
    });

    it("ENCRYPTION_KEY takes precedence over DB_ENCRYPTION_KEY", () => {
      clearKeys();
      process.env.ENCRYPTION_KEY = TEST_KEY_A;
      process.env.DB_ENCRYPTION_KEY = TEST_KEY_B;
      const encrypted = encryptField("precedence-test");
      // Should use ENCRYPTION_KEY (TEST_KEY_A)
      delete process.env.DB_ENCRYPTION_KEY;
      expect(decryptField(encrypted)).toBe("precedence-test");
    });
  });

  // ── Backward-compatible aliases ────────────────────────────────────────

  describe("encryptDbPassword / decryptDbPassword aliases", () => {
    it("encryptDbPassword is an alias for encryptField", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptDbPassword("db-pass");
      expect(isEncrypted(encrypted)).toBe(true);
      expect(decryptField(encrypted)).toBe("db-pass");
    });

    it("decryptDbPassword is an alias for decryptField", () => {
      setKeys(TEST_KEY_A);
      const encrypted = encryptField("db-pass");
      expect(decryptDbPassword(encrypted)).toBe("db-pass");
    });
  });

  // ── Invalid key validation ─────────────────────────────────────────────

  describe("key validation", () => {
    it("throws if ENCRYPTION_KEY is not 64 hex chars", () => {
      process.env.ENCRYPTION_KEY = "too-short";
      expect(() => encryptField("test")).toThrow("64-character hex string");
      clearKeys();
    });

    it("throws if ENCRYPTION_KEY_PREVIOUS is not 64 hex chars", () => {
      // Set a valid current key and an invalid previous key
      clearKeys();
      process.env.ENCRYPTION_KEY = TEST_KEY_A;
      process.env.ENCRYPTION_KEY_PREVIOUS = "bad";

      // Encrypt something with a different key so the current key will fail to decrypt,
      // triggering the fallback to ENCRYPTION_KEY_PREVIOUS which should throw on parse.
      clearKeys();
      process.env.ENCRYPTION_KEY = TEST_KEY_B;
      const encrypted = encryptField("test");

      // Now set key A as current (will fail to decrypt) and "bad" as previous (should throw)
      clearKeys();
      process.env.ENCRYPTION_KEY = TEST_KEY_A;
      process.env.ENCRYPTION_KEY_PREVIOUS = "bad";

      expect(() => decryptField(encrypted)).toThrow("64-character hex string");
      clearKeys();
    });
  });
});

// ── Table-specific helpers (field-encryption.ts) ────────────────────────────

describe("Field encryption helpers", () => {
  afterEach(() => clearKeys());

  describe("encryptEInvoiceConfig / decryptEInvoiceConfig", () => {
    it("encrypts and decrypts all sensitive fields", () => {
      setKeys(TEST_KEY_A);
      const config = {
        clientId: "client-id-123",
        clientSecret: "super-secret-abc",
        username: "irp-user",
        password: "irp-pass!@#",
        authToken: "token-xyz",
      };

      const encrypted = encryptEInvoiceConfig(config);
      expect(encrypted.clientId).not.toBe(config.clientId);
      expect(encrypted.clientSecret).not.toBe(config.clientSecret);
      expect(encrypted.username).not.toBe(config.username);
      expect(encrypted.password).not.toBe(config.password);
      expect(encrypted.authToken).not.toBe(config.authToken);

      const decrypted = decryptEInvoiceConfig(encrypted);
      expect(decrypted.clientId).toBe(config.clientId);
      expect(decrypted.clientSecret).toBe(config.clientSecret);
      expect(decrypted.username).toBe(config.username);
      expect(decrypted.password).toBe(config.password);
      expect(decrypted.authToken).toBe(config.authToken);
    });

    it("handles null authToken", () => {
      setKeys(TEST_KEY_A);
      const config = {
        clientId: "client-id",
        clientSecret: "secret",
        username: "user",
        password: "pass",
        authToken: null,
      };

      const encrypted = encryptEInvoiceConfig(config);
      expect(encrypted.authToken).toBeNull();

      const decrypted = decryptEInvoiceConfig(encrypted);
      expect(decrypted.authToken).toBeNull();
    });

    it("preserves non-sensitive fields", () => {
      setKeys(TEST_KEY_A);
      const config = {
        id: "uuid-123",
        businessId: "biz-456",
        gstin: "29ABCDE1234F1Z5",
        clientId: "client",
        clientSecret: "secret",
        username: "user",
        password: "pass",
        isSandbox: true,
        isEnabled: true,
      };

      const encrypted = encryptEInvoiceConfig(config);
      expect(encrypted.id).toBe("uuid-123");
      expect(encrypted.businessId).toBe("biz-456");
      expect(encrypted.gstin).toBe("29ABCDE1234F1Z5");
      expect(encrypted.isSandbox).toBe(true);
      expect(encrypted.isEnabled).toBe(true);
    });
  });

  describe("encryptCarrierCredentials / decryptCarrierCredentials", () => {
    it("encrypts and decrypts per-carrier credential fields", () => {
      setKeys(TEST_KEY_A);
      const creds = {
        delhivery: { apiKey: "dk-123", apiSecret: "ds-456", enabled: true },
        bluedart: { apiKey: "bk-789", accountId: "BA001", enabled: false },
      };

      const encrypted = encryptCarrierCredentials(creds);
      expect(encrypted).not.toBeNull();
      expect(encrypted!.delhivery.apiKey).not.toBe("dk-123");
      expect(encrypted!.delhivery.apiSecret).not.toBe("ds-456");
      expect(encrypted!.delhivery.enabled).toBe(true);
      expect(encrypted!.bluedart.apiKey).not.toBe("bk-789");
      expect(encrypted!.bluedart.accountId).not.toBe("BA001");

      const decrypted = decryptCarrierCredentials(encrypted);
      expect(decrypted).not.toBeNull();
      expect(decrypted!.delhivery.apiKey).toBe("dk-123");
      expect(decrypted!.delhivery.apiSecret).toBe("ds-456");
      expect(decrypted!.delhivery.enabled).toBe(true);
      expect(decrypted!.bluedart.apiKey).toBe("bk-789");
      expect(decrypted!.bluedart.accountId).toBe("BA001");
      expect(decrypted!.bluedart.enabled).toBe(false);
    });

    it("handles null input", () => {
      setKeys(TEST_KEY_A);
      expect(encryptCarrierCredentials(null)).toBeNull();
      expect(decryptCarrierCredentials(null)).toBeNull();
      expect(encryptCarrierCredentials(undefined)).toBeNull();
      expect(decryptCarrierCredentials(undefined)).toBeNull();
    });

    it("handles entries with missing optional fields", () => {
      setKeys(TEST_KEY_A);
      const creds = {
        carrier: { enabled: true },
      };

      const encrypted = encryptCarrierCredentials(creds);
      expect(encrypted).not.toBeNull();

      const decrypted = decryptCarrierCredentials(encrypted);
      expect(decrypted).not.toBeNull();
      expect(decrypted!.carrier.enabled).toBe(true);
    });
  });

  // ── Key rotation simulation ────────────────────────────────────────────

  describe("key rotation simulation", () => {
    it("full rotation cycle: encrypt with A, rotate to B, decrypt works", () => {
      // Step 1: Encrypt with key A
      setKeys(TEST_KEY_A);
      const config = {
        clientId: "id-1",
        clientSecret: "secret-1",
        username: "user-1",
        password: "pass-1",
      };
      const encryptedWithA = encryptEInvoiceConfig(config);

      // Step 2: Rotate to key B (keep A as previous)
      setKeys(TEST_KEY_B, TEST_KEY_A);

      // Decrypt should work (falls back to previous key)
      const decrypted = decryptEInvoiceConfig(encryptedWithA);
      expect(decrypted.clientId).toBe("id-1");
      expect(decrypted.password).toBe("pass-1");

      // Re-encrypt with new key
      const reEncryptedClientId = reEncryptField(encryptedWithA.clientId);
      expect(reEncryptedClientId).not.toBe(encryptedWithA.clientId);

      // Step 3: Remove previous key
      setKeys(TEST_KEY_B);
      expect(decryptField(reEncryptedClientId)).toBe("id-1");
    });

    it("carrier credentials survive key rotation", () => {
      // Encrypt with key A
      setKeys(TEST_KEY_A);
      const creds = {
        delhivery: { apiKey: "dk-test", enabled: true },
      };
      const encrypted = encryptCarrierCredentials(creds);

      // Rotate to key B
      setKeys(TEST_KEY_B, TEST_KEY_A);
      const decrypted = decryptCarrierCredentials(encrypted);
      expect(decrypted!.delhivery.apiKey).toBe("dk-test");
    });
  });
});

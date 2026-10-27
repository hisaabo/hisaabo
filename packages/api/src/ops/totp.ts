/**
 * TOTP (RFC 6238 over RFC 4226 HOTP) for /ops operators, plus recovery codes.
 *
 * SHA-1, 6 digits, 30-second steps — what every authenticator app supports.
 * Verification accepts the current step ±1 and returns the matched step so
 * the caller can refuse a step that was already used (replay protection is
 * persisted in ops_operators.totp_last_step).
 */
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
const SECRET_BYTES = 20; // 160-bit, the RFC 4226 recommendation for SHA-1
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 10;

// ── Base32 (RFC 4648, no padding) ────────────────────────────

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP ──────────────────────────────────────────────

export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS, algorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(key: Buffer, nowMs: number): string {
  return hotp(key, timeStep(nowMs));
}

/**
 * Returns the matched time step, or null. Steps at or before `lastStep` are
 * rejected (a code can be used once). Every candidate is compared in constant
 * time so timing does not reveal which window matched.
 */
export function verifyTotp(key: Buffer, code: string, nowMs: number, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(nowMs);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const ok = timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code));
    if (ok && (lastStep === null || step > lastStep) && matched === null) matched = step;
  }
  return matched;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function otpauthUri(secret: string, account: string, issuer = "Hisaabo Ops"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes ───────────────────────────────────────────

/** Strip formatting so "ABCD-EFGH …" and "abcdefgh…" hash the same. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Ten single-use codes (80 random bits each), shown once as XXXX-XXXX-XXXX-XXXX. */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    base32Encode(randomBytes(RECOVERY_CODE_BYTES)).match(/.{1,4}/g)!.join("-"),
  );
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** A recovery code is 16 base32 characters (any grouping); a TOTP code is 6 digits. */
export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === 16;
}

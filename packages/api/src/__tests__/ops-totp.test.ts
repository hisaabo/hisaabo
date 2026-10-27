/**
 * ops-totp.test.ts — TOTP (RFC 6238), recovery codes and the OPS_IP_ALLOWLIST
 * CIDR matcher behind /ops (docs/architecture/queue.md §7.2). Pure functions;
 * no database.
 */
import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  otpauthUri,
  timeStep,
  totpCode,
  verifyTotp,
} from "../ops/totp.js";
import { ipAllowed, parseCidr, parseCidrList } from "../ops/cidr.js";
import { opsConfig } from "../ops/config.js";

// RFC 6238 Appendix B, SHA-1 seed "12345678901234567890" (8-digit codes).
const RFC_KEY = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP (RFC 6238)", () => {
  it.each(RFC_VECTORS)("matches the SHA-1 test vector at T=%i", (seconds, expected) => {
    expect(hotp(RFC_KEY, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it("RFC 4226 HOTP vectors (6 digits)", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, counter) => expect(hotp(RFC_KEY, counter)).toBe(code));
  });

  it("base32 round-trips and matches RFC 4648 vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw-6ytb oi").toString()).toBe("foobar");
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(() => base32Decode("1nvalid")).toThrow();
  });

  it("accepts the current step and ±1, rejects ±2", () => {
    const key = base32Decode(generateTotpSecret());
    const now = 1_800_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(key, totpCode(key, now), now, null)).toBe(step);
    expect(verifyTotp(key, hotp(key, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(key, hotp(key, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(key, hotp(key, step - 2), now, null)).toBeNull();
    expect(verifyTotp(key, hotp(key, step + 2), now, null)).toBeNull();
  });

  it("refuses a step at or before the last used step (replay)", () => {
    const key = base32Decode(generateTotpSecret());
    const now = 1_800_000_000_000;
    const step = timeStep(now);
    const code = totpCode(key, now);
    expect(verifyTotp(key, code, now, step - 1)).toBe(step);
    expect(verifyTotp(key, code, now, step)).toBeNull();
    expect(verifyTotp(key, hotp(key, step - 1), now, step - 1)).toBeNull();
  });

  it("rejects malformed codes without throwing", () => {
    const key = base32Decode(generateTotpSecret());
    for (const bad of ["", "12345", "1234567", "abcdef", "12 456"]) {
      expect(verifyTotp(key, bad, Date.now(), null)).toBeNull();
    }
  });

  it("builds an otpauth URI authenticator apps understand", () => {
    const raw = otpauthUri("JBSWY3DPEHPK3PXP", "ops@example.in");
    expect(raw.startsWith(`otpauth://totp/${encodeURIComponent("Hisaabo Ops:ops@example.in")}?`)).toBe(true);
    const uri = new URL(raw);
    expect(uri.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("generates ten distinct 80-bit codes and stores only hashes", () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(hashes).toEqual(codes.map(hashRecoveryCode));
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
  });

  it("hashes the same regardless of case, dashes and spaces", () => {
    const { codes } = generateRecoveryCodes();
    const raw = codes[0];
    expect(hashRecoveryCode(raw.toLowerCase().replace(/-/g, " "))).toBe(hashRecoveryCode(raw));
    expect(looksLikeRecoveryCode(raw)).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});

describe("OPS_IP_ALLOWLIST CIDR matching", () => {
  it("matches IPv4 ranges and single addresses", () => {
    const list = parseCidrList("10.0.0.0/8, 192.0.2.7");
    expect(ipAllowed("10.1.2.3", list)).toBe(true);
    expect(ipAllowed("192.0.2.7", list)).toBe(true);
    expect(ipAllowed("192.0.2.8", list)).toBe(false);
    expect(ipAllowed("11.0.0.1", list)).toBe(false);
  });

  it("matches IPv6 ranges and IPv4-mapped IPv6 as IPv4", () => {
    const list = parseCidrList("2001:db8::/32, 198.51.100.0/24");
    expect(ipAllowed("2001:db8:1::5", list)).toBe(true);
    expect(ipAllowed("2001:db9::1", list)).toBe(false);
    expect(ipAllowed("::ffff:198.51.100.20", list)).toBe(true);
    expect(ipAllowed("::1", parseCidrList("::1"))).toBe(true);
  });

  it("fails closed on unknown or missing addresses", () => {
    const list = parseCidrList("0.0.0.0/0");
    expect(ipAllowed(null, list)).toBe(false);
    expect(ipAllowed("unknown", list)).toBe(false);
    expect(ipAllowed("10.0.0.1", list)).toBe(true);
  });

  it("rejects invalid entries", () => {
    expect(() => parseCidr("10.0.0.0/33")).toThrow();
    expect(() => parseCidr("nope")).toThrow();
    expect(() => parseCidr("2001:db8::/129")).toThrow();
  });

  it("opsConfig is off by default and validates its numbers", () => {
    expect(opsConfig({}).enabled).toBe(false);
    const cfg = opsConfig({ QUEUE_DASHBOARD_ENABLED: "true", OPS_IP_ALLOWLIST: "10.0.0.0/8", OPS_STEP_UP_MINUTES: "2" });
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowlist).toHaveLength(1);
    expect(cfg.stepUpMs).toBe(120_000);
    expect(cfg.idleMs).toBe(15 * 60_000);
    expect(cfg.maxMs).toBe(8 * 3_600_000);
    expect(() => opsConfig({ OPS_SESSION_IDLE_MINUTES: "0" })).toThrow();
  });
});

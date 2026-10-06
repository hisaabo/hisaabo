import { describe, it, expect } from "vitest";
import {
  generateOtpCode, hashOtp, verifyOtpHash, signOtpToken, verifyOtpToken, OTP_TOKEN_TTL_MS,
} from "../lib/store-otp.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const PHONE = "9876543210";

describe("otp codes", () => {
  it("generates 6 digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("hashes are bound to business, phone and code", () => {
    const h = hashOtp(BIZ, PHONE, "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(verifyOtpHash(BIZ, PHONE, "123456", h)).toBe(true);
    expect(verifyOtpHash(BIZ, PHONE, "123457", h)).toBe(false);
    expect(verifyOtpHash(BIZ, "9876543211", "123456", h)).toBe(false);
    expect(verifyOtpHash("22222222-2222-2222-2222-222222222222", PHONE, "123456", h)).toBe(false);
    expect(verifyOtpHash(BIZ, PHONE, "123456", "short")).toBe(false);
  });
});

describe("otp token", () => {
  it("round-trips for the same business and phone", () => {
    expect(verifyOtpToken(signOtpToken(BIZ, PHONE), BIZ, PHONE)).toBe(true);
  });

  it("rejects a different phone or business", () => {
    const t = signOtpToken(BIZ, PHONE);
    expect(verifyOtpToken(t, BIZ, "9876543211")).toBe(false);
    expect(verifyOtpToken(t, "22222222-2222-2222-2222-222222222222", PHONE)).toBe(false);
  });

  it("expires after 30 minutes", () => {
    const now = Date.now();
    const t = signOtpToken(BIZ, PHONE, now);
    expect(verifyOtpToken(t, BIZ, PHONE, now + OTP_TOKEN_TTL_MS - 1000)).toBe(true);
    expect(verifyOtpToken(t, BIZ, PHONE, now + OTP_TOKEN_TTL_MS + 1000)).toBe(false);
  });

  it("rejects tampered, malformed and missing tokens", () => {
    const t = signOtpToken(BIZ, PHONE);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ businessId: BIZ, phone: "9999999999", exp: Date.now() + 1e6 })).toString("base64url");
    expect(verifyOtpToken(`${forged}.${sig}`, BIZ, "9999999999")).toBe(false);
    expect(verifyOtpToken(`${payload}.`, BIZ, PHONE)).toBe(false);
    expect(verifyOtpToken(`${payload}.${sig}.x`, BIZ, PHONE)).toBe(false);
    expect(verifyOtpToken("garbage", BIZ, PHONE)).toBe(false);
    expect(verifyOtpToken(undefined, BIZ, PHONE)).toBe(false);
    expect(verifyOtpToken(123, BIZ, PHONE)).toBe(false);
  });
});

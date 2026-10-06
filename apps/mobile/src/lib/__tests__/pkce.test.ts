import { createHash, randomBytes } from "crypto";

const mockRandomBytes = jest.fn((n: number) => new Uint8Array(randomBytes(n)));
jest.mock("expo-crypto", () => ({ getRandomBytes: (n: number) => mockRandomBytes(n) }));
import {
  base64UrlEncode,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
  getRandomBytes,
} from "../pkce";

describe("pkce", () => {
  it("matches the RFC 7636 Appendix B vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("base64url-encodes like node without padding", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 37 + 250) & 0xff);
      expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
    }
  });

  it("generates a 43-char URL-safe verifier whose challenge is 43 chars", () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallengeS256(v)).toBe(createHash("sha256").update(v).digest("base64url"));
    expect(codeChallengeS256(v)).toHaveLength(43);
  });

  it("generates unique states matching the server's pattern", () => {
    const a = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(generateState()).not.toBe(a);
  });

  it("draws randomness from expo-crypto (the OS CSPRNG), never Math.random", () => {
    const spy = jest.spyOn(Math, "random");
    expect(getRandomBytes(32)).toHaveLength(32);
    expect(mockRandomBytes).toHaveBeenCalledWith(32);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
